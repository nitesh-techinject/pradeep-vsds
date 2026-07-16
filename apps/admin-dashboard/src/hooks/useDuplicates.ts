import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { listDuplicates, resolveDuplicate } from "@/services/api";
import type { DuplicateListParams } from "@/types";

export function useDuplicates(params: DuplicateListParams = {}) {
  return useQuery({
    queryKey: ["duplicates", params],
    queryFn: () => listDuplicates(params),
  });
}

export function useResolveDuplicate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      duplicateId,
      action,
    }: {
      duplicateId: string;
      action: "merge" | "keep_separate";
    }) => resolveDuplicate(duplicateId, action),
    onSuccess: (_, variables) => {
      const label = variables.action === "merge" ? "merged" : "kept separate";
      toast.success(`Duplicate ${label} successfully`);
      queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to resolve duplicate");
    },
  });
}
