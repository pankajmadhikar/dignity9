import { Router } from 'express';
import type { Prisma, Role, Sex } from '@prisma/client';
import { createHash } from 'crypto';
import fs from 'fs';
import { ageFromDob, dateFromYmd, normalizeMobile } from '../../utils/domain';
import { audit, clientIp, HttpError, nextPatientCode, prisma, safeDownloadName } from '../../lib';
import { readStoredFile } from '../../integrations/storage';
import { authed, canViewClinical, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';
import { patientBody } from '../../utils/schemas';
import { upload } from '../documents/upload';

const router = Router();
router.use(requireAuth);

router.get(
  '/documents/:documentId/file',
  wrap(async (req, res) => {
    const user = authed(req);
    const document = await prisma.document.findFirst({
      where: { id: req.params.documentId, clinicId: user.clinicId },
    });
    if (!document) throw new HttpError(404, 'Document not found');
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'document.view',
      entityType: 'Document',
      entityId: document.id,
      ip: clientIp(req),
    });
    await sendStoredFile(res, document.storageKey, document.mimeType, document.fileName);
  }),
);

const patientSelect = {
  id: true,
  patientCode: true,
  fullName: true,
  dateOfBirth: true,
  ageYears: true,
  sex: true,
  mobile: true,
  address: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  allergies: true,
  medicalHistory: true,
  consentWhatsapp: true,
  consentSms: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PatientSelect;

type PatientRow = Prisma.PatientGetPayload<{ select: typeof patientSelect }>;

export function presentPatient(patient: PatientRow, role: Role) {
  return {
    ...patient,
    ageYears: patient.dateOfBirth ? ageFromDob(patient.dateOfBirth) : patient.ageYears,
    medicalHistory: role === 'LAB' ? null : patient.medicalHistory,
  };
}

function duplicateCard(patient: PatientRow) {
  return {
    id: patient.id,
    patientCode: patient.patientCode,
    fullName: patient.fullName,
    mobile: patient.mobile,
    sex: patient.sex,
    dateOfBirth: patient.dateOfBirth,
    ageYears: patient.dateOfBirth ? ageFromDob(patient.dateOfBirth) : patient.ageYears,
  };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const user = authed(req);
    const q = String(req.query.q ?? '').trim();
    const mobile = normalizeMobile(q);
    const digits = q.replace(/\D/g, '');
    const patients = await prisma.patient.findMany({
      where: {
        clinicId: user.clinicId,
        ...(q
          ? {
              OR: [
                { fullName: { contains: q, mode: 'insensitive' } },
                { patientCode: { contains: q.toUpperCase(), mode: 'insensitive' } },
                ...(mobile ? [{ mobile }] : []),
                ...(digits.length >= 3 && !mobile ? [{ mobile: { contains: digits } }] : []),
              ],
            }
          : {}),
      },
      select: patientSelect,
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    res.json({ patients: patients.map((patient) => presentPatient(patient, user.role)) });
  }),
);

router.post(
  '/',
  requireRole('RECEPTIONIST', 'ADMIN', 'DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(patientBody, req.body);
    const mobile = normalizeMobile(body.mobile);
    if (!mobile) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number');
    const dateOfBirth = body.dateOfBirth ? dateFromYmd(body.dateOfBirth) : null;
    const ageYears = dateOfBirth ? null : (body.ageYears ?? null);
    if (!dateOfBirth && ageYears == null) throw new HttpError(400, 'Enter a date of birth or an age');

    const fullName = body.fullName.replace(/\s+/g, ' ').trim();
    const duplicates = await prisma.patient.findMany({
      where: {
        clinicId: user.clinicId,
        OR: [
          { mobile },
          ...(dateOfBirth
            ? [{ fullName: { equals: fullName, mode: 'insensitive' as const }, dateOfBirth }]
            : []),
        ],
      },
      select: patientSelect,
      take: 5,
    });
    if (duplicates.length && !body.confirmDuplicate) {
      throw new HttpError(409, 'A matching patient already exists. Open that profile or confirm a new record.', {
        duplicates: duplicates.map(duplicateCard),
      });
    }

    const patient = await prisma.$transaction(async (tx) => {
      const created = await tx.patient.create({
        data: {
          clinicId: user.clinicId,
          patientCode: await nextPatientCode(tx, user.clinicId),
          fullName,
          dateOfBirth,
          ageYears,
          sex: body.sex as Sex,
          mobile,
          address: body.address ?? null,
          emergencyContactName: body.emergencyContactName ?? null,
          emergencyContactPhone: body.emergencyContactPhone ?? null,
          allergies: body.allergies ?? null,
          medicalHistory: body.medicalHistory ?? null,
          consentWhatsapp: body.consentWhatsapp ?? false,
          consentSms: body.consentSms ?? false,
        },
        select: patientSelect,
      });
      await audit(tx, {
        clinicId: user.clinicId,
        userId: user.id,
        action: 'patient.create',
        entityType: 'Patient',
        entityId: created.id,
        metadata: { patientCode: created.patientCode },
        ip: clientIp(req),
      });
      return created;
    });

    res.status(201).json({ patient: presentPatient(patient, user.role) });
  }),
);

router.get(
  '/:id',
  wrap(async (req, res) => {
    const user = authed(req);
    const patient = await prisma.patient.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
      select: patientSelect,
    });
    if (!patient) throw new HttpError(404, 'Patient not found');

    const clinical = canViewClinical(user.role);
    const [visits, documents, labOrders, followUps, alerts] = await Promise.all([
      prisma.visit.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          doctor: { select: { id: true, name: true } },
          queue: { select: { status: true, tokenNumber: true, priority: true } },
          consultation: { select: { diagnosis: true, status: true, symptoms: true, treatmentPlan: true } },
        },
      }),
      prisma.document.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId },
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
      }),
      prisma.labOrder.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId },
        orderBy: { createdAt: 'desc' },
        include: {
          reports: {
            select: {
              id: true,
              fileName: true,
              mimeType: true,
              laboratory: true,
              reportedAt: true,
              reviewedAt: true,
              reviewNote: clinical || user.role === 'LAB' ? true : false,
            },
          },
        },
      }),
      prisma.followUpTask.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId },
        orderBy: { dueDate: 'desc' },
        take: 20,
      }),
      prisma.clinicalAlert.findMany({
        where: { patientId: patient.id, clinicId: user.clinicId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'patient.view',
      entityType: 'Patient',
      entityId: patient.id,
      ip: clientIp(req),
    });

    res.json({
      access: clinical ? 'clinical' : user.role === 'LAB' ? 'laboratory' : 'operational',
      patient: presentPatient(patient, user.role),
      visits: visits.map((visit) => ({
        id: visit.id,
        createdAt: visit.createdAt,
        completedAt: visit.completedAt,
        visitType: visit.visitType,
        chiefComplaint: visit.chiefComplaint,
        doctor: visit.doctor,
        queue: visit.queue,
        diagnosis: clinical ? visit.consultation?.diagnosis ?? null : null,
        consultationStatus: clinical ? visit.consultation?.status ?? null : null,
      })),
      documents,
      labOrders,
      followUps: clinical || user.role === 'RECEPTIONIST' ? followUps : [],
      alerts,
    });
  }),
);

router.patch(
  '/:id',
  requireRole('RECEPTIONIST', 'ADMIN', 'DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(patientBody.partial(), req.body);
    const existing = await prisma.patient.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
      select: patientSelect,
    });
    if (!existing) throw new HttpError(404, 'Patient not found');

    const data: Prisma.PatientUpdateInput = {};
    if (body.fullName) data.fullName = body.fullName.replace(/\s+/g, ' ').trim();
    if (body.sex) data.sex = body.sex;
    if (body.mobile) {
      const mobile = normalizeMobile(body.mobile);
      if (!mobile) throw new HttpError(400, 'Enter a valid 10-digit Indian mobile number');
      data.mobile = mobile;
    }
    if (body.dateOfBirth !== undefined) {
      data.dateOfBirth = body.dateOfBirth ? dateFromYmd(body.dateOfBirth) : null;
      if (body.dateOfBirth) data.ageYears = null;
    }
    if (body.ageYears !== undefined && body.dateOfBirth === undefined) data.ageYears = body.ageYears;
    for (const key of ['address', 'emergencyContactName', 'emergencyContactPhone', 'allergies'] as const) {
      if (body[key] !== undefined) data[key] = body[key];
    }
    if (body.medicalHistory !== undefined) data.medicalHistory = body.medicalHistory;
    if (body.consentWhatsapp !== undefined) data.consentWhatsapp = body.consentWhatsapp;
    if (body.consentSms !== undefined) data.consentSms = body.consentSms;

    const updated = await prisma.patient.update({
      where: { id: existing.id },
      data,
      select: patientSelect,
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'patient.update',
      entityType: 'Patient',
      entityId: existing.id,
      metadata: { before: existing, after: updated },
      ip: clientIp(req),
    });
    res.json({ patient: presentPatient(updated, user.role) });
  }),
);

router.post(
  '/:id/documents',
  requireRole('RECEPTIONIST', 'DOCTOR', 'ADMIN', 'LAB'),
  upload.single('file'),
  wrap(async (req, res) => {
    const user = authed(req);
    if (!req.file) throw new HttpError(400, 'Choose a file to upload');
    const patient = await prisma.patient.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
      select: { id: true },
    });
    if (!patient) throw new HttpError(404, 'Patient not found');
    const visitId = typeof req.body.visitId === 'string' && req.body.visitId ? req.body.visitId : null;
    if (visitId) {
      const visit = await prisma.visit.findFirst({ where: { id: visitId, patientId: patient.id, clinicId: user.clinicId } });
      if (!visit) throw new HttpError(400, 'That visit does not belong to this patient');
    }
    const docType = String(req.body.docType || 'OTHER').slice(0, 40);
    const document = await prisma.document.create({
      data: {
        clinicId: user.clinicId,
        patientId: patient.id,
        visitId,
        docType,
        fileName: req.file.originalname.slice(0, 180),
        storageKey: req.file.filename,
        mimeType: req.file.mimetype,
        uploadedById: user.id,
      },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'document.upload',
      entityType: 'Document',
      entityId: document.id,
      metadata: { patientId: patient.id, docType },
      ip: clientIp(req),
    });
    res.status(201).json({ document });
  }),
);

export async function sendStoredFile(
  res: import('express').Response,
  storageKey: string,
  mimeType: string,
  fileName: string,
) {
  let file: Buffer;
  try {
    file = await readStoredFile(storageKey);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(404, 'File is no longer available');
  }
  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Disposition', `inline; filename="${safeDownloadName(fileName)}"`);
  res.send(file);
}

export function hashFile(filePath: string) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

export default router;
