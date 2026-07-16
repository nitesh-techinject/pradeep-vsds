"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/utils/date";
import { listCommLogs, type CommLogEntry, type BatchCommSummary } from "@/services/api";
import SkeletonTable from "@/components/SkeletonTable";
import Pagination from "@/components/Pagination";
import ChannelBadge from "@/components/ChannelBadge";

const STATUS_COLORS: Record<string, string> = {
  QUEUED:    "bg-yellow-100 text-yellow-800",
  SENT:      "bg-green-100 text-green-800",
  DELIVERED: "bg-emerald-100 text-emerald-800",
  FAILED:    "bg-red-100 text-red-800",
  DLQ:       "bg-red-200 text-red-900",
  CANCELLED: "bg-gray-100 text-gray-600",
  SKIPPED:   "bg-gray-100 text-gray-500",
};


export default function MessagesPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"batches" | "logs">("batches");
  const [batchFilter, setBatchFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState<"WHATSAPP" | "EMAIL" | "">("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [batchPage, setBatchPage] = useState(1);
  const [batchPageSize, setBatchPageSize] = useState(10);

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ["commLogs", batchFilter, channelFilter, statusFilter, page, pageSize],
    queryFn: () =>
      listCommLogs({
        batchId: batchFilter || undefined,
        channel: channelFilter || undefined,
        status: statusFilter || undefined,
        page,
        pageSize,
      }),
    refetchInterval: 5000, // auto-refresh every 5s
    retry: 1,             // fail fast — don't spin for 30s on backend down
  });

  const logs = data?.data ?? [];
  const batchSummary = data?.batchSummary ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / pageSize);
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : "—";

  // Grand totals across all batches
  const grandTotal = batchSummary.reduce(
    (acc, b) => ({
      queued: acc.queued + b.queued,
      sent: acc.sent + b.sent,
      failed: acc.failed + b.failed,
      dlq: acc.dlq + b.dlq,
      total: acc.total + b.total,
    }),
    { queued: 0, sent: 0, failed: 0, dlq: 0, total: 0 }
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Messages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Live queue status — WhatsApp & Email sends tracked per batch
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          Auto-refreshing · last at {lastUpdated}
        </div>
      </div>

      {/* Grand totals */}
      {batchSummary.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {[
            { label: "Total", value: grandTotal.total, color: "text-foreground" },
            { label: "Queued", value: grandTotal.queued, color: "text-yellow-600" },
            { label: "Sent", value: grandTotal.sent, color: "text-green-600" },
            { label: "Failed", value: grandTotal.failed, color: "text-red-600" },
            { label: "DLQ", value: grandTotal.dlq, color: "text-red-800" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl border border-border bg-card p-4 shadow-sm text-center">
              <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="sticky top-14 z-20 -mx-4 flex items-center gap-4 border-b border-border bg-card px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {(["batches", "logs"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-2 text-sm font-medium capitalize border-b-2 transition-colors ${
              activeTab === tab
                ? "border-blue-500 text-blue-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab === "batches" ? "Batch Progress" : `All Logs (${total})`}
          </button>
        ))}
      </div>

      {isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <strong>Cannot connect to backend.</strong>{" "}
          {error instanceof Error ? error.message : "Unknown error"}<br />
          <span className="text-xs text-red-500 mt-1 block">
            Make sure the backend server is running: <code className="font-mono">bun run dev</code> in <code className="font-mono">apps/backend</code>
          </span>
        </div>
      ) : isLoading ? (
        <SkeletonTable rows={8} cols={6} />
      ) : (
        <>
          {activeTab === "batches" && (
            <BatchProgressView
              batches={batchSummary}
              page={batchPage}
              pageSize={batchPageSize}
              onPageChange={setBatchPage}
              onPageSizeChange={(s) => { setBatchPageSize(s); setBatchPage(1); }}
            />
          )}

          {activeTab === "logs" && (
            <>
              {/* Filters */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                <input
                  type="text"
                  placeholder="Filter by batch ID…"
                  value={batchFilter}
                  onChange={(e) => { setBatchFilter(e.target.value); setPage(1); }}
                  className="w-full sm:w-auto rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <select
                  value={channelFilter}
                  onChange={(e) => { setChannelFilter(e.target.value as "WHATSAPP" | "EMAIL" | ""); setPage(1); }}
                  className="w-full sm:w-auto rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">All Channels</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="EMAIL">Email</option>
                </select>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  className="w-full sm:w-auto rounded-lg border border-border bg-card px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">All Statuses</option>
                  {["QUEUED", "SENT", "DELIVERED", "FAILED", "DLQ"].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>

              <LogsTable logs={logs} />

              <div className="flex items-center justify-between">
                <select
                  value={pageSize}
                  onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  {[10, 20, 50, 100].map((s) => (
                    <option key={s} value={s}>{s} / page</option>
                  ))}
                </select>
                <Pagination page={page} totalPages={totalPages} total={total} onPageChange={setPage} />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Batch Progress View ───────────────────────────────────────────────────────

function BatchProgressView({
  batches,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  batches: BatchCommSummary[];
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const router = useRouter();
  if (batches.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        No messages queued yet. Upload a batch and start the pipeline to see progress here.
      </div>
    );
  }

  const totalPages = Math.ceil(batches.length / pageSize);
  const paged = batches.slice((page - 1) * pageSize, page * pageSize);

  return (
    <div className="space-y-3">
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Batch ID</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">File</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground min-w-[180px]">Progress</th>
            <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-muted-foreground">Total</th>
            <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-yellow-700">Queued</th>
            <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-green-700">Sent</th>
            <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-red-600">Failed</th>
            <th className="px-4 py-3 text-center text-xs font-semibold uppercase text-red-800">DLQ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-card">
          {paged.map((b) => {
            const sentPct = b.total > 0 ? Math.round(((b.sent + b.delivered) / b.total) * 100) : 0;
            const failPct = b.total > 0 ? Math.round(((b.failed + b.dlq) / b.total) * 100) : 0;
            const queuePct = b.total > 0 ? Math.round((b.queued / b.total) * 100) : 0;

            return (
              <tr key={b.batchId} className="hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3">
                  <button
                    onClick={() => router.push(`/batches/${b.batchId}`)}
                    className="rounded-md bg-blue-50 border border-blue-200 px-2 py-1 font-mono text-xs font-semibold text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    {b.batchId.slice(0, 16)}…
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {b.fileName && b.fileName !== b.batchId ? b.fileName : "—"}
                </td>
                <td className="px-4 py-3 min-w-[180px]">
                  <div className="h-2 w-full rounded-full bg-muted overflow-hidden flex">
                    <div className="h-full bg-green-500 transition-all" style={{ width: `${sentPct}%` }} />
                    <div className="h-full bg-red-400 transition-all" style={{ width: `${failPct}%` }} />
                    <div className="h-full bg-yellow-300 transition-all" style={{ width: `${queuePct}%` }} />
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">{sentPct}%</div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-center text-sm font-medium text-foreground">{b.total}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center text-sm font-semibold text-yellow-600">{b.queued}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center text-sm font-semibold text-green-600">{b.sent + b.delivered}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center text-sm font-semibold text-red-600">{b.failed}</td>
                <td className="whitespace-nowrap px-4 py-3 text-center text-sm font-semibold text-red-800">{b.dlq}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    {/* Pagination footer */}
    <div className="flex items-center justify-between">
      <select
        value={pageSize}
        onChange={(e) => { onPageSizeChange(Number(e.target.value)); }}
        className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {[10, 20, 50, 100].map((s) => (
          <option key={s} value={s}>{s} / page</option>
        ))}
      </select>
      <Pagination page={page} totalPages={totalPages} total={batches.length} onPageChange={onPageChange} />
    </div>
    </div>
  );
}

// ─── Logs Table ───────────────────────────────────────────────────────────────

function LogsTable({ logs }: { logs: CommLogEntry[] }) {
  const router = useRouter();
  if (logs.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
        No message logs match the current filters.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Batch</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Teacher</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Contact</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Ch</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Attempts</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Last attempt</th>
              <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-muted-foreground">Error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border bg-card">
            {logs.map((log) => (
              <tr key={log.id} className="hover:bg-muted/40">
                <td className="whitespace-nowrap px-4 py-3 text-sm">
                  <button
                    onClick={() => router.push(`/batches/${log.batchId}`)}
                    className="rounded-md bg-blue-50 border border-blue-200 px-2 py-1 font-mono text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                  >
                    {log.batchId.slice(0, 16)}…
                  </button>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-foreground">
                  {log.teacherName ?? "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                  {log.channel === "WHATSAPP" ? log.teacherPhone : log.teacherEmail}
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <ChannelBadge channel={log.channel} />
                </td>
                <td className="whitespace-nowrap px-4 py-3">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[log.status] ?? "bg-muted text-foreground"}`}>
                    {log.status}
                  </span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-sm text-center text-muted-foreground">
                  {log.attemptCount}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                  {log.lastAttemptAt ? formatDateTime(log.lastAttemptAt) : "—"}
                </td>
                <td className="max-w-xs px-4 py-3 text-xs text-red-600 truncate" title={log.lastError ?? ""}>
                  {log.lastError ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
