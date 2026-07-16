"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import ErrorTable from "@/components/ErrorTable";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useBatchErrors, useRetryBatchErrors } from "@/hooks/useBatches";
import type { BatchStage } from "@/types";

export default function BatchErrorsPage() {
  const params = useParams();
  const router = useRouter();
  const batchId = params.batchId as string;

  const [page, setPage] = useState(1);
  const [stageFilter, setStageFilter] = useState<BatchStage | undefined>();
  const [retryableFilter, setRetryableFilter] = useState<boolean | undefined>();

  const { data, isLoading, isError, error } = useBatchErrors(batchId, {
    page,
    pageSize: 20,
    stage: stageFilter,
    retryable: retryableFilter,
  });

  const retryMutation = useRetryBatchErrors();

  const handleRetryAll = () => {
    retryMutation.mutate({ batchId, stage: stageFilter });
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      <div>
        <button
          onClick={() => router.push(`/batches/${batchId}`)}
          className="mb-2 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Batch
        </button>
        <h1 className="text-xl font-bold text-foreground sm:text-2xl">
          Errors — <span className="font-mono text-base sm:text-xl">{batchId}</span>
        </h1>
        {data && (
          <p className="mt-1 text-sm text-muted-foreground">
            {data.total} error{data.total !== 1 ? "s" : ""} found
          </p>
        )}
      </div>

      {isLoading && <LoadingSpinner />}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {(error as Error).message || "Failed to load errors"}
        </div>
      )}

      {data && (
        <ErrorTable
          errors={data.data}
          total={data.total}
          page={page}
          totalPages={data.totalPages}
          onPageChange={setPage}
          onFilterStage={(s) => { setStageFilter(s); setPage(1); }}
          onFilterRetryable={(r) => { setRetryableFilter(r); setPage(1); }}
          onRetryAll={handleRetryAll}
          selectedStage={stageFilter}
          selectedRetryable={retryableFilter}
          isRetrying={retryMutation.isPending}
        />
      )}
    </div>
  );
}
