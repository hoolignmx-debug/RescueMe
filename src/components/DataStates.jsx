import { AlertTriangle, Inbox, Loader2, RefreshCw, ShieldAlert, WifiOff, Hourglass, PlugZap } from 'lucide-react';

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500" role="status" aria-live="polite">
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

const KIND_ICON = {
  NETWORK: WifiOff,
  TIMEOUT: Hourglass,
  FORBIDDEN: ShieldAlert,
  NOT_IMPLEMENTED: PlugZap,
};

// Human-friendly heading per error kind; the message itself comes from the service layer.
const KIND_TITLE = {
  NETWORK: 'Backend unavailable',
  TIMEOUT: 'Request timed out',
  FORBIDDEN: 'Access not authorized',
  UNAUTHENTICATED: 'Session expired',
  NOT_FOUND: 'Record not found',
  NOT_IMPLEMENTED: 'Not supported by the backend yet',
  DUPLICATE: 'Duplicate entry',
  INVALID_TRANSITION: 'Invalid status change',
  CONFLICT: 'Action not possible right now',
  VALIDATION: 'The server rejected the data',
  SERVER: 'Backend error',
};

export function ErrorPanel({ error, onRetry, compact = false }) {
  if (!error) return null;
  const Icon = KIND_ICON[error.kind] || AlertTriangle;
  const title = KIND_TITLE[error.kind] || 'Something went wrong';
  return (
    <div role="alert" className={`rounded-2xl border border-red-200 bg-red-50 text-red-900 ${compact ? 'p-3' : 'p-5'}`}>
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-red-600" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-0.5 text-sm">{error.message || 'An unexpected error occurred.'}</p>
          {onRetry && (
            <button type="button" onClick={onRetry} className="btn-ghost mt-3 !py-1.5 text-xs">
              <RefreshCw className="h-3.5 w-3.5" /> Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Shown above stale data when a background refresh fails.
export function StaleBanner({ error, onRetry }) {
  if (!error) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">Could not refresh: {error.message} Showing the last data received.</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title = 'Nothing to show', message, icon: Icon = Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
      <Icon className="h-8 w-8 text-slate-300" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {message && <p className="max-w-md text-sm text-slate-500">{message}</p>}
    </div>
  );
}

export function InfoNote({ tone = 'sky', icon: Icon, children }) {
  const tones = {
    sky: 'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-300 bg-amber-50 text-amber-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    fuchsia: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-900',
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${tones[tone]}`}>
      {Icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}
