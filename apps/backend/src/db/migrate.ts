import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { config } from '@/config';
import { sql } from 'drizzle-orm';
import * as schema from './schema';

async function main() {
  console.log('Syncing database schema...');

  const client = postgres(config.db.url, { max: 1 });
  const db = drizzle(client, { schema });

  // Try migrations first (if migration files exist)
  try {
    const fs = await import('fs');
    if (fs.existsSync('./drizzle/migrations/meta/_journal.json')) {
      await migrate(db, { migrationsFolder: './drizzle/migrations' });
      console.log('Migrations applied.');
    } else {
      console.log('No migration files found — skipping migrations.');
    }
  } catch (err) {
    console.log('Migration skipped:', (err as Error).message);
  }

  // Ensure all tables exist by running CREATE TABLE IF NOT EXISTS
  // This is safe — won't modify existing tables
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY,
      seq_id SERIAL UNIQUE,
      status TEXT NOT NULL DEFAULT 'UPLOADED',
      file_name TEXT,
      stats JSONB DEFAULT '{}',
      status_history JSONB DEFAULT '[]',
      paused_from_stage TEXT,
      paused_at TIMESTAMPTZ,
      resumed_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      cancel_reason TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      seq_id SERIAL UNIQUE,
      name TEXT NOT NULL,
      phones JSONB DEFAULT '[]' NOT NULL,
      emails JSONB DEFAULT '[]' NOT NULL,
      school TEXT,
      city TEXT,
      record_id TEXT,
      books_assigned TEXT,
      teacher_owner_id TEXT,
      teacher_owner TEXT,
      first_name TEXT,
      last_name TEXT,
      institution_id TEXT,
      institution_name TEXT,
      salutation TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS phone_lookup (
      phone TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS email_lookup (
      email TEXT PRIMARY KEY,
      teacher_id TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS teachers_raw (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
      name TEXT,
      phone TEXT,
      email TEXT,
      school TEXT,
      city TEXT,
      books TEXT,
      resolution_status TEXT NOT NULL DEFAULT 'PENDING',
      teacher_master_id TEXT REFERENCES teachers(id),
      is_new_teacher BOOLEAN,
      resolution_confidence REAL,
      resolution_error TEXT,
      send_whatsapp BOOLEAN DEFAULT true,
      send_email BOOLEAN DEFAULT false,
      record_id TEXT,
      books_assigned TEXT,
      teacher_owner_id TEXT,
      teacher_owner TEXT,
      first_name TEXT,
      last_name TEXT,
      institution_id TEXT,
      institution_name TEXT,
      salutation TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      teacher_record_id TEXT NOT NULL REFERENCES teachers_raw(id),
      teacher_master_id TEXT REFERENCES teachers(id),
      teacher_name TEXT NOT NULL,
      teacher_phone TEXT,
      teacher_email TEXT,
      school TEXT,
      city TEXT,
      books JSONB DEFAULT '[]',
      total_books INTEGER DEFAULT 0,
      send_whatsapp BOOLEAN DEFAULT true,
      send_email BOOLEAN DEFAULT false,
      status TEXT DEFAULT 'created',
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS aggregations (
      id TEXT PRIMARY KEY,
      teacher_master_id TEXT NOT NULL REFERENCES teachers(id),
      teacher_record_id TEXT REFERENCES teachers_raw(id),
      batch_id TEXT NOT NULL REFERENCES batches(id),
      teacher_name TEXT,
      teacher_phone TEXT,
      teacher_email TEXT,
      books TEXT,
      send_whatsapp BOOLEAN DEFAULT true,
      send_email BOOLEAN DEFAULT false,
      expected_link_count INTEGER NOT NULL DEFAULT 0,
      link_count INTEGER NOT NULL DEFAULT 0,
      links JSONB DEFAULT '[]',
      is_complete BOOLEAN NOT NULL DEFAULT false,
      completed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS comm_log (
      id TEXT PRIMARY KEY,
      message_hash TEXT NOT NULL UNIQUE,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      teacher_master_id TEXT,
      teacher_record_id TEXT,
      aggregation_key TEXT,
      channel TEXT NOT NULL,
      teacher_phone TEXT,
      teacher_email TEXT,
      teacher_name TEXT,
      books TEXT,
      status TEXT NOT NULL DEFAULT 'QUEUED',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      external_message_id TEXT,
      delivered_at TIMESTAMPTZ,
      last_error TEXT,
      last_attempt_at TIMESTAMPTZ,
      skip_reason TEXT,
      error_type TEXT,
      retried_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS message_send_log (
      id TEXT PRIMARY KEY,
      comm_log_id TEXT REFERENCES comm_log(id),
      batch_id TEXT REFERENCES batches(id),
      teacher_master_id TEXT,
      teacher_phone TEXT,
      teacher_email TEXT,
      teacher_name TEXT,
      channel TEXT NOT NULL,
      attempt_number INTEGER NOT NULL DEFAULT 1,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL,
      external_message_id TEXT,
      error TEXT,
      link_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS teacher_communications (
      id TEXT PRIMARY KEY,
      comm_log_id TEXT REFERENCES comm_log(id),
      teacher_id TEXT REFERENCES teachers(id),
      batch_id TEXT REFERENCES batches(id),
      channel TEXT NOT NULL,
      external_message_id TEXT,
      delivery_status TEXT NOT NULL,
      delivery_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS failed_messages (
      id TEXT PRIMARY KEY,
      comm_log_id TEXT REFERENCES comm_log(id),
      batch_id TEXT REFERENCES batches(id),
      teacher_master_id TEXT,
      teacher_record_id TEXT,
      channel TEXT NOT NULL,
      teacher_phone TEXT,
      teacher_email TEXT,
      error_type TEXT NOT NULL,
      error_message TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      is_retryable BOOLEAN NOT NULL DEFAULT true,
      status TEXT NOT NULL DEFAULT 'FAILED',
      retried_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS possible_duplicates (
      id TEXT PRIMARY KEY,
      batch_id TEXT REFERENCES batches(id),
      raw_teacher_id TEXT REFERENCES teachers_raw(id),
      candidate_teacher_id TEXT REFERENCES teachers(id),
      confidence_score REAL NOT NULL,
      match_reasons JSONB DEFAULT '[]',
      resolution TEXT NOT NULL DEFAULT 'PENDING',
      reviewed_by TEXT,
      resolved_at TIMESTAMPTZ,
      incoming_record JSONB,
      existing_record JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS batch_errors (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      stage TEXT NOT NULL,
      comm_log_id TEXT,
      teacher_raw_id TEXT,
      error_type TEXT NOT NULL,
      error_message TEXT NOT NULL,
      is_retryable BOOLEAN NOT NULL DEFAULT true,
      teacher_name TEXT,
      teacher_phone TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS batch_logs (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES batches(id),
      step TEXT NOT NULL,
      message TEXT NOT NULL,
      detail TEXT,
      teacher_name TEXT,
      teacher_phone TEXT,
      teacher_email TEXT,
      channel TEXT,
      metadata JSONB,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_call_logs (
      id TEXT PRIMARY KEY,
      service TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'POST',
      request_body JSONB,
      response_body JSONB,
      status_code INTEGER,
      error_message TEXT,
      latency_ms INTEGER,
      batch_id TEXT REFERENCES batches(id),
      comm_log_id TEXT REFERENCES comm_log(id),
      teacher_phone TEXT,
      teacher_email TEXT,
      teacher_name TEXT,
      request_count INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS api_call_logs_batch_idx ON api_call_logs(batch_id);
    CREATE INDEX IF NOT EXISTS api_call_logs_service_idx ON api_call_logs(service);
    CREATE INDEX IF NOT EXISTS api_call_logs_created_idx ON api_call_logs(created_at);

    CREATE TABLE IF NOT EXISTS batch_links (
      id TEXT PRIMARY KEY,
      batch_id TEXT NOT NULL UNIQUE REFERENCES batches(id),
      links JSONB,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS book_mappings (
      id TEXT PRIMARY KEY,
      book_code TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_title TEXT NOT NULL,
      notes TEXT,
      authors JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(book_code, product_id)
    );

    CREATE TABLE IF NOT EXISTS wati_templates (
      id TEXT PRIMARY KEY,
      template_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      body_preview TEXT,
      params JSONB DEFAULT '[]',
      is_active BOOLEAN NOT NULL DEFAULT false,
      book_count INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS algolia_products (
      object_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      isbn TEXT,
      subject TEXT,
      grade TEXT,
      publisher TEXT,
      cover_url TEXT,
      raw_data JSONB,
      synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Column additions (idempotent via DO block)
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='book_mappings' AND column_name='cover_url') THEN
        ALTER TABLE book_mappings ADD COLUMN cover_url TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='book_mappings' AND column_name='edition') THEN
        ALTER TABLE book_mappings ADD COLUMN edition TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='batches' AND column_name='next_batch_id') THEN
        ALTER TABLE batches ADD COLUMN next_batch_id TEXT REFERENCES batches(id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='batches' AND column_name='trigger_id') THEN
        ALTER TABLE batches ADD COLUMN trigger_id TEXT;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teachers' AND column_name='firebase_id') THEN
        ALTER TABLE teachers ADD COLUMN firebase_id TEXT;
      END IF;
    END $$;

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_comm_log_batch_status ON comm_log(batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_orders_batch_status ON orders(batch_id, status);
    CREATE INDEX IF NOT EXISTS idx_teachers_raw_batch_res ON teachers_raw(batch_id, resolution_status);
  `);

  console.log('Schema sync complete.');

  // Remove ALL existing templates — clean slate
  await db.execute(sql`DELETE FROM wati_templates`);
  console.log('Removed all existing wati_templates.');

  // Seed spmst3_digital3 — 3 books, named params
  const bodyPreview3 = `Hello {{name}}!

Your digital access for the following has been activated.

*1. {{bookname1}}* by _{{attribute_1}}_
*2. {{bookname2}}* by _{{attribute_2}}_
*3. {{bookname3}}* by _{{attribute_3}}_

Access link: {{Source}}

*Pradeep Publications*`;

  const params3 = [
    { paramName: 'name',        dataPath: 'teacher.name',   fallback: 'Teacher' },
    { paramName: 'bookname1',   dataPath: 'books.0.title',  fallback: '' },
    { paramName: 'attribute_1', dataPath: 'books.0.author', fallback: '' },
    { paramName: 'bookname2',   dataPath: 'books.1.title',  fallback: '' },
    { paramName: 'attribute_2', dataPath: 'books.1.author', fallback: '' },
    { paramName: 'bookname3',   dataPath: 'books.2.title',  fallback: '' },
    { paramName: 'attribute_3', dataPath: 'books.2.author', fallback: '' },
    { paramName: 'Source',      dataPath: 'order.link',     fallback: '' },
  ];

  await db.execute(sql`
    INSERT INTO wati_templates (id, template_name, display_name, body_preview, params, is_active, book_count, created_at, updated_at)
    VALUES (
      gen_random_uuid()::text,
      'spmst3_digital3',
      'Specimen Digital — 3 books',
      ${bodyPreview3},
      ${JSON.stringify(params3)}::jsonb,
      true,
      3,
      NOW(),
      NOW()
    )
    ON CONFLICT (template_name) DO UPDATE SET
      display_name = EXCLUDED.display_name,
      body_preview = EXCLUDED.body_preview,
      params       = EXCLUDED.params,
      is_active    = true,
      book_count   = EXCLUDED.book_count,
      updated_at   = NOW()
  `);
  console.log('Seeded spmst3_digital3 template.');

  await client.end();
}

main().catch((err) => {
  console.error('Schema sync failed:', err);
  process.exit(1);
});
