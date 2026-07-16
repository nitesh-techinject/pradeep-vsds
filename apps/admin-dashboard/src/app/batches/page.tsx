"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DataTable, { type Column } from "@/components/DataTable";
import BatchStateIndicator from "@/components/BatchStateIndicator";
import type { Batch, BatchStatus } from "@/types";
import { useBatches } from "@/hooks/useBatches";
import { formatDate } from "@/utils/date";
import SkeletonTable from "@/components/SkeletonTable";

const statuses: BatchStatus[] = [
  "UPLOADED",
  "VALIDATING",
  "RESOLVING",
  "ORDERING",
  "MESSAGING",
  "PAUSED",
  "COMPLETE",
  "PARTIAL_FAILURE",
  "CANCELLED",
  "FAILED",
];

export default function BatchesPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<BatchStatus | "">("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data: response, isLoading } = useBatches({
    status: statusFilter || undefined,
    page,
    pageSize,
  });

  const batches = response?.data ?? [];
  const totalCount = response?.total ?? 0;

  const columns: Column<Batch>[] = [
    {
      key: "id",
      header: "Batch ID",
      render: (row) => (
        <div className="flex items-center gap-1.5">
          {row.displayId && (
            <span className="text-xs font-semibold text-foreground">{row.displayId}</span>
          )}
          <span className="rounded-md bg-blue-50 border border-blue-200 px-2 py-0.5 font-mono text-xs font-medium text-blue-700">
            {row.id}
          </span>
        </div>
      ),
    },
    {
      key: "fileName",
      header: "File",
      render: (row) => (
        <span className="text-sm text-muted-foreground">{row.fileName ?? "—"}</span>
      ),
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <BatchStateIndicator status={row.status} />,
    },
    {
      key: "stats_teachers",
      header: "Teachers",
      render: (row) => <span className="text-sm">{row.stats?.totalTeachers ?? 0}</span>,
      mobileHidden: true,
    },
    {
      key: "stats_messages",
      header: "Messages",
      render: (row) => <span className="text-sm">{row.stats?.messagesQueued ?? 0}</span>,
      mobileHidden: true,
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row) => formatDate(row.createdAt),
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Batches</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage and monitor distribution batches
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as BatchStatus | "");
            setPage(1);
          }}
          className="w-full sm:w-auto rounded-lg border border-border bg-card px-4 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <span className="text-sm text-muted-foreground">
          {totalCount} batch{totalCount !== 1 ? "es" : ""}
        </span>
      </div>

      {isLoading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : (
        <div className="min-w-0 -mx-4 sm:mx-0">
        <DataTable
          columns={columns}
          data={batches}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => router.push(`/batches/${row.id}`)}
          pagination={{
            page,
            pageSize,
            total: totalCount,
            totalPages: Math.ceil(totalCount / pageSize),
            onPageChange: setPage,
            onPageSizeChange: (s) => { setPageSize(s); setPage(1); },
            pageSizeOptions: [10, 20, 50, 100],
          }}
        />
        </div>
      )}
    </div>
  );
}
