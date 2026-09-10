import { ReactNode } from "react";
import type { EmailStatus } from "../types";

export function StatusBadge({ status }: { status: EmailStatus | string }) {
  const map: Record<string, { label: string; className: string }> = {
    scheduled: { label: "Scheduled", className: "bg-amber-50 text-amber-700 ring-amber-600/20" },
    sending: { label: "Sending", className: "bg-blue-50 text-blue-700 ring-blue-600/20" },
    sent: { label: "Sent", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
    failed: { label: "Failed", className: "bg-red-50 text-red-700 ring-red-600/20" },
    running: { label: "Running", className: "bg-blue-50 text-blue-700 ring-blue-600/20" },
    completed: { label: "Completed", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/20" },
    cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-600 ring-gray-500/20" },
  };
  const cfg = map[status] ?? { label: status, className: "bg-gray-100 text-gray-600 ring-gray-500/20" };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${cfg.className}`}
    >
      {cfg.label}
    </span>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  className?: string;
}

export function Table<T extends { id: string }>({ columns, rows }: { columns: Column<T>[]; rows: T[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {columns.map((col) => (
              <th key={col.key} className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 ${col.className ?? ""}`}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50/60">
              {columns.map((col) => (
                <td key={col.key} className={`px-4 py-3 text-gray-700 ${col.className ?? ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TableSkeleton({ cols, rows = 6 }: { cols: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm" aria-label="Loading">
      <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
        <div className="flex gap-6">
          {Array.from({ length: cols }).map((_, i) => (
            <div key={i} className="h-3 w-24 animate-pulse rounded bg-gray-200" />
          ))}
        </div>
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-b border-gray-100 px-4 py-3.5 last:border-0">
          <div className="flex gap-6">
            {Array.from({ length: cols }).map((_, i) => (
              <div key={i} className="h-3.5 w-24 animate-pulse rounded bg-gray-100" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center shadow-sm">
      <div className="mb-3 rounded-full bg-brand-50 p-3">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#2553eb" strokeWidth="1.5">
          <path d="M3 8l9 6 9-6" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="3" y="4" width="18" height="16" rx="2" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-gray-500">{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-red-700">Something went wrong</p>
      <p className="mt-1 max-w-md text-sm text-red-600">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-3 text-sm font-medium text-red-700 underline hover:text-red-800">
          Try again
        </button>
      )}
    </div>
  );
}
