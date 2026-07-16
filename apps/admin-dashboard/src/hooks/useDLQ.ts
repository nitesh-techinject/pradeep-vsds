import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listDLQ, retryDLQ } from "@/services/api";
import type { DLQListParams } from "@/types";

export function useDLQ(params: DLQListParams = {}) {
  return useQuery({
    queryKey: ["dlq", params],
    queryFn: () => listDLQ(params),
  });
}

export function useRetryDLQ() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { ids?: string[]; retryAll?: boolean }) => retryDLQ(data),
    onSuccess: (data) => {
      toast.success(`Retried ${data.retriedCount} DLQ item${data.retriedCount !== 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: ["dlq"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to retry DLQ items");
    },
  });
}
