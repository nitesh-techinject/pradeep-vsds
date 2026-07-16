import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { commLog, teacherCommunications } from '@/db/schema';
import { nanoid } from 'nanoid';

export const webhookRoutes = new Elysia({ prefix: '/webhooks' })
  // WATI WhatsApp delivery status
  .post(
    '/wati',
    async ({ body }) => {
      const { waId, id: externalId, status } = body as {
        waId?: string;
        id?: string;
        status?: string;
        eventType?: string;
      };

      if (!externalId || !status) return { ok: true };

      const STATUS_MAP: Record<string, string> = {
        sent: 'SENT',
        delivered: 'DELIVERED',
        read: 'READ',
        failed: 'FAILED',
      };
      const deliveryStatus = STATUS_MAP[status.toLowerCase()];
      if (!deliveryStatus) return { ok: true };

      // Update comm_log by external message id
      const [log] = await db
        .update(commLog)
        .set({
          status: deliveryStatus === 'DELIVERED' || deliveryStatus === 'READ' ? 'DELIVERED' : deliveryStatus === 'FAILED' ? 'FAILED' : 'SENT',
          deliveredAt: deliveryStatus === 'DELIVERED' || deliveryStatus === 'READ' ? new Date() : undefined,
          externalMessageId: externalId,
          updatedAt: new Date(),
        })
        .where(eq(commLog.externalMessageId, externalId))
        .returning();

      if (log) {
        await db.insert(teacherCommunications).values({
          id: nanoid(),
          commLogId: log.id,
          teacherId: log.teacherMasterId ?? undefined,
          batchId: log.batchId,
          channel: 'WHATSAPP',
          externalMessageId: externalId,
          deliveryStatus: deliveryStatus as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED',
        });
      }

      return { ok: true };
    },
    { body: t.Unknown() }
  )
  // Resend email delivery status
  .post(
    '/resend',
    async ({ body }) => {
      const event = body as { type?: string; data?: { email_id?: string } };
      const emailId = event.data?.email_id;
      if (!emailId) return { ok: true };

      const STATUS_MAP: Record<string, string> = {
        'email.sent': 'SENT',
        'email.delivered': 'DELIVERED',
        'email.bounced': 'FAILED',
        'email.complained': 'FAILED',
        'email.opened': 'DELIVERED',
        'email.clicked': 'DELIVERED',
      };
      const deliveryStatus = STATUS_MAP[event.type ?? ''];
      if (!deliveryStatus) return { ok: true };

      const [log] = await db
        .update(commLog)
        .set({
          status: deliveryStatus === 'DELIVERED' ? 'DELIVERED' : deliveryStatus === 'FAILED' ? 'FAILED' : 'SENT',
          deliveredAt: deliveryStatus === 'DELIVERED' ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(commLog.externalMessageId, emailId))
        .returning();

      if (log) {
        await db.insert(teacherCommunications).values({
          id: nanoid(),
          commLogId: log.id,
          teacherId: log.teacherMasterId ?? undefined,
          batchId: log.batchId,
          channel: 'EMAIL',
          externalMessageId: emailId,
          deliveryStatus: deliveryStatus as 'SENT' | 'DELIVERED' | 'BOUNCED' | 'COMPLAINED' | 'FAILED',
        });
      }

      return { ok: true };
    },
    { body: t.Unknown() }
  );
