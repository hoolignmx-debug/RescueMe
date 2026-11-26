const TONES = {
  blue: 'bg-blue-50 text-blue-600',
  teal: 'bg-teal-50 text-teal-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
};

export default function StatCard({ icon: Icon, label, value, hint, tone = 'blue', alert = false }) {
  return (
    <div className={`card card-pad flex items-center gap-4 ${alert ? 'border-red-300 ring-1 ring-red-200' : ''}`}>
      <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${TONES[tone]}`}>
        <Icon className="h-6 w-6" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <p className={`text-3xl font-bold leading-tight ${alert && value > 0 ? 'text-red-600' : 'text-slate-900'}`}>{value ?? '—'}</p>
        {hint && <p className="truncate text-xs text-slate-400">{hint}</p>}
      </div>
    </div>
  );
}
