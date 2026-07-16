"use client";

import { useState } from "react";
import { clsx } from "clsx";
import type { DuplicateRecord, DuplicateResolution, TeacherRecord } from "@/types";
import { useDuplicates, useResolveDuplicate } from "@/hooks/useDuplicates";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Loader2, Copy, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { listBatches } from "@/services/api";

const resolutionOptions: DuplicateResolution[] = ["PENDING", "MERGED", "KEPT_SEPARATE"];

const FIELDS = [
  { key: "name", label: "Teacher Name" },
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "salutation", label: "Salutation" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "school", label: "School" },
  { key: "institutionName", label: "Institution Name" },
  { key: "institutionId", label: "Institution Id" },
  { key: "booksAssigned", label: "Books Assigned" },
  { key: "teacherOwner", label: "Teacher Owner" },
  { key: "teacherOwnerId", label: "Teacher Owner Id" },
  { key: "recordId", label: "Record Id" },
  { key: "city", label: "City" },
] as const;

function getFieldValue(record: TeacherRecord, key: (typeof FIELDS)[number]["key"]): string {
  return String(record[key] ?? "").trim() || "—";
}

function DiffView({ incoming, existing }: { incoming: TeacherRecord; existing: TeacherRecord }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-muted/30 font-mono text-sm">
      {/* Git-style header */}
      <div className="flex border-b border-border bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
        <span className="w-6 shrink-0" />
        <span className="text-foreground">Field comparison</span>
      </div>
      <div className="divide-y divide-border/50">
        {FIELDS.map(({ key, label }) => {
          const incomingVal = getFieldValue(incoming, key);
          const existingVal = getFieldValue(existing, key);
          const isSame = incomingVal === existingVal;

          if (isSame) {
            return (
              <div
                key={key}
                className="flex items-center gap-2 px-3 py-2 text-muted-foreground"
              >
                <span className="flex w-6 shrink-0 items-center justify-center text-muted-foreground/50"> </span>
                <span className="min-w-[4.5rem] shrink-0 text-muted-foreground/80">{label}:</span>
                <span className="text-foreground">{incomingVal}</span>
              </div>
            );
          }

          return (
            <div key={key} className="space-y-0">
              {/* Existing (removal) — red, git-style */}
              <div className="flex items-start gap-2 border-l-2 border-red-500 bg-red-50 px-3 py-1.5 dark:border-red-500/70 dark:bg-red-950/40">
                <span className="flex w-6 shrink-0 items-center pt-0.5 text-red-500 dark:text-red-400">
                  <Minus className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-[4.5rem] shrink-0 text-red-700 dark:text-red-300">{label}:</span>
                <span className="break-all text-red-800 dark:text-red-200">{existingVal}</span>
              </div>
              {/* Incoming (addition) — green, git-style */}
              <div className="flex items-start gap-2 border-l-2 border-emerald-500 bg-emerald-50 px-3 py-1.5 dark:border-emerald-500/70 dark:bg-emerald-950/40">
                <span className="flex w-6 shrink-0 items-center pt-0.5 text-emerald-500 dark:text-emerald-400">
                  <Plus className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-[4.5rem] shrink-0 text-emerald-700 dark:text-emerald-300">{label}:</span>
                <span className="break-all text-emerald-800 dark:text-emerald-200">{incomingVal}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DuplicatesPage() {
  const [batchFilter, setBatchFilter] = useState("");
  const [resolutionFilter, setResolutionFilter] = useState<DuplicateResolution | "">("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const { data: response, isLoading } = useDuplicates({
    batchId: batchFilter || undefined,
    resolution: resolutionFilter || undefined,
    page,
    pageSize,
  });

  const { data: batchesRes } = useQuery({
    queryKey: ["batches-list-full"],
    queryFn: () => listBatches({ pageSize: 100 }),
  });

  const resolveMutation = useResolveDuplicate();

  const duplicates = response?.data || [];
  const totalCount = response?.total || 0;
  const totalPages = response?.totalPages ?? Math.ceil(totalCount / pageSize);
  const batches = batchesRes?.data.map((b) => b.id) || [];

  const handleMerge = (id: string) => {
    resolveMutation.mutate({ duplicateId: id, action: "merge" });
  };

  const handleKeepSeparate = (id: string) => {
    resolveMutation.mutate({ duplicateId: id, action: "keep_separate" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Duplicate Review</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review and resolve potential duplicate teacher records
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card px-4 py-3 shadow-sm">
        <select
          value={batchFilter}
          onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Batches</option>
          {batches.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          value={resolutionFilter}
          onChange={(e) => { setResolutionFilter(e.target.value as DuplicateResolution | ""); setPage(1); }}
          className="rounded-lg border border-border bg-background px-4 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="">All Resolutions</option>
          {resolutionOptions.map((r) => (
            <option key={r} value={r}>
              {r.replace(/_/g, " ")}
            </option>
          ))}
        </select>

        <span className="text-sm text-muted-foreground">
          {totalCount} duplicate{totalCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Duplicate Cards */}
      {isLoading ? (
        <LoadingSpinner />
      ) : (
        <div className="space-y-6">
          {duplicates.length === 0 && (
            <div className="rounded-xl border border-border bg-card p-12 text-center shadow-sm">
              <Copy className="mx-auto mb-3 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">No duplicates found.</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Try adjusting your filters or upload new data.
              </p>
            </div>
          )}

          {duplicates.map((dup) => (
            <div
              key={dup.id}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-colors"
            >
              {/* Header */}
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/30 px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-muted-foreground">{dup.id}</span>
                  <span className="text-muted-foreground/50">•</span>
                  <span className="font-mono text-xs text-muted-foreground">{dup.batchId}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">Confidence:</span>
                    <span
                      className={clsx(
                        "text-sm font-bold",
                        dup.confidenceScore >= 0.9
                          ? "text-red-600 dark:text-red-400"
                          : dup.confidenceScore >= 0.8
                          ? "text-orange-600 dark:text-orange-400"
                          : "text-yellow-600 dark:text-yellow-400"
                      )}
                    >
                      {(dup.confidenceScore * 100).toFixed(0)}%
                    </span>
                  </div>
                  <span
                    className={clsx(
                      "rounded-full px-2.5 py-0.5 text-xs font-medium",
                      dup.resolution === "PENDING" && "bg-yellow-100 dark:bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
                      dup.resolution === "MERGED" && "bg-green-100 dark:bg-green-500/20 text-green-700 dark:text-green-300",
                      dup.resolution === "KEPT_SEPARATE" && "bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300"
                    )}
                  >
                    {dup.resolution.replace(/_/g, " ")}
                  </span>
                </div>
              </div>

              {/* Match Reasons */}
              {dup.matchReasons.length > 0 && (
                <div className="flex flex-wrap gap-2 px-4 py-3">
                  {dup.matchReasons.map((reason, idx) => (
                    <span
                      key={idx}
                      className="rounded-full bg-orange-50 dark:bg-orange-500/20 px-3 py-1 text-xs font-medium text-orange-700 dark:text-orange-300"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              )}

              {/* Records Comparison — git-style diff */}
              <div className="p-4">
                <DiffView incoming={dup.incomingRecord} existing={dup.existingRecord} />
              </div>

              {/* Actions */}
              {dup.resolution === "PENDING" && (
                <div className="flex items-center justify-end gap-3 border-t border-border bg-muted/20 px-4 py-3">
                  <button
                    onClick={() => handleKeepSeparate(dup.id)}
                    disabled={resolveMutation.isPending}
                    className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
                  >
                    Keep Separate
                  </button>
                  <button
                    onClick={() => handleMerge(dup.id)}
                    disabled={resolveMutation.isPending}
                    className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {resolveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                    Merge Records
                  </button>
                </div>
              )}
            </div>
          ))}

          {/* Pagination */}
          {!isLoading && duplicates.length > 0 && totalPages > 1 && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:justify-between sm:px-6">
              <p className="text-sm text-muted-foreground">
                Page {page} of {totalPages}{" "}
                <span className="text-muted-foreground/60">({totalCount} total)</span>
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-[2.5rem] text-center text-sm font-medium text-foreground">
                  {page}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
