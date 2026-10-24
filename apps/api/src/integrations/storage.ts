import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { HttpError } from '../utils/errors';

export const storageDir = path.resolve(process.cwd(), 'storage');

export function ensureStorage() {
  if (env.STORAGE_DRIVER === 'local') fs.mkdirSync(storageDir, { recursive: true });
}

function s3() {
  if (!env.S3_BUCKET || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new HttpError(500, 'Object storage is not configured');
  }
  return new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: Boolean(env.S3_ENDPOINT),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
}

export function assertStorageKey(storageKey: string) {
  if (!storageKey || storageKey.includes('..') || storageKey.includes('/') || storageKey.includes('\\')) {
    throw new HttpError(400, 'Invalid file reference');
  }
}

export function resolveStorageFile(storageKey: string) {
  assertStorageKey(storageKey);
  const full = path.resolve(storageDir, storageKey);
  if (!full.startsWith(storageDir + path.sep)) throw new HttpError(400, 'Invalid file reference');
  return full;
}

export async function readStoredFile(storageKey: string) {
  if (env.STORAGE_DRIVER === 's3') {
    const response = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: storageKey }));
    const bytes = await response.Body?.transformToByteArray();
    if (!bytes) throw new HttpError(404, 'File not found');
    return Buffer.from(bytes);
  }
  return fs.readFileSync(resolveStorageFile(storageKey));
}

export async function writeStoredFile(storageKey: string, body: Buffer, mimeType: string) {
  assertStorageKey(storageKey);
  if (env.STORAGE_DRIVER === 's3') {
    await s3().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: storageKey,
        Body: body,
        ContentType: mimeType,
      }),
    );
    return;
  }
  ensureStorage();
  fs.writeFileSync(resolveStorageFile(storageKey), body);
}

export async function signedDownloadUrl(storageKey: string, fileName: string) {
  if (env.STORAGE_DRIVER !== 's3') return null;
  assertStorageKey(storageKey);
  const command = new GetObjectCommand({
    Bucket: env.S3_BUCKET,
    Key: storageKey,
    ResponseContentDisposition: `attachment; filename="${fileName.replace(/"/g, '')}"`,
  });
  return getSignedUrl(s3(), command, { expiresIn: 300 });
}

export function hashBytes(body: Buffer) {
  return createHash('sha256').update(body).digest('hex');
}
