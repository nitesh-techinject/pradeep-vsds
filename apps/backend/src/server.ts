import { Elysia } from 'elysia';
import { cors } from '@elysiajs/cors';
import { swagger } from '@elysiajs/swagger';
import { config, validateConfig } from '@/config';
import { batchRoutes } from '@/routes/batches';
import { dlqRoutes } from '@/routes/dlq';
import { duplicateRoutes } from '@/routes/duplicates';
import { teacherRoutes } from '@/routes/teachers';
import { dashboardRoutes } from '@/routes/dashboard';
import { uploadRoutes } from '@/routes/upload';
import { webhookRoutes } from '@/routes/webhooks';
import { bookMappingRoutes } from '@/routes/bookMappings';
import { algoliaRoutes } from '@/routes/algolia';
import { watiTemplateRoutes } from '@/routes/watiTemplates';
import { commLogRoutes } from '@/routes/commLogs';
import { sseRoutes } from '@/routes/sse';
import { triggerRoutes } from '@/routes/triggers';
import { queueRoutes } from '@/routes/queues';

validateConfig();

const app = new Elysia()
  .use(
    cors({
      origin: config.cors.allowedOrigins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    })
  )
  .use(
    swagger({
      documentation: {
        info: { title: 'VSDS API', version: '1.0.0', description: 'Vendor Specimen Distribution System' },
        tags: [
          { name: 'batches', description: 'Batch lifecycle management' },
          { name: 'dlq', description: 'Dead letter queue management' },
          { name: 'duplicates', description: 'Duplicate teacher resolution' },
          { name: 'teachers', description: 'Teacher master records' },
          { name: 'dashboard', description: 'Dashboard statistics' },
          { name: 'upload', description: 'Batch file upload' },
          { name: 'book-mappings', description: 'Book code to product ID mappings' },
          { name: 'algolia', description: 'Algolia product search and local cache' },
          { name: 'wati-templates', description: 'WATI WhatsApp template management and mapping engine' },
        ],
      },
    })
  )
  .get('/health', () => ({ status: 'ok', ts: new Date().toISOString() }))
  .derive(({ request, set }) => {
    if (config.apiSecret) {
      const auth = request.headers.get('authorization') ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== config.apiSecret) {
        set.status = 401;
        throw new Error('Unauthorized');
      }
    }
  })
  .use(batchRoutes)
  .use(dlqRoutes)
  .use(duplicateRoutes)
  .use(teacherRoutes)
  .use(dashboardRoutes)
  .use(uploadRoutes)
  .use(webhookRoutes)
  .use(bookMappingRoutes)
  .use(algoliaRoutes)
  .use(watiTemplateRoutes)
  .use(commLogRoutes)
  .use(sseRoutes)
  .use(triggerRoutes)
  .use(queueRoutes)
  .onError(({ code, error, set }) => {
    if (code === 'NOT_FOUND') {
      set.status = 404;
      return { error: 'Not found' };
    }
    if (code === 'VALIDATION') {
      set.status = 422;
      return { error: 'Validation error', details: error.message };
    }
    console.error('[server] Unhandled error:', error);
    set.status = 500;
    return { error: 'Internal server error' };
  })
  .listen(config.port);

console.log(`🚀 VSDS backend running at http://localhost:${config.port}`);
console.log(`📖 Swagger docs at http://localhost:${config.port}/swagger`);

export type App = typeof app;
