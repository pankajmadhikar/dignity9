import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { clinicToday, dateFromYmd } from '../../utils/domain';
import { audit, clientIp, emitQueue, HttpError, prisma } from '../../lib';
import { scheduleFollowUpReminder } from '../../jobs/reminders';
import { authed, canViewClinical, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';
import { consultationBody } from '../../utils/schemas';
import { snapshot, ownVisit, assertDoctorOwns } from './shared';

const router = Router();
router.use(requireAuth);

router.get(
  '/dashboard',
  wrap(async (req, res) => {
    const user = authed(req);
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: user.clinicId } });
    const today = clinicToday(clinic.timezone);
    const tokenDate = dateFromYmd(today);
    const entries = await prisma.queueEntry.findMany({
      where: { clinicId: user.clinicId, tokenDate },
      include: {
        visit: {
          include: {
            patient: { select: { id: true, fullName: true, patientCode: true, sex: true, ageYears: true, dateOfBirth: true, mobile: true, allergies: true } },
            doctor: { select: { id: true, name: true } },
            vitals: { orderBy: { recordedAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    const count = (status: string) => entries.filter((entry) => entry.status === status).length;
    const active = entries.find(
      (entry) =>
        (entry.status === 'IN_CONSULTATION' || entry.status === 'CALLED') && entry.visit.doctorId === user.id,
    );
    const waiting = entries
      .filter((entry) => ['WAITING', 'REGISTERED'].includes(entry.status))
      .sort((a, b) => (a.priority === b.priority ? a.position - b.position : a.priority === 'EMERGENCY' ? -1 : 1));
    const [reportReviews, followUps, alerts] = await Promise.all([
      prisma.labReport.findMany({
        where: { clinicId: user.clinicId, reviewedAt: null },
        orderBy: { reportedAt: 'desc' },
        take: 20,
        include: {
          patient: { select: { id: true, fullName: true, patientCode: true } },
          labOrder: { select: { id: true, testName: true, status: true } },
        },
      }),
      prisma.followUpTask.findMany({
        where: {
          clinicId: user.clinicId,
          status: { in: ['PENDING', 'RESCHEDULED'] },
          dueDate: { lte: tokenDate },
        },
        orderBy: { dueDate: 'asc' },
        take: 20,
        include: { patient: { select: { id: true, fullName: true, patientCode: true, mobile: true } } },
      }),
      prisma.clinicalAlert.findMany({
        where: { clinicId: user.clinicId, state: { in: ['GENERATED', 'ACKNOWLEDGED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { patient: { select: { id: true, fullName: true, patientCode: true } } },
      }),
    ]);
    res.json({
      date: today,
      counts: {
        waiting: count('WAITING') + count('REGISTERED'),
        called: count('CALLED'),
        inConsultation: count('IN_CONSULTATION'),
        completed: count('COMPLETED'),
        noShow: count('NO_SHOW'),
        cancelled: count('CANCELLED'),
      },
      active: active ?? null,
      next: waiting[0] ?? null,
      waiting,
      reportReviews: canViewClinical(user.role) || user.role === 'LAB' ? reportReviews : [],
      followUps,
      alerts,
    });
  }),
);

router.get(
  '/visits/:id',
  wrap(async (req, res) => {
    const user = authed(req);
    const visit = await ownVisit(user.clinicId, req.params.id);
    const clinical = canViewClinical(user.role);
    const history = await prisma.visit.findMany({
      where: { clinicId: user.clinicId, patientId: visit.patientId, id: { not: visit.id } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        doctor: { select: { id: true, name: true } },
        consultation: true,
        vitals: { orderBy: { recordedAt: 'desc' }, take: 1 },
        prescriptions: {
          where: { status: 'APPROVED' },
          orderBy: { version: 'desc' },
          include: { items: { orderBy: { sortOrder: 'asc' } } },
        },
      },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'visit.view',
      entityType: 'Visit',
      entityId: visit.id,
      ip: clientIp(req),
    });
    const hideClinical = !clinical;
    res.json({
      access: clinical ? 'clinical' : user.role === 'LAB' ? 'laboratory' : 'operational',
      visit: {
        ...visit,
        patient: {
          ...visit.patient,
          medicalHistory: clinical ? visit.patient.medicalHistory : null,
        },
        consultation: hideClinical ? null : visit.consultation,
        prescriptions: hideClinical
          ? visit.prescriptions.map((prescription) => ({
              id: prescription.id,
              status: prescription.status,
              version: prescription.version,
              approvedAt: prescription.approvedAt,
            }))
          : visit.prescriptions,
        alerts: visit.alerts,
      },
      history: history.map((item) => ({
        id: item.id,
        createdAt: item.createdAt,
        chiefComplaint: item.chiefComplaint,
        doctor: item.doctor,
        vitals: item.vitals[0] ?? null,
        diagnosis: clinical ? item.consultation?.diagnosis ?? null : null,
        treatmentPlan: clinical ? item.consultation?.treatmentPlan ?? null : null,
        symptoms: clinical ? item.consultation?.symptoms ?? null : null,
        prescriptions: clinical ? item.prescriptions : [],
      })),
    });
  }),
);

router.put(
  '/visits/:id/consultation',
  requireRole('DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(consultationBody, req.body);
    const visit = await ownVisit(user.clinicId, req.params.id);
    assertDoctorOwns(user.id, visit.doctorId);
    if (visit.consultation?.status === 'FINALIZED') {
      throw new HttpError(400, 'This record is finalized. Save a correction with a reason instead.');
    }
    await saveConsultation(user, visit, body, false, clientIp(req));
    emitQueue(req.app, user.clinicId);
    res.json(await presentSaved(user.clinicId, visit.id));
  }),
);

router.post(
  '/visits/:id/finalize',
  requireRole('DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(consultationBody, req.body);
    const visit = await ownVisit(user.clinicId, req.params.id);
    assertDoctorOwns(user.id, visit.doctorId);
    if (visit.consultation?.status === 'FINALIZED' && !body.reason) {
      throw new HttpError(400, 'Add the reason for correcting this finalized record');
    }
    if (visit.consultation?.status !== 'FINALIZED') {
      const other = await prisma.queueEntry.findFirst({
        where: {
          clinicId: user.clinicId,
          status: 'IN_CONSULTATION',
          visit: { doctorId: user.id },
          ...(visit.queue ? { id: { not: visit.queue.id } } : {}),
        },
      });
      if (other) throw new HttpError(409, 'Finish the current consultation before completing another');
    }
    await saveConsultation(user, visit, body, true, clientIp(req));
    emitQueue(req.app, user.clinicId);
    res.json(await presentSaved(user.clinicId, visit.id));
  }),
);

async function presentSaved(clinicId: string, visitId: string) {
  const visit = await ownVisit(clinicId, visitId);
  return {
    visitId: visit.id,
    consultation: visit.consultation,
    prescriptions: visit.prescriptions,
    labOrders: visit.labOrders,
    queue: visit.queue,
  };
}

type ConsultInput = z.infer<typeof consultationBody>;
type VisitRecord = Awaited<ReturnType<typeof ownVisit>>;

async function saveConsultation(
  user: { id: string; clinicId: string },
  visit: VisitRecord,
  body: ConsultInput,
  finalize: boolean,
  ip: string | null,
) {
  const followUpDate = body.followUpDate ? dateFromYmd(body.followUpDate) : body.followUpDate === null ? null : undefined;
  await prisma.$transaction(async (tx) => {
    if (body.chiefComplaint !== undefined) {
      await tx.visit.update({
        where: { id: visit.id },
        data: { chiefComplaint: body.chiefComplaint, doctorId: user.id },
      });
    } else if (!visit.doctorId) {
      await tx.visit.update({ where: { id: visit.id }, data: { doctorId: user.id } });
    }

    const previous = visit.consultation;
    const data = {
      doctorId: user.id,
      symptoms: body.symptoms === undefined ? previous?.symptoms ?? null : body.symptoms,
      examination: body.examination === undefined ? previous?.examination ?? null : body.examination,
      diagnosis: body.diagnosis === undefined ? previous?.diagnosis ?? null : body.diagnosis,
      clinicalNotes: body.clinicalNotes === undefined ? previous?.clinicalNotes ?? null : body.clinicalNotes,
      treatmentPlan: body.treatmentPlan === undefined ? previous?.treatmentPlan ?? null : body.treatmentPlan,
      followUpInstructions:
        body.followUpInstructions === undefined ? previous?.followUpInstructions ?? null : body.followUpInstructions,
      followUpDate: followUpDate === undefined ? previous?.followUpDate ?? null : followUpDate,
      status: finalize ? 'FINALIZED' as const : 'DRAFT' as const,
      finalizedAt: finalize ? previous?.finalizedAt ?? new Date() : null,
      originalSnapshot:
        finalize && previous?.originalSnapshot
          ? (previous.originalSnapshot as Prisma.InputJsonValue)
          : finalize
            ? previous
              ? (snapshot(previous) as Prisma.InputJsonValue)
              : undefined
            : undefined,
    };

    const consultation = previous
      ? await tx.consultation.update({ where: { id: previous.id }, data })
      : await tx.consultation.create({ data: { visitId: visit.id, ...data } });

    if (finalize && previous?.status === 'FINALIZED') {
      await tx.amendment.create({
        data: {
          clinicId: user.clinicId,
          entityType: 'Consultation',
          entityId: consultation.id,
          reason: body.reason || 'Correction',
          before: snapshot(previous),
          after: snapshot(consultation),
          userId: user.id,
        },
      });
    }

    if (body.items || body.prescriptionNotes !== undefined || finalize) {
      const items = (body.items ?? []).map((item, index) => ({
        medicineName: item.medicineName,
        formulation: item.formulation ?? null,
        strength: item.strength ?? null,
        dosage: item.dosage ?? null,
        route: item.route ?? null,
        frequency: item.frequency ?? null,
        duration: item.duration ?? null,
        quantity: item.quantity ?? null,
        instructions: item.instructions ?? null,
        sortOrder: index,
      }));
      const latest = visit.prescriptions[0];
      const shared = {
        doctorId: user.id,
        diagnosis: data.diagnosis,
        notes: body.prescriptionNotes === undefined ? latest?.notes ?? null : body.prescriptionNotes,
        followUpDate: data.followUpDate,
      };
      const shouldWrite = finalize || items.length > 0 || Boolean(shared.notes) || latest;
      if (shouldWrite && !latest) {
        await tx.prescription.create({
          data: {
            visitId: visit.id,
            ...shared,
            status: finalize ? 'APPROVED' : 'DRAFT',
            version: 1,
            approvedAt: finalize ? new Date() : null,
            items: { create: items },
          },
        });
      } else if (shouldWrite && latest?.status === 'APPROVED' && finalize) {
        await tx.prescription.create({
          data: {
            visitId: visit.id,
            ...shared,
            status: 'APPROVED',
            version: latest.version + 1,
            approvedAt: new Date(),
            items: { create: items },
          },
        });
      } else if (shouldWrite && latest && latest.status === 'DRAFT') {
        await tx.prescriptionItem.deleteMany({ where: { prescriptionId: latest.id } });
        await tx.prescription.update({
          where: { id: latest.id },
          data: {
            ...shared,
            status: finalize ? 'APPROVED' : 'DRAFT',
            approvedAt: finalize ? new Date() : null,
            items: { create: items },
          },
        });
      }
    }

    if (finalize && body.labTests?.length) {
      const existing = await tx.labOrder.findMany({ where: { visitId: visit.id } });
      const have = new Set(existing.map((order) => order.testName.toLowerCase()));
      for (const testName of body.labTests) {
        if (have.has(testName.toLowerCase())) continue;
        await tx.labOrder.create({
          data: {
            clinicId: user.clinicId,
            patientId: visit.patientId,
            visitId: visit.id,
            doctorId: user.id,
            testName,
            status: 'ORDERED',
          },
        });
        have.add(testName.toLowerCase());
      }
    }

    if (finalize && data.followUpDate) {
      const openTask = await tx.followUpTask.findFirst({
        where: { visitId: visit.id, status: { in: ['PENDING', 'RESCHEDULED'] } },
      });
      if (openTask) {
        await tx.followUpTask.update({
          where: { id: openTask.id },
          data: { dueDate: data.followUpDate, instructions: data.followUpInstructions, doctorId: user.id },
        });
      } else {
        await tx.followUpTask.create({
          data: {
            clinicId: user.clinicId,
            patientId: visit.patientId,
            visitId: visit.id,
            doctorId: user.id,
            dueDate: data.followUpDate,
            instructions: data.followUpInstructions,
          },
        });
      }
    }

    if (finalize && previous?.status !== 'FINALIZED' && visit.queue && !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(visit.queue.status)) {
      await tx.queueEntry.update({
        where: { id: visit.queue.id },
        data: { status: 'COMPLETED', completedAt: new Date(), startedAt: visit.queue.startedAt ?? new Date() },
      });
      await tx.visit.update({ where: { id: visit.id }, data: { completedAt: new Date(), doctorId: user.id } });
    }

    await audit(tx, {
      clinicId: user.clinicId,
      userId: user.id,
      action: finalize ? (previous?.status === 'FINALIZED' ? 'consultation.amend' : 'consultation.finalize') : 'consultation.save',
      entityType: 'Consultation',
      entityId: consultation.id,
      metadata: { visitId: visit.id, reason: body.reason ?? null },
      ip,
    });
  });

  if (finalize && body.followUpDate) {
    const task = await prisma.followUpTask.findFirst({
      where: { visitId: visit.id, status: { in: ['PENDING', 'RESCHEDULED'] } },
      orderBy: { updatedAt: 'desc' },
    });
    if (task) await scheduleFollowUpReminder(task.id);
  }
}

router.post(
  '/alerts/:id/acknowledge',
  requireRole('DOCTOR', 'ADMIN', 'RECEPTIONIST'),
  wrap(async (req, res) => {
    const user = authed(req);
    const alert = await prisma.clinicalAlert.findFirst({ where: { id: req.params.id, clinicId: user.clinicId } });
    if (!alert) throw new HttpError(404, 'Alert not found');
    const updated = await prisma.clinicalAlert.update({
      where: { id: alert.id },
      data: { state: alert.state === 'RESOLVED' ? 'RESOLVED' : 'ACKNOWLEDGED', acknowledgedAt: new Date(), acknowledgedBy: user.id },
    });
    res.json({ alert: updated });
  }),
);

router.post(
  '/alerts/:id/resolve',
  requireRole('DOCTOR', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const alert = await prisma.clinicalAlert.findFirst({ where: { id: req.params.id, clinicId: user.clinicId } });
    if (!alert) throw new HttpError(404, 'Alert not found');
    const updated = await prisma.clinicalAlert.update({
      where: { id: alert.id },
      data: { state: 'RESOLVED', resolvedAt: new Date(), resolvedBy: user.id },
    });
    res.json({ alert: updated });
  }),
);

export default router;
