import { clsx } from "clsx";
import type { DeliveryStatus } from "@/types";

const config: Record<DeliveryStatus, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className: "bg-muted text-muted-foreground",
  },
  SENT: {
    label: "Sent",
    className: "bg-blue-100 text-blue-700",
  },
  DELIVERED: {
    label: "Delivered",
    className: "bg-green-100 text-green-700",
  },
  READ: {
    label: "Read",
    className: "bg-emerald-100 text-emerald-700",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-100 text-red-700",
  },
};

interface Props {
  status: DeliveryStatus;
}

export default function DeliveryStatusBadge({ status }: Props) {
  const c = config[status] || config.PENDING;
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        c.className
      )}
    >
      {c.label}
    </span>
  );
}
