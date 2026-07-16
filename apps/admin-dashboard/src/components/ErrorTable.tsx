"use client";

import { useState } from "react";
import DataTable, { type Column } from "./DataTable";
import type { BatchError, BatchStage } from "@/types";
import { clsx } from "clsx";

interface Props {
  errors: BatchError[];
  total: number;
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onFilterStage: (stage: BatchStage | undefined) => void;
  onFilterRetryable: (retryable: boolean | undefined) => void;
  onRetryAll: () => void;
  isLoading?: boolean;
  isRetrying?: boolean;
  selectedStage?: BatchStage;
  selectedRetryable?: boolean;
}

const stages: BatchStage[] = ["RESOLUTION", "ORDERS", "AGGREGATION", "MESSAGES"];

export default function ErrorTable({
  errors,
  total,
  page,
  totalPages,
  onPageChange,
  onFilterStage,
  onFilterRetryable,
  onRetryAll,
  isLoading,
  isRetrying,
  selectedStage,
  selectedRetryable,
}: Props) {
  const columns: Column<BatchError>[] = [
    { key: "stage", header: "Stage" },
    {
      key: "teacherName",
      header: "Teacher",
      render: (row) => (
        <div>
          <p className="font-medium">{row.teacherName}</p>
          <p className="text-xs text-muted-foreground/70">{row.teacherPhone}</p>
        </div>
      ),
    },
    { key: "errorType", header: "Error Type" },
    {
      key: "errorMessage",
      header: "Message",
      render: (row) => (
        <span className="max-w-xs truncate block" title={row.errorMessage}>
          {row.errorMessage}
        </span>
      ),
    },
    {
      key: "isRetryable",
      header: "Retryable",
      render: (row) => (
        <span
          className={clsx(
            "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
            row.isRetryable
              ? "bg-green-100 text-green-700"
              : "bg-muted text-muted-foreground"
          )}
        >
          {row.isRetryable ? "Yes" : "No"}
        </span>
      ),
    },
  ];

  const retryableCount = errors.filter((e) => e.isRetryable).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={selectedStage || ""}
          onChange={(e) =>
            onFilterStage(
              e.target.value ? (e.target.value as BatchStage) : undefined
            )
          }
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All Stages</option>
          {stages.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={selectedRetryable === undefined ? "" : String(selectedRetryable)}
          onChange={(e) =>
            onFilterRetryable(
              e.target.value === "" ? undefined : e.target.value === "true"
            )
          }
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">All</option>
          <option value="true">Retryable Only</option>
          <option value="false">Non-Retryable Only</option>
        </select>

        <div className="flex-1" />

        <button
          onClick={onRetryAll}
          disabled={retryableCount === 0 || isRetrying}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isRetrying ? "Retrying…" : `Retry All Retryable (${retryableCount})`}
        </button>
      </div>

      <DataTable
        columns={columns}
        data={errors}
        keyExtractor={(row) => row.id}
        isLoading={isLoading}
        emptyMessage="No errors found."
        pagination={{
          page,
          pageSize: 20,
          total,
          totalPages,
          onPageChange,
        }}
      />
    </div>
  );
}
