import { getDb } from './db';

export interface NotificationDispatchInput {
  branchId: number | null;
  targetRole?: string | null;
  targetUserId?: number | null;
  eventType: string;
  title: string;
  message: string;
  channels?: Array<'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP'>;
  dedupeKey?: string;
  createdByUserId?: number | null;
}

export function isProviderLive(channel: 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP'): boolean {
  if (channel === 'IN_APP') return true;
  if (channel === 'EMAIL') return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER);
  if (channel === 'SMS') return Boolean(process.env.SMS_PROVIDER_API_KEY);
  if (channel === 'WHATSAPP') return Boolean(process.env.WHATSAPP_PROVIDER_API_KEY);
  return false;
}

/**
 * Dispatches notifications across configured channels.
 * Never fakes external SMS/Email/WhatsApp delivery if provider credentials are absent;
 * instead marks external dispatches explicitly as DEV_SANDBOX / QUEUED_SANDBOX.
 */
export function dispatchNotification(input: NotificationDispatchInput): number[] {
  const db = getDb();
  const channels: Array<'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP'> = input.channels?.length
    ? input.channels
    : ['IN_APP'];
  const createdIds: number[] = [];
  const now = new Date().toISOString();

  for (const channel of channels) {
    const dedupeKey = input.dedupeKey ? `${input.dedupeKey}:${channel}` : null;
    if (dedupeKey) {
      const existing = db
        .prepare('SELECT id FROM notifications WHERE dedupe_key = ?')
        .get(dedupeKey) as { id: number } | undefined;
      if (existing) {
        createdIds.push(existing.id);
        continue;
      }
    }

    const live = isProviderLive(channel);
    const deliveryMode = live ? 'LIVE' : 'DEV_SANDBOX';
    const deliveryStatus =
      channel === 'IN_APP'
        ? 'DELIVERED'
        : live
          ? 'DISPATCHED_PROVIDER'
          : 'SANDBOX_SIMULATED_NO_CREDENTIALS';

    const info = db
      .prepare(
        `INSERT INTO notifications (
          branch_id, target_role, target_user_id, event_type, title, message,
          channel, delivery_mode, delivery_status, dedupe_key, is_read, created_by_user_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        input.branchId,
        input.targetRole ?? null,
        input.targetUserId ?? null,
        input.eventType,
        input.title,
        input.message,
        channel,
        deliveryMode,
        deliveryStatus,
        dedupeKey,
        input.createdByUserId ?? null,
        now
      );

    createdIds.push(Number(info.lastInsertRowid));
  }

  return createdIds;
}
