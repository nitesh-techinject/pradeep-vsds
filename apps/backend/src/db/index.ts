import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { config } from '@/config';
import * as schema from './schema';

// Connection pool for queries
const queryClient = postgres(config.db.url, {
  max: config.db.maxConnections,
  idle_timeout: 30,
  connect_timeout: 10,
  onnotice: () => {}, // suppress notices
});

export const db = drizzle(queryClient, { schema });

export type DB = typeof db;
