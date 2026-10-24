import 'dotenv/config';
import http from 'http';
import * as Sentry from '@sentry/node';
import { createApp } from './app';
import { env } from './config/env';
import { ensureStorage } from './lib';
import { logger } from './utils/logger';
import { attachSockets } from './sockets';

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, tracesSampleRate: 0 });
}

ensureStorage();

const app = createApp();
const server = http.createServer(app);
attachSockets(server, app);

server.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'Dignity API listening');
});
