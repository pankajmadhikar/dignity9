import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { bmi, clinicToday, dateFromYmd, DEFAULT_ALERT_RULES, fahrenheitToCelsius } from './utils/domain';
import { ensureStorage, hashPassword, persistVitalAlerts, prisma, storageDir } from './lib';

const PASSWORD = 'Clinic#2026';

async function resetDatabase() {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (!rows.length) return;
  const names = rows.map((row) => `"${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
}

function writePdf(filePath: string, title: string, lines: string[]) {
  return new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.fontSize(18).text(title);
    doc.moveDown();
    for (const line of lines) doc.fontSize(12).text(line);
    doc.end();
    stream.on('finish', () => resolve());
    stream.on('error', reject);
  });
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed a production database');
  }
  ensureStorage();
  await resetDatabase();
  const passwordHash = await hashPassword(PASSWORD);
  const clinic = await prisma.clinic.create({
    data: {
      name: 'Dignity Clinic',
      address: '14 FC Road, Shivajinagar, Pune 411004',
      phone: '020 4000 1900',
      email: 'desk@dignity.clinic',
      registrationNo: 'CLN-PUN-1042',
      timezone: 'Asia/Kolkata',
    },
  });

  const [admin, doctor, reception, lab] = await Promise.all(
    [
      ['Meera Shah', 'admin@dignity.test', 'ADMIN', null, null],
      ['Dr. Ananya Kulkarni', 'doctor@dignity.test', 'DOCTOR', 'General physician', 'MMC-000000'],
      ['Rahul Deshmukh', 'reception@dignity.test', 'RECEPTIONIST', null, null],
      ['Sneha Patil', 'lab@dignity.test', 'LAB', null, null],
    ].map(([name, email, role, specialty, registrationNo]) =>
      prisma.user.create({
        data: {
          clinicId: clinic.id,
          name: name!,
          email: email!,
          passwordHash,
          role: role as 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'LAB',
          specialty,
          registrationNo,
        },
      }),
    ),
  );

  await prisma.alertRule.createMany({
    data: DEFAULT_ALERT_RULES.map((rule) => ({ ...rule, clinicId: clinic.id, isActive: true })),
  });

  const today = clinicToday(clinic.timezone);
  const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const suresh = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      patientCode: 'DG-00001',
      fullName: 'Suresh Patil',
      dateOfBirth: dateFromYmd('1968-04-12'),
      sex: 'MALE',
      mobile: '9876543210',
      address: 'Kothrud, Pune',
      allergies: 'Penicillin',
      medicalHistory: 'Hypertension, on treatment since 2022.',
      consentWhatsapp: true,
      consentSms: true,
    },
  });
  const asha = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      patientCode: 'DG-00002',
      fullName: 'Asha More',
      dateOfBirth: dateFromYmd('1980-09-02'),
      sex: 'FEMALE',
      mobile: '9123456780',
      allergies: 'None recorded',
      consentSms: true,
    },
  });
  const imran = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      patientCode: 'DG-00003',
      fullName: 'Imran Shaikh',
      dateOfBirth: dateFromYmd('1992-01-19'),
      sex: 'MALE',
      mobile: '9988776655',
      address: 'Camp, Pune',
    },
  });
  const kavita = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      patientCode: 'DG-00004',
      fullName: 'Kavita Desai',
      dateOfBirth: dateFromYmd('1997-06-11'),
      sex: 'FEMALE',
      mobile: '9012345678',
      consentWhatsapp: true,
    },
  });
  const ramesh = await prisma.patient.create({
    data: {
      clinicId: clinic.id,
      patientCode: 'DG-00005',
      fullName: 'Ramesh Iyer',
      dateOfBirth: dateFromYmd('1959-12-03'),
      sex: 'MALE',
      mobile: '9345612780',
      allergies: 'Sulfa drugs',
    },
  });

  const past = await prisma.visit.create({
    data: {
      clinicId: clinic.id,
      patientId: suresh.id,
      doctorId: doctor.id,
      visitType: 'WALK_IN',
      chiefComplaint: 'Routine blood pressure review',
      createdAt: daysAgo(14),
      completedAt: daysAgo(14),
      consultation: {
        create: {
          doctorId: doctor.id,
          symptoms: 'Occasional morning headache',
          examination: 'No acute distress',
          diagnosis: 'Essential hypertension',
          treatmentPlan: 'Continue current medicine and home BP log',
          status: 'FINALIZED',
          finalizedAt: daysAgo(14),
          followUpDate: dateFromYmd(clinicToday(clinic.timezone, daysAgo(0))),
        },
      },
      prescriptions: {
        create: {
          doctorId: doctor.id,
          status: 'APPROVED',
          version: 1,
          diagnosis: 'Essential hypertension',
          notes: 'Take after breakfast. Do not stop suddenly.',
          approvedAt: daysAgo(14),
          items: {
            create: {
              medicineName: 'Telmisartan',
              formulation: 'Tablet',
              strength: '40 mg',
              dosage: '1 tablet',
              frequency: '1-0-0',
              duration: '30 days',
              route: 'Oral',
              instructions: 'After breakfast',
            },
          },
        },
      },
      queue: {
        create: {
          clinicId: clinic.id,
          tokenNumber: 4,
          tokenDate: dateFromYmd(clinicToday(clinic.timezone, daysAgo(14))),
          status: 'COMPLETED',
          position: 4,
          completedAt: daysAgo(14),
        },
      },
    },
  });
  void past;

  const kavitaVisit = await prisma.visit.create({
    data: {
      clinicId: clinic.id,
      patientId: kavita.id,
      doctorId: doctor.id,
      visitType: 'WALK_IN',
      chiefComplaint: 'Sore throat for 3 days',
      createdAt: daysAgo(7),
      completedAt: daysAgo(7),
      consultation: {
        create: {
          doctorId: doctor.id,
          diagnosis: 'Acute pharyngitis',
          treatmentPlan: 'Symptomatic care and review if fever persists',
          status: 'FINALIZED',
          finalizedAt: daysAgo(7),
          followUpDate: dateFromYmd(today),
          followUpInstructions: 'Review if fever or pain is still present',
        },
      },
      queue: {
        create: {
          clinicId: clinic.id,
          tokenNumber: 2,
          tokenDate: dateFromYmd(clinicToday(clinic.timezone, daysAgo(7))),
          status: 'COMPLETED',
          position: 2,
          completedAt: daysAgo(7),
        },
      },
    },
  });
  await prisma.followUpTask.create({
    data: {
      clinicId: clinic.id,
      patientId: kavita.id,
      visitId: kavitaVisit.id,
      doctorId: doctor.id,
      dueDate: dateFromYmd(today),
      instructions: 'Review if fever or pain is still present',
    },
  });

  await prisma.visit.create({
    data: {
      clinicId: clinic.id,
      patientId: ramesh.id,
      doctorId: doctor.id,
      visitType: 'WALK_IN',
      chiefComplaint: 'Fever and body ache since yesterday',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
      completedAt: new Date(Date.now() - 90 * 60 * 1000),
      consultation: {
        create: {
          doctorId: doctor.id,
          diagnosis: 'Viral fever',
          treatmentPlan: 'Rest, fluids, and paracetamol for fever',
          status: 'FINALIZED',
          finalizedAt: new Date(Date.now() - 90 * 60 * 1000),
        },
      },
      prescriptions: {
        create: {
          doctorId: doctor.id,
          status: 'APPROVED',
          diagnosis: 'Viral fever',
          notes: 'Return sooner if breathing becomes difficult.',
          approvedAt: new Date(Date.now() - 90 * 60 * 1000),
          items: {
            create: {
              medicineName: 'Paracetamol',
              formulation: 'Tablet',
              strength: '500 mg',
              dosage: '1 tablet',
              frequency: '1-1-1',
              duration: '3 days',
              route: 'Oral',
              instructions: 'After food, only if fever or pain',
            },
          },
        },
      },
      queue: {
        create: {
          clinicId: clinic.id,
          tokenNumber: 1,
          tokenDate: dateFromYmd(today),
          status: 'COMPLETED',
          position: 1,
          startedAt: new Date(Date.now() - 100 * 60 * 1000),
          completedAt: new Date(Date.now() - 90 * 60 * 1000),
        },
      },
    },
  });

  const sureshToday = await prisma.visit.create({
    data: {
      clinicId: clinic.id,
      patientId: suresh.id,
      visitType: 'WALK_IN',
      chiefComplaint: 'Headache for 2 days',
      queue: {
        create: {
          clinicId: clinic.id,
          tokenNumber: 2,
          tokenDate: dateFromYmd(today),
          status: 'WAITING',
          position: 2,
        },
      },
    },
  });
  await prisma.vital.create({
    data: {
      visitId: sureshToday.id,
      systolic: 150,
      diastolic: 92,
      pulse: 78,
      weightKg: 74,
      heightCm: 168,
      bmi: bmi(74, 168),
      temperatureC: fahrenheitToCelsius(98.6),
      spo2: 98,
      recordedById: reception.id,
    },
  });

  const ashaVisit = await prisma.visit.create({
    data: {
      clinicId: clinic.id,
      patientId: asha.id,
      visitType: 'WALK_IN',
      chiefComplaint: 'Giddiness since this morning',
      queue: {
        create: {
          clinicId: clinic.id,
          tokenNumber: 3,
          tokenDate: dateFromYmd(today),
          status: 'WAITING',
          priority: 'EMERGENCY',
          priorityReason: 'Giddiness with high blood pressure at the desk',
          position: 3,
        },
      },
    },
  });
  const ashaVital = await prisma.vital.create({
    data: {
      visitId: ashaVisit.id,
      systolic: 186,
      diastolic: 110,
      pulse: 96,
      spo2: 97,
      temperatureC: fahrenheitToCelsius(99.1),
      recordedById: reception.id,
    },
  });
  await persistVitalAlerts(prisma, {
    clinicId: clinic.id,
    patientId: asha.id,
    visitId: ashaVisit.id,
    vitalId: ashaVital.id,
    reading: { systolic: 186, diastolic: 110, pulse: 96, spo2: 97, temperatureC: ashaVital.temperatureC },
  });

  const imranVisit = await prisma.visit.create({
    data: {
      clinicId: clinic.id,
      patientId: imran.id,
      doctorId: doctor.id,
      visitType: 'WALK_IN',
      chiefComplaint: 'Increased thirst and fatigue',
      createdAt: daysAgo(1),
      completedAt: daysAgo(1),
      consultation: {
        create: {
          doctorId: doctor.id,
          diagnosis: 'Suspected dysglycaemia — awaiting glucose',
          status: 'FINALIZED',
          finalizedAt: daysAgo(1),
        },
      },
      queue: {
        create: {
          clinicId: clinic.id,
          tokenNumber: 6,
          tokenDate: dateFromYmd(clinicToday(clinic.timezone, daysAgo(1))),
          status: 'COMPLETED',
          position: 6,
          completedAt: daysAgo(1),
        },
      },
    },
  });
  const order = await prisma.labOrder.create({
    data: {
      clinicId: clinic.id,
      patientId: imran.id,
      visitId: imranVisit.id,
      doctorId: doctor.id,
      testName: 'Fasting blood glucose',
      status: 'REPORT_AVAILABLE',
      createdAt: daysAgo(1),
    },
  });
  const storageKey = 'seed-imran-glucose.pdf';
  await writePdf(path.join(storageDir, storageKey), 'City Lab — Fasting blood glucose', [
    'Patient: Imran Shaikh',
    'Patient code: DG-00003',
    'Result: 118 mg/dL',
    'Reference: 70–99 mg/dL',
    'This sample file is linked only to the originating order.',
  ]);
  const fileBuffer = fs.readFileSync(path.join(storageDir, storageKey));
  const { createHash } = await import('crypto');
  await prisma.labReport.create({
    data: {
      clinicId: clinic.id,
      patientId: imran.id,
      visitId: imranVisit.id,
      labOrderId: order.id,
      laboratory: 'City Lab',
      fileName: 'imran-fasting-glucose.pdf',
      storageKey,
      mimeType: 'application/pdf',
      uploadedById: lab.id,
      contentHash: createHash('sha256').update(fileBuffer).digest('hex'),
      reportedAt: new Date(),
    },
  });

  console.log('Seeded Dignity Clinic');
  console.log('admin@dignity.test / doctor@dignity.test / reception@dignity.test / lab@dignity.test');
  console.log(`Password: ${PASSWORD}`);
  void admin;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
