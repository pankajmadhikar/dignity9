import { Router } from 'express';
import { prisma } from '../../lib';
import { authed, requireAuth, requireRole, wrap } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  requireRole('ADMIN', 'DOCTOR', 'RECEPTIONIST'),
  wrap(async (req, res) => {
    const user = authed(req);
    const notifications = await prisma.notification.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        channel: true,
        template: true,
        status: true,
        error: true,
        createdAt: true,
        patient: { select: { id: true, fullName: true, patientCode: true } },
      },
    });
    res.json({ notifications });
  }),
);

export default router;
