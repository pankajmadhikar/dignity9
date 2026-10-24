import { Router } from 'express';
import { z } from 'zod';
import type { Role } from '@prisma/client';
import { audit, clientIp, hashPassword, HttpError, prisma } from '../../lib';
import { authed, parse, requireAuth, requireRole, wrap } from '../../middleware/auth';

const router = Router();
router.use(requireAuth);

router.get(
  '/doctors',
  wrap(async (req, res) => {
    const user = authed(req);
    const doctors = await prisma.user.findMany({
      where: { clinicId: user.clinicId, role: 'DOCTOR', isActive: true },
      select: { id: true, name: true, specialty: true },
      orderBy: { name: 'asc' },
    });
    res.json({ doctors });
  }),
);

router.get(
  '/users',
  requireRole('ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const users = await prisma.user.findMany({
      where: { clinicId: user.clinicId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        specialty: true,
        registrationNo: true,
        isActive: true,
        createdAt: true,
      },
    });
    res.json({ users });
  }),
);

router.post(
  '/users',
  requireRole('ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().email(),
        password: z.string().min(8, 'Use at least 8 characters'),
        role: z.enum(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB']),
        specialty: z.string().trim().max(120).optional().nullable(),
        registrationNo: z.string().trim().max(80).optional().nullable(),
      }),
      req.body,
    );
    const created = await prisma.user.create({
      data: {
        clinicId: user.clinicId,
        name: body.name,
        email: body.email.toLowerCase(),
        passwordHash: await hashPassword(body.password),
        role: body.role as Role,
        specialty: body.specialty || null,
        registrationNo: body.registrationNo || null,
      },
      select: { id: true, name: true, email: true, role: true, specialty: true, registrationNo: true, isActive: true },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'user.create',
      entityType: 'User',
      entityId: created.id,
      metadata: { role: created.role },
      ip: clientIp(req),
    });
    res.status(201).json({ user: created });
  }),
);

router.patch(
  '/users/:id',
  requireRole('ADMIN'),
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        name: z.string().trim().min(2).max(120).optional(),
        role: z.enum(['ADMIN', 'DOCTOR', 'RECEPTIONIST', 'LAB']).optional(),
        specialty: z.string().trim().max(120).optional().nullable(),
        registrationNo: z.string().trim().max(80).optional().nullable(),
        isActive: z.boolean().optional(),
        password: z.string().min(8).optional(),
      }),
      req.body,
    );
    const existing = await prisma.user.findFirst({ where: { id: req.params.id, clinicId: user.clinicId } });
    if (!existing) throw new HttpError(404, 'Staff member not found');
    if (existing.id === user.id && body.isActive === false) throw new HttpError(400, 'You cannot deactivate your own account');
    const updated = await prisma.user.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        role: body.role as Role | undefined,
        specialty: body.specialty,
        registrationNo: body.registrationNo,
        isActive: body.isActive,
        passwordHash: body.password ? await hashPassword(body.password) : undefined,
      },
      select: { id: true, name: true, email: true, role: true, specialty: true, registrationNo: true, isActive: true },
    });
    if (body.isActive === false || body.password) {
      await prisma.session.deleteMany({ where: { userId: existing.id } });
    }
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'user.update',
      entityType: 'User',
      entityId: existing.id,
      metadata: { isActive: updated.isActive, role: updated.role, passwordReset: Boolean(body.password) },
      ip: clientIp(req),
    });
    res.json({ user: updated });
  }),
);


export default router;
