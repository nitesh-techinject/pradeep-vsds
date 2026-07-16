import { Elysia } from 'elysia';
import { DashboardService } from '@/services/DashboardService';

export const dashboardRoutes = new Elysia({ prefix: '/dashboard' })
  .get('/stats', async () => DashboardService.getStats())
  .get('/recent-batches', async () => DashboardService.getRecentBatches());
