import { Router } from 'express';
import { z } from 'zod';
import { addDays, ALERT_METRICS, clinicToday, dateFromYmd, zonedStart } from '../../utils/domain';
import { audit, clientIp, hashPassword, HttpError, prisma } from '../../lib';
import type { Role } from '@prisma/client';
import { authed, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get(
  '/clinic',
  wrap(async (req, res) => {
    const user = authed(req);
    const clinic = await prisma.clinic.findUnique({ where: { id: user.clinicId } });
    res.json({ clinic });
  }),
);

router.patch(
  '/clinic',
  requireRole('ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(160).optional(),
        address: z.string().trim().max(300).optional().nullable(),
        phone: z.string().trim().max(40).optional().nullable(),
        email: z.union([z.string().trim().email(), z.literal(''), z.null()]).optional(),
        registrationNo: z.string().trim().max(80).optional().nullable(),
        timezone: z.string().trim().min(3).max(80).optional(),
      }),
      req.body,
    );
    const clinic = await prisma.clinic.update({
      where: { id: user.clinicId },
      data: {
        ...body,
        email: body.email === '' ? null : body.email,
      },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'clinic.update',
      entityType: 'Clinic',
      entityId: clinic.id,
      ip: clientIp(req),
    });
    res.json({ clinic });
  }),
);

router.get(
  '/alert-rules',
  requireRole('DOCTOR', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const rules = await prisma.alertRule.findMany({ where: { clinicId: user.clinicId }, orderBy: { label: 'asc' } });
    res.json({ rules });
  }),
);

router.put(
  '/alert-rules',
  requireRole('DOCTOR', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        rules: z.array(
          z.object({
            id: z.string().optional(),
            metric: z.enum(ALERT_METRICS),
            operator: z.enum(['gte', 'gt', 'lte', 'lt']),
            threshold: z.number(),
            severity: z.enum(['INFO', 'MEDIUM', 'HIGH']),
            label: z.string().trim().min(2).max(120),
            isActive: z.boolean(),
          }),
        ),
      }),
      req.body,
    );
    const current = await prisma.alertRule.findMany({ where: { clinicId: user.clinicId } });
    const kept = new Set(body.rules.map((rule) => rule.id).filter(Boolean));
    await prisma.$transaction(async (tx) => {
      for (const rule of current) {
        if (!kept.has(rule.id)) {
          await tx.alertRule.update({ where: { id: rule.id }, data: { isActive: false } });
        }
      }
      for (const rule of body.rules) {
        if (rule.id) {
          const owned = current.find((item) => item.id === rule.id);
          if (!owned) throw new HttpError(404, 'Alert rule not found');
          await tx.alertRule.update({
            where: { id: rule.id },
            data: {
              metric: rule.metric,
              operator: rule.operator,
              threshold: rule.threshold,
              severity: rule.severity,
              label: rule.label,
              isActive: rule.isActive,
            },
          });
        } else {
          await tx.alertRule.create({ data: { clinicId: user.clinicId, ...rule } });
        }
      }
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'alert.rules',
      entityType: 'AlertRule',
      ip: clientIp(req),
    });
    const rules = await prisma.alertRule.findMany({ where: { clinicId: user.clinicId }, orderBy: { label: 'asc' } });
    res.json({ rules });
  }),
);

router.get(
  '/analytics',
  requireRole('ADMIN', 'DOCTOR'),
  wrap(async (req, res) => {
    const user = authed(req);
    res.json(await analytics(user.clinicId));
  }),
);

router.get(
  '/analytics/export.csv',
  requireRole('ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: user.clinicId } });
    const today = clinicToday(clinic.timezone);
    const entries = await prisma.queueEntry.findMany({
      where: { clinicId: user.clinicId, tokenDate: dateFromYmd(today) },
      include: { visit: { include: { patient: true } } },
      orderBy: { tokenNumber: 'asc' },
    });
    const lines = [
      'token,patient_code,patient_name,status,priority,registered_at,completed_at',
      ...entries.map((entry) =>
        [
          entry.tokenNumber,
          entry.visit.patient.patientCode,
          csv(entry.visit.patient.fullName),
          entry.status,
          entry.priority,
          entry.visit.createdAt.toISOString(),
          entry.completedAt?.toISOString() ?? '',
        ].join(','),
      ),
    ];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="queue-${today}.csv"`);
    res.send(lines.join('\n'));
  }),
);

function csv(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

async function analytics(clinicId: string) {
  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: clinicId } });
  const today = clinicToday(clinic.timezone);
  const start = zonedStart(today, clinic.timezone);
  const tomorrow = zonedStart(addDays(today, 1), clinic.timezone);
  const weekStart = zonedStart(addDays(today, -6), clinic.timezone);
  const monthStart = zonedStart(`${today.slice(0, 8)}01`, clinic.timezone);
  const [todayVisits, weekVisits, monthVisits, queue, pendingReports, overdueFollowUps] = await Promise.all([
    prisma.visit.findMany({
      where: { clinicId, createdAt: { gte: start, lt: tomorrow } },
      select: { patientId: true, createdAt: true },
    }),
    prisma.visit.count({ where: { clinicId, createdAt: { gte: weekStart, lt: tomorrow } } }),
    prisma.visit.count({ where: { clinicId, createdAt: { gte: monthStart, lt: tomorrow } } }),
    prisma.queueEntry.findMany({
      where: { clinicId, tokenDate: dateFromYmd(today) },
      include: { visit: { select: { createdAt: true } } },
    }),
    prisma.labReport.count({ where: { clinicId, reviewedAt: null } }),
    prisma.followUpTask.count({
      where: {
        clinicId,
        status: { in: ['PENDING', 'RESCHEDULED'] },
        dueDate: { lt: dateFromYmd(today) },
      },
    }),
  ]);
  const patientIds = [...new Set(todayVisits.map((visit) => visit.patientId))];
  const earlier = patientIds.length
    ? await prisma.visit.groupBy({
        by: ['patientId'],
        where: { clinicId, patientId: { in: patientIds }, createdAt: { lt: start } },
      })
    : [];
  const completed = queue.filter((entry) => entry.status === 'COMPLETED' && entry.startedAt);
  const waits = completed.map((entry) => (entry.startedAt!.getTime() - entry.visit.createdAt.getTime()) / 60000);
  return {
    date: today,
    visits: { today: todayVisits.length, week: weekVisits, month: monthVisits },
    patients: { newToday: patientIds.length - earlier.length, returningToday: earlier.length },
    queue: {
      completed: queue.filter((entry) => entry.status === 'COMPLETED').length,
      noShow: queue.filter((entry) => entry.status === 'NO_SHOW').length,
      cancelled: queue.filter((entry) => entry.status === 'CANCELLED').length,
      averageWaitMinutes: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : null,
    },
    pendingReports,
    overdueFollowUps,
    notifications: await notificationSummary(clinicId),
  };
}

async function notificationSummary(clinicId: string) {
  const rows = await prisma.notification.groupBy({
    by: ['status'],
    where: { clinicId },
    _count: { _all: true },
  });
  const count = (status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED') => rows.find((row) => row.status === status)?._count._all ?? 0;
  const sent = count('SENT');
  const failed = count('FAILED');
  const skipped = count('SKIPPED');
  const queued = count('QUEUED');
  return {
    tracked: true,
    sent,
    failed,
    skipped,
    queued,
    note: `Reminders are queued for WhatsApp or SMS. Sent ${sent}, failed ${failed}, skipped ${skipped}, waiting ${queued}.`,
  };
}

export default router;
