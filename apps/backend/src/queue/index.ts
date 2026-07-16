import { Queue, Worker, QueueEvents, type Job, type WorkerOptions } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '@/config';

// Singleton Redis connection
const connection = new IORedis(config.redis.url, {
  maxRetriesPerRequest: null, // Required by BullMQ
  enableReadyCheck: false,
});

connection.on('error', (err) => console.error('[Redis] Error:', err.message));
connection.on('connect', () => console.log('[Redis] Connected'));

// Queue name constants
export const QUEUES = {
  BATCH_ADVANCE: 'batch-advance',
  ORDER_CREATION: 'order-creation',
  WHATSAPP_MESSAGES: 'whatsapp-messages',
  EMAIL_MESSAGES: 'email-messages',
} as const;

// Queue instances (lazy-created singletons)
const queues = new Map<string, Queue>();

export function getQueue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(name, new Queue(name, { connection }));
  }
  return queues.get(name)!;
}

// Publish a job
export async function addJob(queueName: string, data: unknown, opts?: { priority?: number; delay?: number; attempts?: number; backoff?: { type: string; delay: number } }) {
  const queue = getQueue(queueName);
  return queue.add(queueName, data, {
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
    ...opts,
  });
}

// Create a BullMQ Worker
export function createWorker<T = unknown>(
  queueName: string,
  processor: (job: Job<T>) => Promise<void>,
  opts?: Partial<WorkerOptions>
): Worker<T> {
  const worker = new Worker<T>(queueName, processor, {
    connection,
    concurrency: 1,
    ...opts,
  });

  worker.on('completed', (_job) => {
    // silent
  });

  worker.on('failed', (job, err) => {
    console.error(`[${queueName}] Job ${job?.id} failed:`, err.message);
  });

  worker.on('error', (err) => {
    console.error(`[${queueName}] Worker error:`, err.message);
  });

  console.log(`[${queueName}] Worker started`);
  return worker;
}

// For SSE - listen to queue events
export function getQueueEvents(queueName: string): QueueEvents {
  return new QueueEvents(queueName, { connection });
}

export { connection as redisConnection };
