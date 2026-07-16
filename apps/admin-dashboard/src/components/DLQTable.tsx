"use client";

import { useState } from "react";
import DataTable, { type Column } from "./DataTable";
import type { DLQEntry } from "@/types";
import { clsx } from "clsx";
import ChannelBadge from "./ChannelBadge";

interface Props {
  entries: DLQEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onRetrySelected: (ids: string[]) => void;
  onRetryAll: () => void;
  isLoading?: boolean;
}

export default function DLQTable({
  entries, total, page, pageSize, totalPages, onPageChange, onPageSizeChange,
  onRetrySelected, onRetryAll, isLoading,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds(selectedIds.size === entries.length ? new Set() : new Set(entries.map((e) => e.id)));
  };

  const columns: Column<DLQEntry>[] = [
    {
      key: "select",
      header: "",
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.id)}
          onChange={() => toggleSelect(row.id)}
          aria-label={`Select entry ${row.id}`}
          className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
          onClick={(e) => e.stopPropagation()}
        />
      ),
      className: "w-10",
    },
    {
      key: "teacherPhone",
      header: "Teacher",
      render: (row) => (
        <div>
          <p className="font-medium">{row.teacherName ?? "—"}</p>
          <p className="text-xs text-muted-foreground/70 font-mono">
            {row.channel === "WHATSAPP" ? row.teacherPhone : row.teacherEmail}
          </p>
        </div>
      ),
    },
    {
      key: "channel",
      header: "Channel",
      render: (row) => <ChannelBadge channel={row.channel} />,
    },
    {
      key: "attemptCount",
      header: "Attempts",
      render: (row) => <span className="text-sm">{row.attemptCount}</span>,
    },
    {
      key: "errorMessage",
      header: "Error",
      render: (row) => (
        <span className="max-w-xs truncate block text-red-600 text-xs" title={row.errorMessage}>
          {row.errorMessage}
        </span>
      ),
    },
    {
      key: "isRetryable",
      header: "Retryable",
      render: (row) => (
        <span className={clsx(
          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
          row.isRetryable ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
        )}>
          {row.isRetryable ? "Yes" : "No"}
        </span>
      ),
      mobileHidden: true,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <span className={clsx(
          "inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium",
          row.status === "RESOLVED" && "bg-green-100 text-green-700",
          row.status === "RETRYING" && "bg-blue-100 text-blue-700",
          row.status === "FAILED" && "bg-red-100 text-red-700"
        )}>
          {row.status}
        </span>
      ),
    },
  ];

  const retryableCount = entries.filter((e) => e.isRetryable && e.status === "FAILED").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={selectedIds.size === entries.length && entries.length > 0}
            onChange={toggleAll}
            className="h-4 w-4 rounded border-border text-blue-600 focus:ring-blue-500"
          />
          Select All
        </label>
        <div className="flex-1" />
        <button
          onClick={() => onRetrySelected(Array.from(selectedIds))}
          disabled={selectedIds.size === 0}
          className="rounded-lg border border-blue-600 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Retry Selected ({selectedIds.size})
        </button>
        <button
          onClick={onRetryAll}
          disabled={retryableCount === 0}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Retry All ({retryableCount})
        </button>
      </div>

      <DataTable
        columns={columns}
        data={entries}
        keyExtractor={(row) => row.id}
        isLoading={isLoading}
        emptyMessage="No dead letter queue entries."
        pagination={{ page, pageSize, total, totalPages, onPageChange, onPageSizeChange, pageSizeOptions: [10, 20, 50, 100] }}
      />
    </div>
  );
}
