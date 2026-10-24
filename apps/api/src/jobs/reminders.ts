import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { env } from '../config/env';
import { prisma } from '../lib';
import { logger } from '../utils/logger';
import { deliverMessage, followUpMessage } from '../integrations/messaging';

let queue: Queue | null = null;

function connection() {
  return new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

export function reminderQueue() {
  if (!queue) {
    queue = new Queue('reminders', { connection: connection() });
  }
  return queue;
}

export async function scheduleFollowUpReminder(taskId: string) {
  if (env.NODE_ENV === 'test') return;
  try {
    const task = await prisma.followUpTask.findUnique({ where: { id: taskId } });
    if (!task || !['PENDING', 'RESCHEDULED'].includes(task.status)) return;
    const delay = Math.max(0, task.dueDate.getTime() - Date.now());
    await reminderQueue().add(
      'follow-up',
      { taskId: task.id },
      {
        jobId: `follow-up-${task.id}-${task.dueDate.toISOString().slice(0, 10)}`,
        delay,
        attempts: 5,
        backoff: { type: 'exponential', delay: 15000 },
        removeOnComplete: 200,
        removeOnFail: 200,
      },
    );
  } catch (error) {
    logger.error({ err: error, taskId }, 'Could not schedule the follow-up reminder');
  }
}

export async function processFollowUpReminder(taskId: string) {
  const task = await prisma.followUpTask.findUnique({
    where: { id: taskId },
    include: { patient: true, clinic: true },
  });
  if (!task || !['PENDING', 'RESCHEDULED'].includes(task.status)) return;
  const due = task.dueDate.toISOString().slice(0, 10);
  const body = followUpMessage(task.clinic.name, due);
  const channel = task.patient.consentWhatsapp ? 'WHATSAPP' : task.patient.consentSms ? 'SMS' : null;
  if (!channel) {
    await prisma.notification.create({
      data: {
        clinicId: task.clinicId,
        patientId: task.patientId,
        followUpTaskId: task.id,
        channel: 'SMS',
        template: 'follow_up',
        recipient: task.patient.mobile,
        status: 'SKIPPED',
        error: 'Patient has not consented to WhatsApp or SMS',
      },
    });
    return;
  }
  const result = await deliverMessage({ channel, to: task.patient.mobile, body });
  await prisma.notification.create({
    data: {
      clinicId: task.clinicId,
      patientId: task.patientId,
      followUpTaskId: task.id,
      channel,
      template: 'follow_up',
      recipient: task.patient.mobile,
      status: result.status,
      providerRef: result.providerRef,
      error: result.error,
    },
  });
  if (result.status === 'FAILED') {
    throw new Error(result.error || 'Notification delivery failed');
  }
}

export function closeReminderQueue() {
  return queue?.close();
}
