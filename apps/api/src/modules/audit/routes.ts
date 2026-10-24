import { Router } from 'express';
import { prisma } from '../../lib';
import { authed, requireAuth, requireRole, wrap } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get(
  '/audit',
  requireRole('ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const logs = await prisma.auditLog.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json({ logs });
  }),
);


export default router;
