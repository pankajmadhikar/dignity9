import { Router } from 'express';
import { clinicToday, dateFromYmd, zonedStart, addDays } from '../../utils/domain';
import { prisma } from '../../lib';
import { authed, requireAuth, wrap } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  wrap(async (req, res) => {
    const user = authed(req);
    const clinic = await prisma.clinic.findUniqueOrThrow({ where: { id: user.clinicId } });
    const day = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : clinicToday(clinic.timezone);
    const appointments = await prisma.visit.findMany({
      where: {
        clinicId: user.clinicId,
        visitType: 'APPOINTMENT',
        createdAt: {
          gte: zonedStart(day, clinic.timezone),
          lt: zonedStart(addDays(day, 1), clinic.timezone),
        },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        patient: { select: { id: true, fullName: true, patientCode: true, mobile: true } },
        doctor: { select: { id: true, name: true } },
        queue: { select: { id: true, tokenNumber: true, status: true, priority: true } },
      },
    });
    res.json({ date: day, tokenDate: dateFromYmd(day), appointments });
  }),
);

export default router;
