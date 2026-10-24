import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { Prisma } from '@prisma/client';
import multer from 'multer';
import * as Sentry from '@sentry/node';
import { env } from './config/env';
import { HttpError } from './lib';
import { logger } from './utils/logger';
import authRoutes from './modules/auth/routes';
import patientRoutes from './modules/patients/routes';
import queueRoutes from './modules/queue/routes';
import consultationRoutes from './modules/consultations/routes';
import prescriptionRoutes from './modules/prescriptions/routes';
import laboratoryRoutes from './modules/laboratory/routes';
import followUpRoutes from './modules/follow-ups/routes';
import clinicRoutes from './modules/clinics/routes';
import userRoutes from './modules/users/routes';
import auditRoutes from './modules/audit/routes';
import appointmentRoutes from './modules/appointments/routes';
import notificationRoutes from './modules/notifications/routes';
import docsRoutes from './modules/docs/routes';
import { portalRoutes, shareRoutes } from './modules/documents/portal';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(cors({ origin: [env.WEB_ORIGIN], credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.use('/api', docsRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/patients', patientRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api/appointments', appointmentRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/portal', portalRoutes);
  app.use('/api', consultationRoutes);
  app.use('/api', prescriptionRoutes);
  app.use('/api', laboratoryRoutes);
  app.use('/api', followUpRoutes);
  app.use('/api', shareRoutes);
  app.use('/api', clinicRoutes);
  app.use('/api', userRoutes);
  app.use('/api', auditRoutes);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ error: 'This record already exists' });
      return;
    }
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? 'File must be under 10 MB' : error.message;
      res.status(400).json({ error: message });
      return;
    }
    if (error instanceof Error && error.message === 'Upload a PDF or image file') {
      res.status(400).json({ error: error.message });
      return;
    }
    if (env.SENTRY_DSN) Sentry.captureException(error);
    logger.error({ err: error }, 'Request failed');
    res.status(500).json({ error: 'Something went wrong' });
  });

  return app;
}
