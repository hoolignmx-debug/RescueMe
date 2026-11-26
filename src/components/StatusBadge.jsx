import { STATUS_META } from '../utils/statuses.js';

const TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  teal: 'bg-teal-50 text-teal-700 ring-teal-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  gray: 'bg-gray-100 text-gray-600 ring-gray-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
};

const pill = 'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset';

export function StatusBadge({ status, showCode = false }) {
  const meta = STATUS_META[status] || STATUS_META.UNKNOWN;
  return (
    <span className={`${pill} ${TONES[meta.tone]}`} title={status}>
      {meta.label}
      {showCode && <span className="font-mono text-[10px] opacity-70">{status}</span>}
    </span>
  );
}

const SEVERITY_TONE = { CRITICAL: 'red', HIGH: 'orange', MEDIUM: 'amber', LOW: 'green', UNKNOWN: 'gray' };

export function SeverityBadge({ severity }) {
  const tone = SEVERITY_TONE[severity] || 'gray';
  const critical = severity === 'CRITICAL';
  return (
    <span className={`${pill} ${critical ? 'bg-red-600 text-white ring-red-700' : TONES[tone]}`}>
      {critical && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" aria-hidden="true" />}
      {severity === 'UNKNOWN' ? 'Priority unknown' : `${severity.charAt(0)}${severity.slice(1).toLowerCase()} priority`}
    </span>
  );
}

export function Chip({ tone = 'slate', children, title }) {
  return (
    <span className={`${pill} ${TONES[tone]}`} title={title}>
      {children}
    </span>
  );
}

export function DemoTag() {
  return (
    <span className={`${pill} bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200`} title="Synthetic record - not a real patient">
      DEMO DATA
    </span>
  );
}
