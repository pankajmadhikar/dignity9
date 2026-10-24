import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { DEFAULT_ALERT_RULES } from '../src/utils/domain';
import { hashPassword, prisma } from '../src/lib';

const app = createApp();
const password = 'Clinic#2026';

async function resetDatabase() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (!rows.length) return;
  const names = rows.map((row) => `"${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

async function fixture() {
  await resetDatabase();
  const passwordHash = await hashPassword(password);
  const clinic = await prisma.clinic.create({ data: { name: 'Test Clinic', timezone: 'Asia/Kolkata' } });
  const other = await prisma.clinic.create({ data: { name: 'Other Clinic', timezone: 'Asia/Kolkata' } });
  const doctor = await prisma.user.create({
    data: { clinicId: clinic.id, email: 'doctor@test.clinic', name: 'Dr Test', role: 'DOCTOR', passwordHash },
  });
  const reception = await prisma.user.create({
    data: { clinicId: clinic.id, email: 'reception@test.clinic', name: 'Reception', role: 'RECEPTIONIST', passwordHash },
  });
  const lab = await prisma.user.create({
    data: { clinicId: clinic.id, email: 'lab@test.clinic', name: 'Lab', role: 'LAB', passwordHash },
  });
  const outsider = await prisma.user.create({
    data: { clinicId: other.id, email: 'outsider@test.clinic', name: 'Outsider', role: 'DOCTOR', passwordHash },
  });
  await prisma.alertRule.createMany({
    data: DEFAULT_ALERT_RULES.map((rule) => ({ ...rule, clinicId: clinic.id, isActive: true })),
  });
  return { clinic, doctor, reception, lab, outsider };
}

async function login(email: string) {
  const agent = request.agent(app);
  const response = await agent.post('/api/auth/login').send({ email, password });
  expect(response.status).toBe(200);
  return agent;
}

describe('clinic access boundaries', () => {
  beforeEach(async () => {
    await fixture();
  });

  it('requires a signed-in staff member', async () => {
    const response = await request(app).get('/api/patients');
    expect(response.status).toBe(401);
  });

  it('warns before creating a duplicate patient', async () => {
    const desk = await login('reception@test.clinic');
    const first = await desk.post('/api/patients').send({
      fullName: 'Suresh Patil',
      sex: 'MALE',
      mobile: '9876543210',
      ageYears: 58,
    });
    expect(first.status).toBe(201);
    const duplicate = await desk.post('/api/patients').send({
      fullName: 'S. Patil',
      sex: 'MALE',
      mobile: '9876543210',
      ageYears: 40,
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.details.duplicates[0].patientCode).toBe(first.body.patient.patientCode);
  });

  it('keeps diagnosis from the receptionist and blocks prescription approval', async () => {
    const desk = await login('reception@test.clinic');
    const doctor = await login('doctor@test.clinic');
    const created = await desk.post('/api/patients').send({
      fullName: 'Asha More',
      sex: 'FEMALE',
      mobile: '9123456780',
      dateOfBirth: '1980-09-02',
    });
    const queued = await desk.post('/api/queue').send({
      patientId: created.body.patient.id,
      chiefComplaint: 'Giddiness since morning',
      vitals: { systolic: 186, diastolic: 110, pulse: 96 },
    });
    expect(queued.status).toBe(201);
    expect(queued.body.entry.visit.patient.fullName).toBe('Asha More');

    const forbidden = await desk.post(`/api/visits/${queued.body.entry.visitId ?? queued.body.entry.visit.id}/finalize`).send({
      diagnosis: 'Hypertension',
      items: [{ medicineName: 'Telmisartan', strength: '40 mg', frequency: '1-0-0' }],
    });
    expect(forbidden.status).toBe(403);

    const visitId = queued.body.entry.visit.id;
    const started = await doctor.post(`/api/queue/${queued.body.entry.id}/start`);
    expect(started.status).toBe(200);
    const finalized = await doctor.post(`/api/visits/${visitId}/finalize`).send({
      diagnosis: 'Hypertensive urgency — clinical review',
      symptoms: 'Giddiness',
      items: [{ medicineName: 'Amlodipine', strength: '5 mg', dosage: '1 tablet', frequency: '1-0-0', duration: '7 days' }],
      followUpDate: '2026-10-27',
    });
    expect(finalized.status).toBe(200);
    const prescription = finalized.body.prescriptions.find((item: { status: string }) => item.status === 'APPROVED');
    expect(prescription).toBeTruthy();

    const deskView = await desk.get(`/api/visits/${visitId}`);
    expect(deskView.body.access).toBe('operational');
    expect(deskView.body.visit.consultation).toBeNull();
    expect(deskView.body.visit.prescriptions[0].items).toBeUndefined();

    const pdf = await doctor.get(`/api/prescriptions/${prescription.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');
  });

  it('stops a doctor from running two consultations at once', async () => {
    const desk = await login('reception@test.clinic');
    const doctor = await login('doctor@test.clinic');
    const ids: string[] = [];
    for (const [name, mobile] of [
      ['Ramesh Iyer', '9345612780'],
      ['Kavita Desai', '9012345678'],
    ] as const) {
      const patient = await desk.post('/api/patients').send({ fullName: name, sex: 'MALE', mobile, ageYears: 40 });
      const queued = await desk.post('/api/queue').send({ patientId: patient.body.patient.id, chiefComplaint: 'Fever and cough' });
      ids.push(queued.body.entry.id);
    }
    expect((await doctor.post(`/api/queue/${ids[0]}/start`)).status).toBe(200);
    const second = await doctor.post(`/api/queue/${ids[1]}/start`);
    expect(second.status).toBe(409);
  });

  it('associates a report only with the ordered patient', async () => {
    const desk = await login('reception@test.clinic');
    const doctor = await login('doctor@test.clinic');
    const lab = await login('lab@test.clinic');
    const outsider = await login('outsider@test.clinic');
    const patientA = await desk.post('/api/patients').send({ fullName: 'Imran Shaikh', sex: 'MALE', mobile: '9988776655', ageYears: 34 });
    const patientB = await desk.post('/api/patients').send({ fullName: 'Kavita Desai', sex: 'FEMALE', mobile: '9012345678', ageYears: 29 });
    const queued = await desk.post('/api/queue').send({
      patientId: patientA.body.patient.id,
      chiefComplaint: 'Fatigue and thirst',
    });
    const visitId = queued.body.entry.visit.id;
    await doctor.post(`/api/queue/${queued.body.entry.id}/start`);
    const finalized = await doctor.post(`/api/visits/${visitId}/finalize`).send({
      diagnosis: 'Check glucose',
      labTests: ['Fasting blood glucose'],
      items: [],
    });
    const orderId = finalized.body.labOrders[0].id;
    const file = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');
    const uploaded = await lab
      .post(`/api/lab-orders/${orderId}/report`)
      .attach('file', file, { filename: 'glucose.pdf', contentType: 'application/pdf' })
      .field('laboratory', 'City Lab');
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.report.patientId).toBe(patientA.body.patient.id);

    const again = await lab
      .post(`/api/lab-orders/${orderId}/report`)
      .attach('file', file, { filename: 'glucose.pdf', contentType: 'application/pdf' });
    expect(again.status).toBe(409);

    const chartA = await doctor.get(`/api/patients/${patientA.body.patient.id}`);
    const chartB = await doctor.get(`/api/patients/${patientB.body.patient.id}`);
    expect(chartA.body.labOrders.some((order: { reports: unknown[] }) => order.reports.length === 1)).toBe(true);
    expect(chartB.body.labOrders).toHaveLength(0);

    const crossed = await outsider.get(`/api/patients/${patientA.body.patient.id}`);
    expect(crossed.status).toBe(404);
    const crossedFile = await outsider.get(`/api/lab-reports/${uploaded.body.report.id}/file`);
    expect(crossedFile.status).toBe(404);
  });
});
