import { clsx } from "clsx";
import type { StatusHistoryEntry } from "@/types";
import { CheckCircle, Clock, Pause, XCircle, Loader } from "lucide-react";

const statusIcon: Record<string, typeof CheckCircle> = {
  COMPLETE: CheckCircle,
  CANCELLED: XCircle,
  FAILED: XCircle,
  PAUSED: Pause,
  PENDING: Clock,
};

const statusColor: Record<string, string> = {
  COMPLETE: "text-green-500",
  CANCELLED: "text-red-500",
  FAILED: "text-red-500",
  PAUSED: "text-yellow-500",
  PENDING: "text-muted-foreground/70",
  RESOLVING: "text-indigo-500",
  CREATING_ORDERS: "text-purple-500",
  AGGREGATING: "text-cyan-500",
  DISPATCHING: "text-blue-500",
};

interface Props {
  history: StatusHistoryEntry[];
}

export default function StatusTimeline({ history }: Props) {
  return (
    <div className="flow-root">
      <ul className="-mb-8">
        {history.map((entry, idx) => {
          const status = entry.to ?? "UNKNOWN";
          const Icon = statusIcon[status] || Loader;
          const color = statusColor[status] || "text-muted-foreground/70";
          const isLast = idx === history.length - 1;
          const reason = entry.trigger;

          return (
            <li key={idx}>
              <div className="relative pb-8">
                {!isLast && (
                  <span
                    className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-muted-foreground/20"
                    aria-hidden="true"
                  />
                )}
                <div className="relative flex items-start space-x-3">
                  <div className={clsx("flex h-8 w-8 items-center justify-center", color)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                      {String(status).replace(/_/g, " ")}
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {entry.timestamp
                        ? new Date(entry.timestamp).toLocaleString()
                        : "—"}
                    </p>
                    {reason && (
                      <p className="mt-1 text-xs text-muted-foreground">{reason}</p>
                    )}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
