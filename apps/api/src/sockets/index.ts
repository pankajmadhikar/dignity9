import type { Server as HttpServer } from 'http';
import type { Express } from 'express';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { readCookie, SESSION_COOKIE, userFromToken } from '../lib';

export function attachSockets(server: HttpServer, app: Express) {
  const io = new Server(server, {
    cors: { origin: [env.WEB_ORIGIN], credentials: true },
  });
  app.set('io', io);

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.request.headers.cookie, SESSION_COOKIE);
      const user = await userFromToken(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as { clinicId: string };
    socket.join(`clinic:${user.clinicId}`);
  });

  return io;
}
