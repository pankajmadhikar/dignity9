import { Router } from 'express';
import { z } from 'zod';
import { dateFromYmd } from '../../utils/domain';
import { audit, clientIp, HttpError, prisma } from '../../lib';
import { authed, canViewClinical, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get(
  '/tasks',
  wrap(async (req, res) => {
    const user = authed(req);
    const [followUps, reportReviews] = await Promise.all([
      prisma.followUpTask.findMany({
        where: { clinicId: user.clinicId, status: { in: ['PENDING', 'RESCHEDULED'] } },
        orderBy: { dueDate: 'asc' },
        include: { patient: { select: { id: true, fullName: true, patientCode: true, mobile: true } }, doctor: { select: { id: true, name: true } } },
      }),
      prisma.labReport.findMany({
        where: { clinicId: user.clinicId, reviewedAt: null },
        orderBy: { reportedAt: 'desc' },
        include: {
          patient: { select: { id: true, fullName: true, patientCode: true } },
          labOrder: { select: { testName: true } },
        },
      }),
    ]);
    res.json({
      followUps,
      reportReviews: canViewClinical(user.role) || user.role === 'LAB' ? reportReviews : reportReviews.map((report) => ({ ...report, notes: null })),
    });
  }),
);

router.patch(
  '/tasks/:id',
  requireRole('DOCTOR', 'RECEPTIONIST', 'ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        status: z.enum(['COMPLETED', 'RESCHEDULED', 'DECLINED', 'UNREACHABLE']),
        followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        reason: z.string().trim().max(500).optional(),
      }),
      req.body,
    );
    const task = await prisma.followUpTask.findFirst({ where: { id: req.params.id, clinicId: user.clinicId } });
    if (!task) throw new HttpError(404, 'Follow-up not found');
    if (body.status === 'RESCHEDULED' && !body.followUpDate) throw new HttpError(400, 'Choose the new follow-up date');
    const updated = await prisma.followUpTask.update({
      where: { id: task.id },
      data: {
        status: body.status,
        dueDate: body.followUpDate ? dateFromYmd(body.followUpDate) : undefined,
        resolvedAt: body.status === 'RESCHEDULED' ? null : new Date(),
        resolvedById: user.id,
      },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'task.update',
      entityType: 'FollowUpTask',
      entityId: task.id,
      metadata: { status: body.status, reason: body.reason ?? null },
      ip: clientIp(req),
    });
    res.json({ task: updated });
  }),
);


export default router;
