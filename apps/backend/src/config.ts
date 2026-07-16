import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env' });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  db: {
    url: optional('DATABASE_URL', 'postgresql://vsds:vsds@localhost:5432/vsds'),
    maxConnections: parseInt(optional('DB_MAX_CONNECTIONS', '20'), 10),
  },

  redis: {
    url: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  wati: {
    baseUrl: optional('WATI_BASE_URL', ''),
    apiKey: optional('WATI_API_KEY', ''),
    templateName: optional('WATI_TEMPLATE_NAME', 'specimen_dispatch'),
  },

  resend: {
    apiKey: optional('RESEND_API_KEY', ''),
    fromEmail: optional('RESEND_FROM_EMAIL', 'noreply@vsds.in'),
    fromName: optional('RESEND_FROM_NAME', 'VSDS Team'),
  },

  // Shared secret for admin dashboard → backend auth
  apiSecret: optional('API_SECRET', ''),

  // Set DISABLE_MESSAGING=true to suppress all WATI/email sends (for testing)
  disableMessaging: optional('DISABLE_MESSAGING', 'false') === 'true',

  cors: {
    allowedOrigins: optional('CORS_ORIGINS', 'http://localhost:3000').split(','),
  },

  algolia: {
    appId: optional('ALGOLIA_APP_ID', ''),
    apiKey: optional('ALGOLIA_API_KEY', ''),
    indexName: optional('ALGOLIA_INDEX_NAME', 'products'),
  },

  lms: {
    baseUrl: optional('LMS_BASE_URL', 'https://questionbankappv2-e6zspx6m4q-el.a.run.app'),
    apiKey: optional('LMS_API_KEY', ''),
  },

  firebaseSyncUrl: optional('FIREBASE_SYNC_URL', 'https://vsdshelpercheckuserexists-e6zspx6m4q-el.a.run.app/v1/check-user-exists'),
} as const;

export function validateConfig(): void {
  if (config.nodeEnv === 'production') {
    required('DATABASE_URL');
    required('REDIS_URL');
  }
}
