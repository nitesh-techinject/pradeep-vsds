import { eq, desc, count, sql } from 'drizzle-orm';
import { db } from '@/db';
import { batches, failedMessages, commLog } from '@/db/schema';

export class DashboardService {
  static async getStats() {
    const [totalRes, activeRes, dlqRes, sentRes, deliveredRes] = await Promise.all([
      db.select({ v: count() }).from(batches),
      db
        .select({ v: count() })
        .from(batches)
        .where(sql`${batches.status} IN ('VALIDATING', 'RESOLVING', 'ORDERING', 'MESSAGING')`),
      db
        .select({ v: count() })
        .from(failedMessages)
        .where(eq(failedMessages.status, 'FAILED')),
      db
        .select({ v: count() })
        .from(commLog)
        .where(sql`${commLog.status} IN ('SENT', 'DELIVERED')`),
      db
        .select({ v: count() })
        .from(commLog)
        .where(eq(commLog.status, 'DELIVERED')),
    ]);

    const totalBatches = Number(totalRes[0]?.v ?? 0);
    const activeBatches = Number(activeRes[0]?.v ?? 0);
    const dlqCount = Number(dlqRes[0]?.v ?? 0);
    const messagesSent = Number(sentRes[0]?.v ?? 0);
    const messagesDelivered = Number(deliveredRes[0]?.v ?? 0);

    return {
      totalBatches,
      activeBatches,
      dlqCount,
      messagesSent,
      messagesDelivered,
      deliveryRate: messagesSent > 0 ? Math.round((messagesDelivered / messagesSent) * 100) : 0,
    };
  }

  static async getRecentBatches(limit = 5) {
    return db.query.batches.findMany({
      orderBy: [desc(batches.createdAt)],
      limit,
    });
  }
}
