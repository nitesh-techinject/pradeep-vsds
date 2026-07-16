import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3001';

interface BatchEvent {
  type: string;
  batchId: string;
  status?: string;
  stats?: Record<string, number>;
  statusHistory?: Array<{ from: string; to: string; trigger: string; timestamp: string }>;
  timestamp?: string;
  message?: string;
}

export function useBatchEvents(batchId: string | undefined, enabled = true) {
  const [events, setEvents] = useState<BatchEvent[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [latestEvent, setLatestEvent] = useState<BatchEvent | null>(null);
  const queryClient = useQueryClient();
  const esRef = useRef<EventSource | null>(null);

  const connect = useCallback(() => {
    if (!batchId || !enabled) return;

    const es = new EventSource(`${API_BASE_URL}/sse/batches/${batchId}/events`);
    esRef.current = es;

    es.onopen = () => setIsConnected(true);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as BatchEvent;
        setLatestEvent(data);
        setEvents((prev) => [...prev.slice(-50), data]); // Keep last 50

        // Invalidate React Query cache on status change
        if (data.type === 'batch:update' || data.type === 'batch:complete') {
          queryClient.invalidateQueries({ queryKey: ['batch', batchId] });
          queryClient.invalidateQueries({ queryKey: ['batches'] });
        }

        if (data.type === 'batch:complete') {
          es.close();
          setIsConnected(false);
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      // Reconnect after 3 seconds
      setTimeout(connect, 3000);
    };
  }, [batchId, enabled, queryClient]);

  useEffect(() => {
    connect();
    return () => {
      esRef.current?.close();
      setIsConnected(false);
    };
  }, [connect]);

  return { events, latestEvent, isConnected };
}
