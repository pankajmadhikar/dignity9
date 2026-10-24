import { Router } from 'express';
import { z } from 'zod';
import type { Prisma, Priority, QueueStatus, RecordSource, VisitType } from '@prisma/client';
import {
  bmi,
  clinicToday,
  dateFromYmd,
  fahrenheitToCelsius,
  sortQueue,
  vitalError,
  zonedStart,
} from '../../utils/domain';
import { audit, clientIp, emitQueue, HttpError, persistVitalAlerts, prisma } from '../../lib';
import { authed, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';
import { vitalBody } from '../vitals/schema';

const router = Router();
router.use(requireAuth);

const queueInclude = {
  visit: {
    include: {
      patient: {
        select: {
          id: true,
          patientCode: true,
          fullName: true,
          sex: true,
          dateOfBirth: true,
          ageYears: true,
          mobile: true,
          allergies: true,
        },
      },
      doctor: { select: { id: true, name: true } },
      vitals: {
        orderBy: { recordedAt: 'desc' as const },
        take: 1,
        include: { recordedBy: { select: { id: true, name: true } } },
      },
    },
  },
} satisfies Prisma.QueueEntryInclude;

function presentQueue<T extends { priority: 'EMERGENCY' | 'NORMAL'; position: number }>(entries: T[]) {
  return sortQueue(entries);
}

async function clinicDay(clinicId: string, now = new Date()) {
  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { timezone: true } });
  const timeZone = clinic?.timezone || 'Asia/Kolkata';
  const ymd = clinicToday(timeZone, now);
  return { timeZone, ymd, tokenDate: dateFromYmd(ymd), dayStart: zonedStart(ymd, timeZone) };
}

export async function loadQueue(clinicId: string, ymd?: string) {
  const day = await clinicDay(clinicId);
  const tokenDate = ymd ? dateFromYmd(ymd) : day.tokenDate;
  const entries = await prisma.queueEntry.findMany({
    where: { clinicId, tokenDate },
    include: queueInclude,
    orderBy: { position: 'asc' },
  });
  return { date: ymd ?? day.ymd, entries: presentQueue(entries) };
}

router.get(
  '/',
  wrap(async (req, res) => {
    const user = authed(req);
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    res.json(await loadQueue(user.clinicId, date));
  }),
);

router.post(
  '/',
  requireRole('RECEPTIONIST', 'ADMIN', 'DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        patientId: z.string().min(1),
        chiefComplaint: z.string().trim().min(3, 'Enter the reason for the visit').max(500),
        visitType: z.enum(['WALK_IN', 'APPOINTMENT']).optional(),
        scheduledAt: z.string().datetime().optional().nullable(),
        doctorId: z.string().optional().nullable(),
        priority: z.enum(['NORMAL', 'EMERGENCY']).optional(),
        priorityReason: z.string().trim().max(300).optional().nullable(),
        visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        vitals: vitalBody.optional(),
      }),
      req.body,
    );
    if (body.priority === 'EMERGENCY' && !body.priorityReason) {
      throw new HttpError(400, 'Record why this visit is an emergency');
    }
    const complaintError = body.vitals ? vitalError(body.vitals) : null;
    if (complaintError) throw new HttpError(400, complaintError);

    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, clinicId: user.clinicId },
      select: { id: true },
    });
    if (!patient) throw new HttpError(404, 'Patient not found');

    let doctorId: string | null = null;
    if (body.doctorId) {
      const doctor = await prisma.user.findFirst({
        where: { id: body.doctorId, clinicId: user.clinicId, role: 'DOCTOR', isActive: true },
      });
      if (!doctor) throw new HttpError(400, 'Choose a doctor from this clinic');
      doctorId = doctor.id;
    }

    const open = await prisma.queueEntry.findFirst({
      where: {
        clinicId: user.clinicId,
        status: { in: ['REGISTERED', 'WAITING', 'CALLED', 'IN_CONSULTATION'] },
        visit: { patientId: patient.id },
      },
    });
    if (open) throw new HttpError(409, 'This patient is already in an open queue');

    const day = await clinicDay(user.clinicId);
    const tokenDate = body.visitDate ? dateFromYmd(body.visitDate) : day.tokenDate;
    const created = await prisma.$transaction(async (tx) => {
      const last = await tx.queueEntry.aggregate({
        where: { clinicId: user.clinicId, tokenDate },
        _max: { tokenNumber: true, position: true },
      });
      const visit = await tx.visit.create({
        data: {
          clinicId: user.clinicId,
          patientId: patient.id,
          doctorId,
          visitType: (body.visitType ?? 'WALK_IN') as VisitType,
          chiefComplaint: body.chiefComplaint,
          scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
        },
      });
      let vitalId: string | null = null;
      if (body.vitals && hasMeasurement(body.vitals)) {
        const temperatureC = body.vitals.temperatureF == null ? null : fahrenheitToCelsius(body.vitals.temperatureF);
        const vital = await tx.vital.create({
          data: {
            visitId: visit.id,
            systolic: body.vitals.systolic ?? null,
            diastolic: body.vitals.diastolic ?? null,
            glucose: body.vitals.glucose ?? null,
            glucoseType: body.vitals.glucoseType ?? null,
            weightKg: body.vitals.weightKg ?? null,
            heightCm: body.vitals.heightCm ?? null,
            bmi: bmi(body.vitals.weightKg, body.vitals.heightCm),
            temperatureC,
            spo2: body.vitals.spo2 ?? null,
            pulse: body.vitals.pulse ?? null,
            source: (body.vitals.source ?? 'STAFF') as RecordSource,
            notes: body.vitals.notes ?? null,
            recordedById: user.id,
          },
        });
        vitalId = vital.id;
        await persistVitalAlerts(tx, {
          clinicId: user.clinicId,
          patientId: patient.id,
          visitId: visit.id,
          vitalId: vital.id,
          reading: {
            systolic: vital.systolic,
            diastolic: vital.diastolic,
            glucose: vital.glucose,
            temperatureC: vital.temperatureC,
            spo2: vital.spo2,
            pulse: vital.pulse,
          },
        });
      }
      const entry = await tx.queueEntry.create({
        data: {
          clinicId: user.clinicId,
          visitId: visit.id,
          tokenNumber: (last._max.tokenNumber ?? 0) + 1,
          tokenDate,
          position: (last._max.position ?? 0) + 1,
          status: 'WAITING',
          priority: (body.priority ?? 'NORMAL') as Priority,
          priorityReason: body.priorityReason ?? null,
        },
        include: queueInclude,
      });
      await audit(tx, {
        clinicId: user.clinicId,
        userId: user.id,
        action: 'visit.create',
        entityType: 'Visit',
        entityId: visit.id,
        metadata: { tokenNumber: entry.tokenNumber, vitalId, patientId: patient.id },
        ip: clientIp(req),
      });
      return entry;
    });

    emitQueue(req.app, user.clinicId);
    res.status(201).json({ entry: created });
  }),
);

router.patch(
  '/:id',
  requireRole('RECEPTIONIST', 'DOCTOR', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        status: z.enum(['WAITING', 'CANCELLED', 'NO_SHOW']).optional(),
        priority: z.enum(['NORMAL', 'EMERGENCY']).optional(),
        priorityReason: z.string().trim().max(300).optional().nullable(),
        statusNote: z.string().trim().max(300).optional().nullable(),
        reason: z.string().trim().min(3, 'Add a short reason for this queue change'),
      }),
      req.body,
    );
    const entry = await prisma.queueEntry.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
      include: { visit: true },
    });
    if (!entry) throw new HttpError(404, 'Queue entry not found');
    if (body.priority === 'EMERGENCY' && !body.priorityReason && !entry.priorityReason) {
      throw new HttpError(400, 'Record why this visit is an emergency');
    }
    if (body.status === 'WAITING' && !['NO_SHOW', 'CANCELLED', 'CALLED', 'IN_CONSULTATION'].includes(entry.status)) {
      throw new HttpError(400, 'This visit cannot be returned to the waiting list');
    }
    if (body.status && entry.status === 'COMPLETED') {
      throw new HttpError(400, 'This visit is already complete');
    }

    const updated = await prisma.queueEntry.update({
      where: { id: entry.id },
      data: {
        status: (body.status as QueueStatus | undefined) ?? undefined,
        priority: (body.priority as Priority | undefined) ?? undefined,
        priorityReason: body.priorityReason === undefined ? undefined : body.priorityReason,
        statusNote: body.statusNote === undefined ? undefined : body.statusNote,
        calledAt: body.status === 'WAITING' ? null : undefined,
        startedAt: body.status === 'WAITING' ? null : undefined,
      },
      include: queueInclude,
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'queue.update',
      entityType: 'QueueEntry',
      entityId: entry.id,
      metadata: { reason: body.reason, from: entry.status, to: updated.status, priority: updated.priority },
      ip: clientIp(req),
    });
    emitQueue(req.app, user.clinicId);
    res.json({ entry: updated });
  }),
);

router.post(
  '/:id/reorder',
  requireRole('RECEPTIONIST', 'DOCTOR', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        direction: z.enum(['up', 'down']),
        reason: z.string().trim().min(3, 'Add a short reason for the queue change'),
      }),
      req.body,
    );
    const day = await clinicDay(user.clinicId);
    const entries = presentQueue(
      await prisma.queueEntry.findMany({
        where: {
          clinicId: user.clinicId,
          tokenDate: day.tokenDate,
          status: { in: ['REGISTERED', 'WAITING', 'CALLED'] },
        },
      }),
    );
    const index = entries.findIndex((entry) => entry.id === req.params.id);
    if (index < 0) throw new HttpError(404, 'Only a waiting patient can be reordered');
    const swapWith = body.direction === 'up' ? index - 1 : index + 1;
    const neighbor = entries[swapWith];
    if (!neighbor || neighbor.priority !== entries[index].priority) {
      throw new HttpError(400, 'There is no neighbouring patient in the same priority group');
    }
    await prisma.$transaction([
      prisma.queueEntry.update({ where: { id: entries[index].id }, data: { position: neighbor.position } }),
      prisma.queueEntry.update({ where: { id: neighbor.id }, data: { position: entries[index].position } }),
    ]);
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'queue.reorder',
      entityType: 'QueueEntry',
      entityId: entries[index].id,
      metadata: { reason: body.reason, direction: body.direction, swappedWith: neighbor.id },
      ip: clientIp(req),
    });
    emitQueue(req.app, user.clinicId);
    res.json(await loadQueue(user.clinicId));
  }),
);

router.post(
  '/call-next',
  requireRole('DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const day = await clinicDay(user.clinicId);
    const busy = await prisma.queueEntry.findFirst({
      where: {
        clinicId: user.clinicId,
        status: { in: ['CALLED', 'IN_CONSULTATION'] },
        visit: { doctorId: user.id },
      },
    });
    if (busy) throw new HttpError(409, 'Finish or return the current patient before calling the next one');

    const waiting = presentQueue(
      await prisma.queueEntry.findMany({
        where: {
          clinicId: user.clinicId,
          tokenDate: day.tokenDate,
          status: { in: ['WAITING', 'REGISTERED'] },
          OR: [{ visit: { doctorId: null } }, { visit: { doctorId: user.id } }],
        },
        include: queueInclude,
      }),
    );
    const next = waiting[0];
    if (!next) throw new HttpError(404, 'No patients are waiting');

    const entry = await prisma.queueEntry.update({
      where: { id: next.id },
      data: {
        status: 'CALLED',
        calledAt: new Date(),
        visit: { update: { doctorId: user.id } },
      },
      include: queueInclude,
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'queue.call',
      entityType: 'QueueEntry',
      entityId: entry.id,
      ip: clientIp(req),
    });
    emitQueue(req.app, user.clinicId);
    res.json({ entry });
  }),
);

router.post(
  '/:id/start',
  requireRole('DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const entry = await prisma.queueEntry.findFirst({
      where: { id: req.params.id, clinicId: user.clinicId },
      include: { visit: true },
    });
    if (!entry) throw new HttpError(404, 'Queue entry not found');
    if (entry.visit.doctorId && entry.visit.doctorId !== user.id) {
      throw new HttpError(403, 'Another doctor is assigned to this patient');
    }
    if (!['WAITING', 'REGISTERED', 'CALLED', 'IN_CONSULTATION'].includes(entry.status)) {
      throw new HttpError(400, 'This visit is not open for consultation');
    }
    const other = await prisma.queueEntry.findFirst({
      where: {
        clinicId: user.clinicId,
        id: { not: entry.id },
        status: 'IN_CONSULTATION',
        visit: { doctorId: user.id },
      },
    });
    if (other) throw new HttpError(409, 'Finish the current consultation before starting another');

    const updated = await prisma.queueEntry.update({
      where: { id: entry.id },
      data: {
        status: 'IN_CONSULTATION',
        calledAt: entry.calledAt ?? new Date(),
        startedAt: entry.startedAt ?? new Date(),
        visit: { update: { doctorId: user.id } },
      },
      include: queueInclude,
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'queue.start',
      entityType: 'QueueEntry',
      entityId: entry.id,
      ip: clientIp(req),
    });
    emitQueue(req.app, user.clinicId);
    res.json({ entry: updated });
  }),
);

function hasMeasurement(vital: {
  systolic?: number | null;
  diastolic?: number | null;
  glucose?: number | null;
  weightKg?: number | null;
  heightCm?: number | null;
  temperatureF?: number | null;
  spo2?: number | null;
  pulse?: number | null;
}) {
  return [
    vital.systolic,
    vital.diastolic,
    vital.glucose,
    vital.weightKg,
    vital.heightCm,
    vital.temperatureF,
    vital.spo2,
    vital.pulse,
  ].some((value) => value != null);
}

export default router;
