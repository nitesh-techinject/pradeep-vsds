"use client";

import { clsx } from "clsx";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  sortable?: boolean;
  /** If true, this column is hidden on mobile card view */
  mobileHidden?: boolean;
}

interface Props<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  rowClassName?: (row: T) => string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    onPageChange: (page: number) => void;
    onPageSizeChange?: (size: number) => void;
    pageSizeOptions?: number[];
  };
  isLoading?: boolean;
  emptyMessage?: string;
  /** When set, wraps table in overflow-auto with this max height for sticky header scroll (e.g. "24rem") */
  maxHeight?: string;
}

export default function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  rowClassName,
  pagination,
  isLoading,
  emptyMessage = "No data found.",
  maxHeight,
}: Props<T>) {
  const visibleColumns = columns.filter((c) => !c.mobileHidden);

  const tableWrapperClass = maxHeight
    ? "hidden min-w-0 sm:block overflow-auto"
    : "hidden min-w-0 sm:block overflow-x-auto";
  const tableWrapperStyle = maxHeight ? { maxHeight } : undefined;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm transition-colors overflow-hidden">
      {/* Desktop table: when maxHeight is set, overflow-auto creates scroll container so sticky thead works */}
      <div className={tableWrapperClass} style={tableWrapperStyle}>
          <table className="min-w-full divide-y divide-border">
            <thead className={clsx("sticky z-20 bg-muted shadow-sm border-b border-border", maxHeight ? "top-0" : "top-0")}>
              <tr>
                {columns.map((col, i) => (
                  <th
                    key={col.key}
                    className={clsx(
                      "bg-muted px-4 py-1.5 text-left text-xs font-semibold uppercase tracking-wider lg:px-4",
                      i === 0 && "rounded-tl-xl",
                      i === columns.length - 1 && "rounded-tr-xl",
                      col.className
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-6 py-12 text-center text-sm text-muted-foreground"
                  >
                    <div className="flex items-center justify-center gap-2">
                      <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
                      Loading...
                    </div>
                  </td>
                </tr>
              ) : data.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-6 py-12 text-center text-sm text-muted-foreground"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              ) : (
                data.map((row, idx) => (
                  <tr
                    key={keyExtractor(row, idx)}
                    onClick={() => onRowClick?.(row)}
                    className={clsx(
                      "transition-colors",
                      onRowClick ? "cursor-pointer hover:bg-muted/50" : "",
                      rowClassName?.(row)
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={clsx(
                          "whitespace-nowrap px-4 py-4 text-sm text-foreground lg:px-6",
                          col.className
                        )}
                      >
                        {col.render
                          ? col.render(row)
                          : String((row as Record<string, unknown>)[col.key] ?? "")}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
      </div>

      {/* Mobile card list */}
      <div className="divide-y divide-border sm:hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
            Loading...
          </div>
        ) : data.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          data.map((row, idx) => (
            <div
              key={keyExtractor(row, idx)}
              onClick={() => onRowClick?.(row)}
              className={clsx(
                "space-y-2 px-4 py-4 transition-colors",
                onRowClick ? "cursor-pointer active:bg-muted/50" : "",
                rowClassName?.(row)
              )}
            >
              {visibleColumns.map((col) => (
                <div key={col.key} className="flex items-start justify-between gap-2">
                  <span className="min-w-0 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {col.header}
                  </span>
                  <span className="min-w-0 text-right text-sm text-foreground">
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key] ?? "")}
                  </span>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.total > 0 && (
        <div className="flex flex-col items-center gap-3 border-t border-border bg-card px-4 py-3 sm:flex-row sm:justify-between sm:px-6 transition-colors">
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground">
              Page {pagination.page} of {pagination.totalPages}{" "}
              <span className="text-muted-foreground/60">({pagination.total} total)</span>
            </p>
            {pagination.onPageSizeChange && (
              <select
                value={pagination.pageSize}
                onChange={(e) => { pagination.onPageSizeChange!(Number(e.target.value)); pagination.onPageChange(1); }}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {(pagination.pageSizeOptions ?? [10, 20, 50, 100]).map((s) => (
                  <option key={s} value={s}>{s} / page</option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => pagination.onPageChange(1)}
              disabled={pagination.page <= 1}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="min-w-[2.5rem] text-center text-sm font-medium text-foreground">
              {pagination.page}
            </span>
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => pagination.onPageChange(pagination.totalPages)}
              disabled={pagination.page >= pagination.totalPages}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
