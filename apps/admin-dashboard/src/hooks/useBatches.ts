import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listBatches,
  getBatch,
  getBatchErrors,
  pauseBatch,
  resumeBatch,
  cancelBatch,
  checkAdvanceBatch,
  retryResolution,
  retryOrderCreation,
  retryDispatching,
  retryBatchErrors,
  generateLinks,
} from "@/services/api";
import type { BatchListParams, BatchErrorParams } from "@/types";

export function useBatches(params: BatchListParams = {}) {
  return useQuery({
    queryKey: ["batches", params],
    queryFn: () => listBatches(params),
    refetchInterval: 10_000,
  });
}

export function useBatch(batchId: string) {
  return useQuery({
    queryKey: ["batch", batchId],
    queryFn: () => getBatch(batchId),
    enabled: !!batchId,
    refetchInterval: 5000, // poll every 5s for active batches
  });
}

export function useBatchErrors(batchId: string, params: BatchErrorParams = {}) {
  return useQuery({
    queryKey: ["batchErrors", batchId, params],
    queryFn: () => getBatchErrors(batchId, params),
    enabled: !!batchId,
  });
}

export function usePauseBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => pauseBatch(batchId),
    onSuccess: () => {
      toast.success("Batch paused successfully");
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to pause batch");
    },
  });
}

export function useResumeBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => resumeBatch(batchId),
    onSuccess: () => {
      toast.success("Batch resumed successfully");
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to resume batch");
    },
  });
}

export function useCancelBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, reason }: { batchId: string; reason: string }) =>
      cancelBatch(batchId, reason),
    onSuccess: () => {
      toast.success("Batch cancelled");
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to cancel batch");
    },
  });
}

export function useCheckAdvanceBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => checkAdvanceBatch(batchId),
    onSuccess: () => {
      toast.success("Batch advanced to next stage");
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to refresh status");
    },
  });
}

export function useRetryResolution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => retryResolution(batchId),
    onSuccess: () => {
      toast.success("Resolution retried — batch will reprocess failed teachers");
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to retry resolution");
    },
  });
}

export function useRetryOrderCreation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => retryOrderCreation(batchId),
    onSuccess: (data) => {
      toast.success(`Enqueued ${data.ordersToCreate} order creation tasks`);
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create orders");
    },
  });
}

export function useRetryDispatching() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => retryDispatching(batchId),
    onSuccess: (data) => {
      toast.success(`Enqueued ${data.totalMessages} messaging tasks`);
      queryClient.invalidateQueries({ queryKey: ["batches"] });
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to dispatch messages");
    },
  });
}

export function useGenerateLinks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (batchId: string) => generateLinks({ batchId }),
    onSuccess: (data) => {
      toast.success(`Generated ${data.linkCount} links for ${data.teacherCount} teachers`);
      queryClient.invalidateQueries({ queryKey: ["batch"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to generate links");
    },
  });
}

export function useRetryBatchErrors() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ batchId, stage }: { batchId: string; stage?: string }) =>
      retryBatchErrors(batchId, stage),
    onSuccess: (data) => {
      toast.success(`Retried ${data.retriedCount} error${data.retriedCount !== 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["batchErrors"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to retry errors");
    },
  });
}
