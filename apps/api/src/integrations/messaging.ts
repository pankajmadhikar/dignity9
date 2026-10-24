import { env } from '../config/env';

export function followUpMessage(clinicName: string, dueDate: string) {
  return `${clinicName}: a follow-up visit is due on ${dueDate}. Open the secure link from the clinic for details. This message does not include diagnosis or medicines.`;
}

type Delivery = {
  status: 'SENT' | 'FAILED' | 'SKIPPED';
  providerRef?: string;
  error?: string;
};

export async function deliverMessage(input: {
  channel: 'WHATSAPP' | 'SMS';
  to: string;
  body: string;
}): Promise<Delivery> {
  if (input.channel === 'WHATSAPP') return sendWhatsApp(input.to, input.body);
  return sendSms(input.to, input.body);
}

async function sendWhatsApp(to: string, body: string): Promise<Delivery> {
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) {
    return { status: 'SKIPPED', error: 'WhatsApp Business is not configured' };
  }
  const template = env.WHATSAPP_TEMPLATE
    ? {
        type: 'template',
        template: {
          name: env.WHATSAPP_TEMPLATE,
          language: { code: 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: body.slice(0, 900) }] }],
        },
      }
    : { type: 'text', text: { preview_url: false, body } };
  const response = await fetch(`https://graph.facebook.com/v21.0/${env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      ...template,
    }),
  });
  const payload = (await response.json().catch(() => null)) as { messages?: Array<{ id?: string }>; error?: { message?: string } } | null;
  if (!response.ok) {
    return { status: 'FAILED', error: payload?.error?.message || `WhatsApp returned ${response.status}` };
  }
  return { status: 'SENT', providerRef: payload?.messages?.[0]?.id };
}

async function sendSms(to: string, body: string): Promise<Delivery> {
  if (!env.SMS_API_URL || !env.SMS_API_KEY) {
    return { status: 'SKIPPED', error: 'SMS provider is not configured' };
  }
  const response = await fetch(env.SMS_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.SMS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ to, message: body }),
  });
  const payload = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
  if (!response.ok) {
    return { status: 'FAILED', error: payload?.message || `SMS provider returned ${response.status}` };
  }
  return { status: 'SENT', providerRef: payload?.id };
}
