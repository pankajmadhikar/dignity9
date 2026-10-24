import { createHash, randomBytes } from 'crypto';
import type { Request } from 'express';
import bcrypt from 'bcryptjs';
import { Prisma, PrismaClient, type Role } from '@prisma/client';
import { alertMessage, evaluateAlerts, type VitalReading } from './utils/domain';
import { HttpError } from './utils/errors';

export const prisma = new PrismaClient();

export { ensureStorage, storageDir, resolveStorageFile } from './integrations/storage';
export { HttpError };

export const SESSION_COOKIE = 'dignity_session';
export const SESSION_HOURS = 12;

export type AuthUser = {
  id: string;
  clinicId: string;
  role: Role;
  name: string;
  email: string;
  specialty: string | null;
  registrationNo: string | null;
};

export type Db = Prisma.TransactionClient | PrismaClient;

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken() {
  return randomBytes(32).toString('base64url');
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function checkPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function readCookie(header: string | undefined, name: string) {
  if (!header) return null;
  for (const part of header.split(/; */)) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

export async function userFromToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  if (!session.user.isActive) return null;
  return toAuthUser(session.user);
}

export function toAuthUser(user: {
  id: string;
  clinicId: string;
  role: Role;
  name: string;
  email: string;
  specialty: string | null;
  registrationNo: string | null;
}): AuthUser {
  return {
    id: user.id,
    clinicId: user.clinicId,
    role: user.role,
    name: user.name,
    email: user.email,
    specialty: user.specialty,
    registrationNo: user.registrationNo,
  };
}

export async function audit(
  db: Db,
  input: {
    clinicId: string;
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string | null;
    metadata?: Prisma.InputJsonValue;
    ip?: string | null;
  },
) {
  await db.auditLog.create({
    data: {
      clinicId: input.clinicId,
      userId: input.userId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata: input.metadata === undefined ? undefined : (JSON.parse(JSON.stringify(input.metadata)) as Prisma.InputJsonValue),
      ip: input.ip ?? null,
    },
  });
}

export function clientIp(req: Request) {
  return req.ip || null;
}

export function emitQueue(app: { get(name: string): unknown }, clinicId: string) {
  const io = app.get('io') as { to(room: string): { emit(event: string, payload: unknown): void } } | undefined;
  io?.to(`clinic:${clinicId}`).emit('queue:updated', { at: new Date().toISOString() });
}

export async function nextPatientCode(db: Db, clinicId: string) {
  const latest = await db.patient.findFirst({
    where: { clinicId },
    orderBy: { patientCode: 'desc' },
    select: { patientCode: true },
  });
  const current = latest ? Number(latest.patientCode.replace(/\D/g, '')) : 0;
  return `DG-${String(current + 1).padStart(5, '0')}`;
}

export async function persistVitalAlerts(
  db: Db,
  input: {
    clinicId: string;
    patientId: string;
    visitId: string;
    vitalId: string;
    reading: VitalReading;
  },
) {
  const rules = await db.alertRule.findMany({ where: { clinicId: input.clinicId, isActive: true } });
  const hits = evaluateAlerts(rules, input.reading);
  const created = [];
  for (const hit of hits) {
    created.push(
      await db.clinicalAlert.create({
        data: {
          clinicId: input.clinicId,
          patientId: input.patientId,
          visitId: input.visitId,
          vitalId: input.vitalId,
          ruleId: hit.rule.id,
          metric: hit.rule.metric,
          value: hit.value,
          units: hit.units,
          severity: hit.rule.severity,
          message: alertMessage(hit.rule.label, hit.value, hit.units),
        },
      }),
    );
  }
  return created;
}

export function safeDownloadName(name: string) {
  return name.replace(/[^\w.\- ()]/g, '_').slice(0, 120) || 'document';
}

const loginHits = new Map<string, { count: number; reset: number }>();

export function assertLoginAllowed(key: string) {
  if (process.env.NODE_ENV === 'test') return;
  const now = Date.now();
  const current = loginHits.get(key);
  if (!current || current.reset < now) {
    loginHits.set(key, { count: 1, reset: now + 60_000 });
    return;
  }
  current.count += 1;
  if (current.count > 10) throw new HttpError(429, 'Too many sign-in attempts. Wait a minute and try again.');
}
