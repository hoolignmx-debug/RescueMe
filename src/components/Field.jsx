import { Chip } from './StatusBadge.jsx';

// Shows a labelled value. Missing data is shown explicitly - never blank, never invented.
//   restricted -> "Restricted for your role"   (backend withheld it)
//   unconfirmed -> "Unconfirmed"               (identity not verified)
//   null/''    -> "Not available"
export function Field({ label, value, restricted = false, unconfirmed = false, mono = false, children }) {
  let content;
  if (restricted) content = <span className="text-xs font-medium italic text-slate-400">Restricted for your role</span>;
  else if (unconfirmed && (value === null || value === undefined || value === '')) content = <span className="text-xs font-medium italic text-amber-600">Unconfirmed</span>;
  else if (children) content = children;
  else if (value === null || value === undefined || value === '') content = <span className="text-xs font-medium italic text-slate-400">Not available</span>;
  else content = <span className={mono ? 'font-mono text-sm' : 'text-sm font-medium text-slate-900'}>{value}</span>;

  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words">{content}</dd>
    </div>
  );
}

export const FieldGrid = ({ children, cols = 2 }) => (
  <dl className={`grid grid-cols-1 gap-x-6 gap-y-4 ${cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>{children}</dl>
);

// null = unknown (shown as "Unknown"), [] = supplied but empty (shown as "None recorded")
export function ListValue({ items, tone = 'slate', emptyLabel = 'None recorded', unknownLabel = 'Unknown / not available' }) {
  if (items === null || items === undefined) return <span className="text-xs font-medium italic text-slate-400">{unknownLabel}</span>;
  if (items.length === 0) return <span className="text-sm text-slate-500">{emptyLabel}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((x) => (
        <Chip key={x} tone={tone}>
          {x}
        </Chip>
      ))}
    </span>
  );
}

export function BloodGroup({ group, verified }) {
  if (!group) return <span className="text-xs font-medium italic text-slate-400">Not available</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="rounded-md bg-red-50 px-2 py-0.5 text-sm font-bold text-red-700 ring-1 ring-red-200">{group}</span>
      {verified ? <Chip tone="green">Verified</Chip> : <Chip tone="amber" title="Do not rely on the emergency profile for transfusion decisions">Unverified</Chip>}
    </span>
  );
}
