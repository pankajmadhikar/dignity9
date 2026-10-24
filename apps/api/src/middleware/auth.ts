import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { z, type ZodTypeAny } from 'zod';
import { HttpError, readCookie, SESSION_COOKIE, userFromToken, type AuthUser } from '../lib';

export type AuthedRequest = Request & { user: AuthUser };

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? 'Check the form', result.error.flatten());
  }
  return result.data;
}

export function wrap(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const user = await userFromToken(token);
    if (!user) return next(new HttpError(401, 'Sign in required'));
    (req as AuthedRequest).user = user;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const user = (req as AuthedRequest).user;
    if (!user) return next(new HttpError(401, 'Sign in required'));
    if (!roles.includes(user.role)) return next(new HttpError(403, 'You do not have access to this action'));
    next();
  };
}

export function authed(req: Request) {
  const user = (req as AuthedRequest).user;
  if (!user) throw new HttpError(401, 'Sign in required');
  return user;
}

export function canViewClinical(role: Role) {
  return role === 'DOCTOR' || role === 'ADMIN';
}
