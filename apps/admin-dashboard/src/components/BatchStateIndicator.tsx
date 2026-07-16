import { clsx } from "clsx";
import type { BatchStatus } from "@/types";

const statusConfig: Record<string, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "bg-muted text-foreground border-border",
  },
  VALIDATING: {
    label: "Validating",
    className: "bg-amber-100 text-amber-700 border-amber-300",
  },
  UPLOADED: {
    label: "Uploaded",
    className: "bg-muted text-foreground border-border",
  },
  RESOLVING: {
    label: "Resolving",
    className: "bg-indigo-100 text-indigo-700 border-indigo-300",
  },
  ORDERING: {
    label: "Creating Orders",
    className: "bg-purple-100 text-purple-700 border-purple-300",
  },
  CREATING_ORDERS: {
    label: "Creating Orders",
    className: "bg-purple-100 text-purple-700 border-purple-300",
  },
  AGGREGATING: {
    label: "Aggregating",
    className: "bg-cyan-100 text-cyan-700 border-cyan-300",
  },
  MESSAGING: {
    label: "Dispatching",
    className: "bg-blue-100 text-blue-700 border-blue-300",
  },
  DISPATCHING: {
    label: "Dispatching",
    className: "bg-blue-100 text-blue-700 border-blue-300",
  },
  PARTIAL_FAILURE: {
    label: "Partial Failure",
    className: "bg-orange-100 text-orange-700 border-orange-300",
  },
  PAUSED: {
    label: "Paused",
    className: "bg-yellow-100 text-yellow-700 border-yellow-300",
  },
  COMPLETE: {
    label: "Complete",
    className: "bg-green-100 text-green-700 border-green-300",
  },
  CANCELLED: {
    label: "Cancelled",
    className: "bg-red-100 text-red-700 border-red-300",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-100 text-red-700 border-red-300",
  },
};

interface Props {
  status: BatchStatus;
  size?: "sm" | "md";
}

export default function BatchStateIndicator({ status, size = "sm" }: Props) {
  const config = statusConfig[status] || statusConfig.PENDING;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border font-medium",
        config.className,
        size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm"
      )}
    >
      <span
        className={clsx(
          "mr-1.5 inline-block rounded-full",
          size === "sm" ? "h-1.5 w-1.5" : "h-2 w-2",
          status === "COMPLETE" && "bg-green-500",
          (status === "DISPATCHING" || status === "MESSAGING") && "bg-blue-500 animate-pulse",
          status === "PAUSED" && "bg-yellow-500",
          status === "CANCELLED" && "bg-red-500",
          status === "FAILED" && "bg-red-500",
          (status === "PENDING" || status === "UPLOADED" || status === "VALIDATING") && "bg-muted-foreground/40",
          status === "RESOLVING" && "bg-indigo-500 animate-pulse",
          (status === "CREATING_ORDERS" || status === "ORDERING") && "bg-purple-500 animate-pulse",
          status === "AGGREGATING" && "bg-cyan-500 animate-pulse"
        )}
      />
      {config.label}
    </span>
  );
}
