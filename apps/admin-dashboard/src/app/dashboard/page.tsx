"use client";

import { useRouter } from "next/navigation";
import StatsCard from "@/components/StatsCard";
import DataTable, { type Column } from "@/components/DataTable";
import BatchStateIndicator from "@/components/BatchStateIndicator";
import LoadingSpinner from "@/components/LoadingSpinner";
import { Layers, MessageSquare, AlertTriangle, CheckCircle, TrendingUp } from "lucide-react";
import type { Batch, DashboardStats } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { getDashboardStats, listBatches } from "@/services/api";
import { formatDate } from "@/utils/date";

const batchColumns: Column<Batch>[] = [
  {
    key: "id",
    header: "Batch ID",
    render: (row) => <span className="font-mono text-sm font-medium">{row.id}</span>,
  },
  {
    key: "fileName",
    header: "File",
    render: (row) => <span className="text-sm text-muted-foreground">{row.fileName ?? "—"}</span>,
    mobileHidden: true,
  },
  {
    key: "status",
    header: "Status",
    render: (row) => <BatchStateIndicator status={row.status} />,
  },
  {
    key: "stats",
    header: "Teachers",
    render: (row) => (
      <span className="text-sm">{row.stats?.totalTeachers ?? 0}</span>
    ),
    mobileHidden: true,
  },
  {
    key: "createdAt",
    header: "Created",
    render: (row) => formatDate(row.createdAt),
  },
];

export default function DashboardPage() {
  const router = useRouter();

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: getDashboardStats,
  });

  const { data: recentBatchesData, isLoading: batchesLoading } = useQuery({
    queryKey: ["recent-batches"],
    queryFn: () => listBatches({ pageSize: 5 }),
  });

  const recentBatches = recentBatchesData?.data ?? [];

  if (statsLoading || batchesLoading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Overview of the Vendor Specimen Distribution System
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-6 lg:grid-cols-5">
        <StatsCard
          title="Total Batches"
          value={stats?.totalBatches ?? 0}
          icon={Layers}
          color="blue"
        />
        <StatsCard
          title="Active Batches"
          value={stats?.activeBatches ?? 0}
          icon={TrendingUp}
          color="purple"
        />
        <StatsCard
          title="Messages Sent"
          value={stats?.messagesSent.toLocaleString() ?? "0"}
          icon={MessageSquare}
          color="green"
        />
        <StatsCard
          title="Delivered"
          value={stats?.messagesDelivered.toLocaleString() ?? "0"}
          icon={CheckCircle}
          color="orange"
        />
        <StatsCard
          title="DLQ"
          value={stats?.dlqCount ?? 0}
          icon={AlertTriangle}
          color="red"
        />
      </div>

      {/* Recent Batches */}
      <div>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recent Batches</h2>
          <a href="/batches" className="text-sm font-medium text-blue-600 hover:text-blue-800">
            View all
          </a>
        </div>
        <DataTable
          columns={batchColumns}
          data={recentBatches}
          keyExtractor={(row) => row.id}
          onRowClick={(row) => router.push(`/batches/${row.id}`)}
        />
      </div>
    </div>
  );
}
