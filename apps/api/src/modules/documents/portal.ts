import { Router } from 'express';
import { z } from 'zod';
import { hashToken, newSessionToken, prisma, audit, clientIp, HttpError } from '../../lib';
import { authed, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';
import { readStoredFile } from '../../integrations/storage';
import { safeDownloadName } from '../../lib';
import { streamPrescription } from '../prescriptions/pdf';
import { ageSex } from '../consultations/shared';
import { formatMobile } from '../../utils/domain';
import { env } from '../../config/env';

const staff = Router();
staff.use(requireAuth);

staff.post(
  '/patients/:id/share-links',
  requireRole('DOCTOR', 'RECEPTIONIST', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(z.object({ days: z.number().int().min(1).max(30).optional() }), req.body ?? {});
    const patient = await prisma.patient.findFirst({ where: { id: req.params.id, clinicId: user.clinicId } });
    if (!patient) throw new HttpError(404, 'Patient not found');
    const token = newSessionToken();
    const days = body.days ?? 7;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await prisma.shareLink.create({
      data: {
        clinicId: user.clinicId,
        patientId: patient.id,
        tokenHash: hashToken(token),
        expiresAt,
        createdById: user.id,
      },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'record.share',
      entityType: 'Patient',
      entityId: patient.id,
      metadata: { expiresAt: expiresAt.toISOString() },
      ip: clientIp(req),
    });
    res.status(201).json({
      expiresAt,
      path: `/portal/${token}`,
      url: `${env.PUBLIC_APP_URL}/portal/${token}`,
    });
  }),
);

const hits = new Map<string, { count: number; reset: number }>();

function limitPortal(ip: string) {
  if (env.NODE_ENV === 'test') return;
  const now = Date.now();
  const current = hits.get(ip);
  if (!current || current.reset < now) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 30) throw new HttpError(429, 'Too many portal requests. Wait a minute and try again.');
}

async function openLink(token: string) {
  const link = await prisma.shareLink.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { patient: true, clinic: true },
  });
  if (!link || link.revokedAt || link.expiresAt.getTime() < Date.now()) throw new HttpError(404, 'This link is not available');
  await prisma.shareLink.update({ where: { id: link.id }, data: { lastAccessAt: new Date() } });
  return link;
}

const portal = Router();

portal.get(
  '/:token',
  wrap(async (req, res) => {
    limitPortal(req.ip || 'unknown');
    const link = await openLink(req.params.token);
    const [prescriptions, reports, followUps] = await Promise.all([
      prisma.prescription.findMany({
        where: { status: 'APPROVED', visit: { patientId: link.patientId, clinicId: link.clinicId } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, createdAt: true, followUpDate: true, version: true },
      }),
      prisma.labReport.findMany({
        where: { patientId: link.patientId, clinicId: link.clinicId },
        orderBy: { reportedAt: 'desc' },
        take: 20,
        select: { id: true, fileName: true, reportedAt: true, labOrder: { select: { testName: true } } },
      }),
      prisma.followUpTask.findMany({
        where: { patientId: link.patientId, clinicId: link.clinicId, status: { in: ['PENDING', 'RESCHEDULED'] } },
        orderBy: { dueDate: 'asc' },
        select: { id: true, dueDate: true, instructions: true },
      }),
    ]);
    await audit(prisma, {
      clinicId: link.clinicId,
      action: 'portal.view',
      entityType: 'Patient',
      entityId: link.patientId,
      ip: clientIp(req),
    });
    res.json({
      clinic: { name: link.clinic.name },
      patient: { fullName: link.patient.fullName, patientCode: link.patient.patientCode },
      prescriptions,
      reports,
      followUps,
      expiresAt: link.expiresAt,
    });
  }),
);

portal.get(
  '/:token/prescriptions/:id/pdf',
  wrap(async (req, res) => {
    limitPortal(req.ip || 'unknown');
    const link = await openLink(req.params.token);
    const prescription = await prisma.prescription.findFirst({
      where: { id: req.params.id, status: 'APPROVED', visit: { patientId: link.patientId, clinicId: link.clinicId } },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        doctor: true,
        visit: { include: { patient: true, labOrders: true, clinic: true } },
      },
    });
    if (!prescription) throw new HttpError(404, 'Prescription not found');
    const clinic = prescription.visit.clinic;
    const patient = prescription.visit.patient;
    streamPrescription(res, {
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicPhone: clinic.phone,
      clinicEmail: clinic.email,
      doctorName: prescription.doctor.name,
      specialty: prescription.doctor.specialty,
      registrationNo: prescription.doctor.registrationNo,
      patientName: patient.fullName,
      patientCode: patient.patientCode,
      ageSex: ageSex(patient),
      mobile: formatMobile(patient.mobile),
      visitDate: prescription.visit.createdAt.toISOString().slice(0, 10),
      diagnosis: prescription.diagnosis,
      notes: prescription.notes,
      followUpDate: prescription.followUpDate ? prescription.followUpDate.toISOString().slice(0, 10) : null,
      followUpInstructions: null,
      tests: prescription.visit.labOrders.map((order) => order.testName),
      items: prescription.items,
    });
  }),
);

portal.get(
  '/:token/reports/:id/file',
  wrap(async (req, res) => {
    limitPortal(req.ip || 'unknown');
    const link = await openLink(req.params.token);
    const report = await prisma.labReport.findFirst({
      where: { id: req.params.id, patientId: link.patientId, clinicId: link.clinicId },
    });
    if (!report) throw new HttpError(404, 'Report not found');
    const file = await readStoredFile(report.storageKey);
    res.setHeader('Content-Type', report.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${safeDownloadName(report.fileName)}"`);
    res.send(file);
  }),
);

export const shareRoutes = staff;
export const portalRoutes = portal;
