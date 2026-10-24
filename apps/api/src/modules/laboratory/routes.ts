import { Router } from 'express';
import { z } from 'zod';
import { audit, clientIp, HttpError, prisma } from '../../lib';
import { authed, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';
import { consultationBody } from '../../utils/schemas';
import { hashFile, sendStoredFile } from '../patients/routes';
import { upload } from '../documents/upload';
import { ownVisit } from '../consultations/shared';

const router = Router();
router.use(requireAuth);

router.get(
  '/labs',
  requireRole('DOCTOR', 'LAB', 'ADMIN', 'RECEPTIONIST'),
  wrap(async (req, res) => {
    const user = authed(req);
    const orders = await prisma.labOrder.findMany({
      where: { clinicId: user.clinicId, status: { notIn: ['CANCELLED', 'REVIEWED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        patient: { select: { id: true, fullName: true, patientCode: true, sex: true, ageYears: true, dateOfBirth: true } },
        reports: { include: { uploadedBy: { select: { name: true } } } },
        doctor: { select: { id: true, name: true } },
      },
    });
    res.json({ orders });
  }),
);

router.post(
  '/visits/:id/lab-orders',
  requireRole('DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(consultationBody.pick({ labTests: true }), req.body);
    const visit = await ownVisit(user.clinicId, req.params.id);
    if (!body.labTests?.length) throw new HttpError(400, 'Enter at least one test');
    const existing = new Set(visit.labOrders.map((order) => order.testName.toLowerCase()));
    const created = [];
    for (const testName of body.labTests) {
      if (existing.has(testName.toLowerCase())) continue;
      created.push(
        await prisma.labOrder.create({
          data: {
            clinicId: user.clinicId,
            patientId: visit.patientId,
            visitId: visit.id,
            doctorId: user.id,
            testName,
          },
        }),
      );
      existing.add(testName.toLowerCase());
    }
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'lab.order',
      entityType: 'Visit',
      entityId: visit.id,
      metadata: { tests: body.labTests },
      ip: clientIp(req),
    });
    res.status(201).json({ orders: created });
  }),
);

router.post(
  '/lab-orders/:id/report',
  requireRole('LAB', 'DOCTOR', 'ADMIN', 'RECEPTIONIST'),
  upload.single('file'),
  wrap(async (req, res) => {
    const user = authed(req);
    if (!req.file) throw new HttpError(400, 'Choose the report file');
    const order = await prisma.labOrder.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
    });
    if (!order) throw new HttpError(404, 'Lab order not found');
    if (order.status === 'CANCELLED') throw new HttpError(400, 'This order is cancelled');
    const contentHash = hashFile(req.file.path);
    const duplicate = await prisma.labReport.findFirst({
      where: { labOrderId: order.id, contentHash },
    });
    if (duplicate) throw new HttpError(409, 'This report was already uploaded for the order');
    const report = await prisma.labReport.create({
      data: {
        clinicId: user.clinicId,
        patientId: order.patientId,
        visitId: order.visitId,
        labOrderId: order.id,
        laboratory: typeof req.body.laboratory === 'string' ? req.body.laboratory.slice(0, 160) : null,
        fileName: req.file.originalname.slice(0, 180),
        storageKey: req.file.filename,
        mimeType: req.file.mimetype,
        notes: typeof req.body.notes === 'string' ? req.body.notes.slice(0, 1000) : null,
        uploadedById: user.id,
        contentHash,
      },
    });
    await prisma.labOrder.update({ where: { id: order.id }, data: { status: 'REPORT_AVAILABLE' } });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'lab.upload',
      entityType: 'LabReport',
      entityId: report.id,
      metadata: { patientId: order.patientId, labOrderId: order.id },
      ip: clientIp(req),
    });
    res.status(201).json({ report });
  }),
);

router.get(
  '/lab-reports/:id/file',
  wrap(async (req, res) => {
    const user = authed(req);
    const report = await prisma.labReport.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
    });
    if (!report) throw new HttpError(404, 'Report not found');
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'lab.view',
      entityType: 'LabReport',
      entityId: report.id,
      ip: clientIp(req),
    });
    await sendStoredFile(res, report.storageKey, report.mimeType, report.fileName);
  }),
);

router.post(
  '/lab-reports/:id/review',
  requireRole('DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(z.object({ note: z.string().trim().max(2000).optional().nullable() }), req.body);
    const report = await prisma.labReport.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
    });
    if (!report) throw new HttpError(404, 'Report not found');
    const updated = await prisma.labReport.update({
      where: { id: report.id },
      data: { reviewedAt: new Date(), reviewedById: user.id, reviewNote: body.note ?? null },
    });
    if (report.labOrderId) {
      await prisma.labOrder.update({ where: { id: report.labOrderId }, data: { status: 'REVIEWED' } });
    }
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'lab.review',
      entityType: 'LabReport',
      entityId: report.id,
      metadata: { patientId: report.patientId },
      ip: clientIp(req),
    });
    res.json({ report: updated });
  }),
);


export default router;
