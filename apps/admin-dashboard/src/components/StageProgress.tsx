import Link from "next/link";
import { clsx } from "clsx";
import type { StageProgress as StageProgressType } from "@/types";

interface Props {
  stage: StageProgressType;
  batchId: string;
}

export default function StageProgress({ stage, batchId }: Props) {
  const percentage =
    stage.total > 0 ? Math.round((stage.completed / stage.total) * 100) : 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{stage.stage}</span>
        <span className="text-muted-foreground">
          {stage.completed}/{stage.total} ({percentage}%)
        </span>
      </div>
      <div className="h-2.5 w-full rounded-full bg-muted-foreground/20">
        <div
          className={clsx(
            "h-2.5 rounded-full transition-all duration-500",
            percentage === 100
              ? "bg-emerald-500"
              : percentage > 0
              ? "bg-primary"
              : "bg-muted-foreground/30"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {stage.failed > 0 && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-destructive">
            {stage.failed} failed
          </span>
          <Link
            href={`/batches/${batchId}/errors?stage=${stage.stage}`}
            className="text-primary hover:underline"
          >
            View errors
          </Link>
        </div>
      )}
    </div>
  );
}
