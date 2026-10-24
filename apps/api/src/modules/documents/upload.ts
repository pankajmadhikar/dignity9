import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { ensureStorage, storageDir } from '../../lib';

const allowed = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      ensureStorage();
      cb(null, storageDir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const safeExt = ['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext) ? ext : '';
      cb(null, `${crypto.randomBytes(16).toString('hex')}${safeExt}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowed.has(file.mimetype)) {
      cb(new Error('Upload a PDF or image file'));
      return;
    }
    cb(null, true);
  },
});
