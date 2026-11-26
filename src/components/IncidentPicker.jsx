import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useIncidents } from '../hooks/useIncidents.js';
import { Loading, ErrorPanel, EmptyState } from './DataStates.jsx';
import { StatusBadge, SeverityBadge } from './StatusBadge.jsx';
import { PatientName } from './PatientTable.jsx';
import { etaText } from '../utils/display.js';

// Pages 5-9 are per-incident. When opened from the sidebar without an incident,
// this lets staff pick one. `basePath` is e.g. "/tracking".
export default function IncidentPicker({ basePath, title = 'Select an incident', filter }) {
  const navigate = useNavigate();
  const { data, error, loading, refresh } = useIncidents({ poll: false });

  if (loading && !data) return <Loading label="Loading incidents…" />;
  if (error && !data) return <ErrorPanel error={error} onRetry={refresh} />;
  const items = (data || []).filter(filter || (() => true));

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      {items.length === 0 ? (
        <EmptyState title="No incidents available" message="Incidents appear here when the EMS module assigns an ambulance." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => navigate(`${basePath}/${i.id}`)} className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-slate-50">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-slate-900">{i.id}</p>
                  <div className="mt-0.5 text-sm">
                    <PatientName incident={i} />
                  </div>
                </div>
                <SeverityBadge severity={i.severity} />
                <StatusBadge status={i.status} />
                <span className="hidden w-24 text-right text-xs text-slate-500 sm:block">ETA: {etaText(i)}</span>
                <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
