import { RefreshCw } from 'lucide-react';
import { formatTime } from '../utils/format.js';

export default function PageHeader({ title, subtitle, actions, onRefresh, refreshing, updatedAt }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {updatedAt && <span className="text-xs text-slate-400">Updated {formatTime(updatedAt)}</span>}
        {actions}
        {onRefresh && (
          <button type="button" className="btn-ghost" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
        )}
      </div>
    </div>
  );
}
