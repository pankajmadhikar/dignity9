import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { processFollowUpReminder } from './reminders';

const worker = new Worker(
  'reminders',
  async (job) => {
    if (job.name === 'follow-up' && typeof job.data?.taskId === 'string') {
      await processFollowUpReminder(job.data.taskId);
    }
  },
  { connection: new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null }) },
);

worker.on('failed', (job, error) => {
  logger.error({ err: error, jobId: job?.id }, 'Reminder job failed');
});

worker.on('ready', () => {
  logger.info('Reminder worker is listening');
});
