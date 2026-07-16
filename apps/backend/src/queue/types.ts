export type Channel = 'WHATSAPP' | 'EMAIL';

export interface WhatsAppMessageJob {
  type: 'WHATSAPP';
  batchId: string;
  teacherRecordId: string;
  teacherMasterId: string;
  phone: string;
  name: string;
  school?: string;
  city?: string;
  email?: string;
  specimenDetails: string;
  commLogId: string;
  retryCount: number;
  /** Resolved book links passed to TemplateEngine */
  books?: Array<{ title: string; specimenUrl: string; productId: string; author?: string }>;
}

export interface EmailMessageJob {
  type: 'EMAIL';
  batchId: string;
  teacherRecordId: string;
  teacherMasterId: string;
  email: string;
  name: string;
  specimenDetails: string;
  commLogId: string;
  retryCount: number;
  books?: Array<{ title: string; specimenUrl: string; productId: string; author?: string }>;
}

export interface OrderCreationJob {
  batchId: string;
  teacherRecordId: string;
  teacherMasterId: string;
  retryCount: number;
}

export interface BatchAdvanceJob {
  batchId: string;
  targetStage: string;
}

export type MessageJob = WhatsAppMessageJob | EmailMessageJob;
