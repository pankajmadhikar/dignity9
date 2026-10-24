import { Router } from 'express';
import { z } from 'zod';
import {
  assertLoginAllowed,
  audit,
  checkPassword,
  clientIp,
  hashPassword,
  hashToken,
  HttpError,
  newSessionToken,
  prisma,
  SESSION_COOKIE,
  SESSION_HOURS,
  toAuthUser,
} from '../../lib';
import { authed, parse, requireAuth, wrap } from '../../middleware/auth';

const router = Router();

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_HOURS * 60 * 60 * 1000,
    path: '/',
  };
}

router.post(
  '/login',
  wrap(async (req, res) => {
    assertLoginAllowed(clientIp(req) || 'local');
    const body = parse(
      z.object({
        email: z.string().trim().email('Enter a valid email'),
        password: z.string().min(1, 'Enter the password'),
      }),
      req.body,
    );
    const email = body.email.toLowerCase();
    const user = await prisma.user.findUnique({ where: { email } });
    const valid = user ? await checkPassword(body.password, user.passwordHash) : false;
    if (!user || !user.isActive || !valid) throw new HttpError(401, 'Email or password is incorrect');

    const token = newSessionToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + SESSION_HOURS * 60 * 60 * 1000),
      },
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ip: clientIp(req),
    });
    res.cookie(SESSION_COOKIE, token, cookieOptions());
    res.json({ user: toAuthUser(user) });
  }),
);

router.post(
  '/logout',
  requireAuth,
  wrap(async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  wrap(async (req, res) => {
    const user = authed(req);
    const clinic = await prisma.clinic.findUnique({
      where: { id: user.clinicId },
      select: { id: true, name: true, timezone: true, phone: true, address: true, email: true, registrationNo: true },
    });
    res.json({ user, clinic });
  }),
);

router.post(
  '/password',
  requireAuth,
  wrap(async (req, res) => {
    const user = authed(req);
    const body = parse(
      z.object({
        current: z.string().min(1, 'Enter the current password'),
        next: z.string().min(8, 'Use at least 8 characters'),
      }),
      req.body,
    );
    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await checkPassword(body.current, record.passwordHash))) {
      throw new HttpError(400, 'Current password is incorrect');
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(body.next) } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'auth.password',
      entityType: 'User',
      entityId: user.id,
      ip: clientIp(req),
    });
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.status(204).end();
  }),
);

export default router;
