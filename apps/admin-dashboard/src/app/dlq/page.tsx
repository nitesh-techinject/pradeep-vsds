"use client";

import { useState } from "react";
import DLQTable from "@/components/DLQTable";
import type { DLQEntry, MessageChannel } from "@/types";
import { useDLQ, useRetryDLQ } from "@/hooks/useDLQ";
import LoadingSpinner from "@/components/LoadingSpinner";
import { useQuery } from "@tanstack/react-query";
import { listBatches } from "@/services/api";

const channels: MessageChannel[] = ["WHATSAPP", "SMS", "EMAIL"];

export default function DLQPage() {
  const [batchFilter, setBatchFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState<MessageChannel | "">("");
  const [retryableOnly, setRetryableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data: response, isLoading } = useDLQ({
    batchId: batchFilter || undefined,
    channel: channelFilter || undefined,
    retryableOnly: retryableOnly || undefined,
    page,
    pageSize,
  });

  const { data: batchesRes } = useQuery({
    queryKey: ["batches-list"],
    queryFn: () => listBatches({ pageSize: 100 }),
  });

  const retryMutation = useRetryDLQ();

  const entries = response?.data || [];
  const totalCount = response?.total || 0;
  const batches = batchesRes?.data.map((b) => b.id) ?? [];

  const handleRetrySelected = (ids: string[]) => {
    retryMutation.mutate({ ids });
  };

  const handleRetryAll = () => {
    retryMutation.mutate({ retryAll: true });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Dead Letter Queue
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and retry failed message deliveries
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <select
          value={batchFilter}
          onChange={(e) => {
            setBatchFilter(e.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Batches</option>
          {batches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          value={channelFilter}
          onChange={(e) => {
            setChannelFilter(e.target.value as MessageChannel | "");
            setPage(1);
          }}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Channels</option>
          {channels.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={retryableOnly}
            onChange={(e) => {
              setRetryableOnly(e.target.checked);
              setPage(1);
            }}
            className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
          />
          Retryable Only
        </label>

        <span className="text-sm text-muted-foreground">
          {totalCount} entr{totalCount !== 1 ? "ies" : "y"}
        </span>
      </div>

      {/* DLQ Table */}
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <DLQTable
          entries={entries}
          total={totalCount}
          page={page}
          pageSize={pageSize}
          totalPages={Math.ceil(totalCount / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          onRetrySelected={handleRetrySelected}
          onRetryAll={handleRetryAll}
        />
      )}
    </div>
  );
}
