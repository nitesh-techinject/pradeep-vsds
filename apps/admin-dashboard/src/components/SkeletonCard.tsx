export default function SkeletonCard() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 animate-pulse space-y-3">
      <div className="h-4 bg-muted rounded w-1/3" />
      <div className="h-3 bg-muted/60 rounded w-2/3" />
      <div className="h-3 bg-muted/60 rounded w-1/2" />
    </div>
  );
}
