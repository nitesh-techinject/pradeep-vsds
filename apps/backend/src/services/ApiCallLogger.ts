import { db } from '@/db';
import { apiCallLogs } from '@/db/schema';
import { nanoid } from 'nanoid';

type LogApiCallParams = {
  service: 'wati' | 'resend' | 'lms' | 'firebase';
  endpoint: string;
  method?: string;
  requestBody?: unknown;
  responseBody?: unknown;
  statusCode?: number;
  errorMessage?: string;
  latencyMs?: number;
  batchId?: string;
  commLogId?: string;
  teacherPhone?: string;
  teacherEmail?: string;
  teacherName?: string;
  requestCount?: number;
};

export async function logApiCall(params: LogApiCallParams): Promise<void> {
  try {
    await db.insert(apiCallLogs).values({
      id: nanoid(),
      service: params.service,
      endpoint: params.endpoint,
      method: params.method ?? 'POST',
      requestBody: params.requestBody ?? null,
      responseBody: params.responseBody ?? null,
      statusCode: params.statusCode ?? null,
      errorMessage: params.errorMessage ?? null,
      latencyMs: params.latencyMs ?? null,
      batchId: params.batchId ?? null,
      commLogId: params.commLogId ?? null,
      teacherPhone: params.teacherPhone ?? null,
      teacherEmail: params.teacherEmail ?? null,
      teacherName: params.teacherName ?? null,
      requestCount: params.requestCount ?? 1,
    });
  } catch {
    // Never let logging failures break the main flow
  }
}
