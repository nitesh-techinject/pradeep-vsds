"use client";

import { clsx } from "clsx";
import Link from "next/link";
import {
  UserCheck,
  Package,
  Layers,
  Send,
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import type { StageProgress, DeliveryBreakdown, StatusHistoryEntry } from "@/types";

const STAGE_CONFIG: Record<string, { icon: typeof UserCheck; label: string }> = {
  RESOLUTION: { icon: UserCheck, label: "Teacher Resolution" },
  ORDERS: { icon: Package, label: "Create Orders" },
  ORDERING: { icon: Package, label: "Create Orders" },
  CREATING_ORDERS: { icon: Package, label: "Create Orders" },
  AGGREGATION: { icon: Layers, label: "Aggregate Links" },
  MESSAGES: { icon: Send, label: "Send Messages" },
  MESSAGING: { icon: Send, label: "Send Messages" },
  DISPATCHING: { icon: Send, label: "Send Messages" },
};

interface Props {
  stages: StageProgress[];
  deliveryStatus: DeliveryBreakdown;
  statusHistory: StatusHistoryEntry[];
  batchId: string;
}

export default function BatchTimeline({
  stages,
  deliveryStatus,
  statusHistory,
  batchId,
}: Props) {
  const ds = deliveryStatus ?? { delivered: 0, failed: 0, pending: 0 };
  const totalDelivery = ds.pending + ds.delivered + ds.failed;
  const deliveryPct = totalDelivery > 0 ? Math.round((ds.delivered / totalDelivery) * 100) : 0;

  return (
    <div className="relative min-w-0">
      <div className="space-y-0">
        {(stages ?? []).map((stage, idx) => {
          const config = STAGE_CONFIG[stage.stage] ?? { icon: Package, label: stage.stage };
          const Icon = config.icon;
          const pct = stage.total > 0 ? Math.round((stage.completed / stage.total) * 100) : 0;
          const isComplete = pct === 100 && stage.failed === 0;
          const isInProgress = pct > 0 && pct < 100;
          const hasFailed = stage.failed > 0;

          return (
            <div key={stage.stage} className="relative flex gap-4">
              {/* Connector line from previous node */}
              {idx > 0 && (
                <div
                  className="absolute left-[17px] w-px bg-muted-foreground/25"
                  style={{ top: -24, height: 24 }}
                />
              )}
              {/* Node */}
              <div
                className={clsx(
                  "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                  isComplete && "border-emerald-500 bg-emerald-500/15",
                  isInProgress && "border-primary bg-primary/15",
                  hasFailed && "border-destructive/50 bg-destructive/10",
                  !isComplete && !isInProgress && !hasFailed && "border-muted-foreground/30 bg-muted/30"
                )}
              >
                {isInProgress ? (
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : isComplete ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                ) : hasFailed ? (
                  <AlertCircle className="h-4 w-4 text-destructive" />
                ) : (
                  <Icon className="h-4 w-4 text-muted-foreground" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-6">
                <div className="rounded-lg border border-border/60 bg-card/50 p-3 shadow-sm">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-foreground">{config.label}</h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {stage.completed} of {stage.total} complete
                        {stage.failed > 0 && (
                          <span className="ml-2 text-destructive">
                            · {stage.failed} failed
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted/60">
                        <div
                          className={clsx(
                            "h-full rounded-full transition-all duration-500",
                            isComplete ? "bg-emerald-500" : "bg-primary/80"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs font-medium text-muted-foreground w-10">
                        {pct}%
                      </span>
                    </div>
                  </div>
                  {stage.failed > 0 && (
                    <Link
                      href={`/batches/${batchId}/errors?stage=${stage.stage}`}
                      className="mt-3 inline-flex text-xs font-medium text-primary hover:underline"
                    >
                      View errors →
                    </Link>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {/* Delivery summary node */}
        {totalDelivery > 0 && (
          <div className="relative flex gap-4">
            <div className="absolute left-[17px] w-px bg-muted-foreground/25" style={{ top: -24, height: 24 }} />
            <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-emerald-500/50 bg-emerald-500/10">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0 pb-6">
              <div className="rounded-lg border border-border/60 bg-card/50 p-3 shadow-sm">
                <h3 className="font-semibold text-foreground">Delivery</h3>
                <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-muted/60">
                  {[
                    { label: "Pending", count: ds.pending, color: "bg-muted-foreground/40" },
                    { label: "Delivered", count: ds.delivered, color: "bg-emerald-500" },
                    { label: "Failed", count: ds.failed, color: "bg-red-500" },
                  ].map((item) => {
                    const pct = totalDelivery > 0 ? (item.count / totalDelivery) * 100 : 0;
                    return pct > 0 ? (
                      <div
                        key={item.label}
                        className={`${item.color} transition-all`}
                        style={{ width: `${pct}%` }}
                        title={`${item.label}: ${item.count}`}
                      />
                    ) : null;
                  })}
                </div>
                <div className="mt-2 flex gap-6 text-xs text-muted-foreground">
                  <span>Pending: {ds.pending}</span>
                  <span className="text-emerald-600 dark:text-emerald-400">Delivered: {ds.delivered}</span>
                  {ds.failed > 0 && <span className="text-destructive">Failed: {ds.failed}</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Status history — collapsible */}
      {statusHistory && statusHistory.length > 0 && (
        <StatusHistorySection history={statusHistory} />
      )}
    </div>
  );
}

function StatusHistorySection({ history }: { history: StatusHistoryEntry[] }) {
  return (
    <div className="relative flex gap-4">
      <div className="absolute left-[17px] w-px bg-muted-foreground/25" style={{ top: -24, height: 24 }} />
      <div className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/20 bg-muted/30">
        <Circle className="h-3.5 w-3.5 text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <details className="group rounded-lg border border-border/60 bg-muted/20">
          <summary className="flex cursor-pointer items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/30 transition-colors list-none [&::-webkit-details-marker]:hidden">
            <span>Status history</span>
            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border/60 px-4 py-3">
            <ul className="space-y-2">
              {history.map((entry, idx) => {
                const reason = entry.trigger;
                return (
                  <li key={idx} className="flex items-start gap-3 text-sm">
                    <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
                    <div>
                      <span className="font-medium text-foreground">
                        {entry.from} → {entry.to}
                      </span>
                      <p className="text-xs text-muted-foreground">
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleString() : "—"}
                        {reason && ` · ${reason}`}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </details>
      </div>
    </div>
  );
}
