/** Display-friendly incremental IDs derived from serial seq_id columns */

export function formatBatchId(seqId: number): string {
  return `B-${String(seqId).padStart(5, '0')}`;
}

export function formatTeacherId(seqId: number): string {
  return `T-${String(seqId).padStart(5, '0')}`;
}
