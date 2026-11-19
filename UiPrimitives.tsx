import React from 'react';
import { AlertCircle, Inbox } from 'lucide-react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
      ))}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between gap-4 text-sm text-red-900"
    >
      <div className="flex items-center gap-2.5">
        <AlertCircle className="w-4 h-4 text-red-700 shrink-0" />
        <span>{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="px-3 py-1.5 bg-white border border-red-300 rounded-md text-xs font-medium text-red-800 hover:bg-red-100 whitespace-nowrap shrink-0"
        >
          Retry Request
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg py-12 px-6 text-center">
      <Inbox className="w-8 h-8 text-slate-400 mx-auto mb-3" />
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <p className="text-sm text-slate-600 max-w-md mx-auto mt-1">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

/**
 * Clean unboxed semantic status text following anti-slop zero-pill discipline:
 * never wraps static status labels in rounded pill chips, and always conveys state via explicit words.
 */
export function StatusText({
  status,
}: {
  status: string;
}) {
  const normalized = status.toUpperCase();
  let tone = 'text-slate-700';
  if (
    ['ACTIVE', 'PAID', 'COMPLETED', 'POSTED', 'APPROVED', 'PRESENT', 'CHECKED_IN', 'CHECKED_OUT', 'DISBURSED', 'REVIEWED', 'DELIVERED', 'LIVE', 'SUCCESS'].includes(
      normalized
    )
  ) {
    tone = 'text-emerald-700 font-semibold';
  } else if (
    ['PARTIAL', 'PARTIALLY_COMPLETED', 'PENDING', 'IN_PROGRESS', 'LATE', 'DRAFT', 'DEV_SANDBOX', 'SANDBOX_SIMULATED_NO_CREDENTIALS', 'ON_LEAVE', 'MANUAL_OVERRIDE'].includes(
      normalized
    )
  ) {
    tone = 'text-amber-700 font-semibold';
  } else if (
    ['OVERDUE', 'ABSENT', 'CANCELLED', 'REVERSED', 'REJECTED', 'SUSPENDED', 'WITHDRAWN', 'EXCEPTION_FLAGGED', 'DENIED', 'FAILURE'].includes(
      normalized
    )
  ) {
    tone = 'text-red-700 font-semibold';
  }

  return <span className={`text-xs ${tone}`}>{status.replace(/_/g, ' ')}</span>;
}

export function ModalDialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto no-print"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-white border border-slate-200 rounded-xl shadow-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-200 rounded-md"
          >
            Close
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
