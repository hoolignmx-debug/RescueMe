import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, X, ShieldCheck } from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { listAudit } from '../services/hospitalService.js';
import PageHeader from '../components/PageHeader.jsx';
import { StatusBadge, Chip } from '../components/StatusBadge.jsx';
import { Loading, ErrorPanel, StaleBanner, EmptyState, InfoNote } from '../components/DataStates.jsx';
import { formatDateTime } from '../utils/format.js';
import { roleLabel } from '../utils/permissions.js';

const ACTION_META = {
  LOGIN: { label: 'Signed in', tone: 'slate' },
  LOGOUT: { label: 'Signed out', tone: 'slate' },
  PROFILE_VIEWED: { label: 'Emergency profile accessed', tone: 'sky' },
  TRACKING_VIEWED: { label: 'Ambulance tracking viewed', tone: 'sky' },
  BLOODBANK_VIEWED: { label: 'Blood bank viewed', tone: 'sky' },
  NOTES_VIEWED: { label: 'Handoff records viewed', tone: 'sky' },
  HANDOFF_SUBMITTED: { label: 'Handoff submitted', tone: 'blue' },
  HANDOFF_ACCEPTED: { label: 'Handoff accepted', tone: 'green' },
  NOTE_ADDED: { label: 'Treatment note added', tone: 'blue' },
  STATUS_CHANGED: { label: 'Patient status changed', tone: 'violet' },
  RECORD_CLOSED: { label: 'Patient record closed', tone: 'gray' },
  ACCESS_DENIED: { label: 'Access denied', tone: 'red' },
};
const actionMeta = (a) => ACTION_META[a] || { label: a.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), tone: 'slate' };

// "Access history" = anyone who viewed/accessed records, as opposed to changed them.
const ACCESS_ACTIONS = new Set(['PROFILE_VIEWED', 'TRACKING_VIEWED', 'BLOODBANK_VIEWED', 'NOTES_VIEWED', 'ACCESS_DENIED', 'LOGIN', 'LOGOUT']);

const VIEWS = { ALL: 'All events', CHANGES: 'Changes & clinical actions', ACCESS: 'Access history' };

export default function AuditHistory() {
  const { data, error, loading, refresh, updatedAt } = useAsyncData(() => listAudit({ limit: 500 }), []);
  const [view, setView] = useState('ALL');
  const [incident, setIncident] = useState('');
  const [staff, setStaff] = useState('');
  const [action, setAction] = useState('ALL');

  const rows = useMemo(() => {
    const inc = incident.trim().toLowerCase();
    const st = staff.trim().toLowerCase();
    return (data || [])
      .filter((r) => (view === 'ALL' ? true : view === 'ACCESS' ? ACCESS_ACTIONS.has(r.action) : !ACCESS_ACTIONS.has(r.action)))
      .filter((r) => action === 'ALL' || r.action === action)
      .filter((r) => !inc || (r.incidentId || '').toLowerCase().includes(inc))
      .filter((r) => !st || `${r.staffId || ''} ${r.staffName || ''}`.toLowerCase().includes(st))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
  }, [data, view, incident, staff, action]);

  const actions = useMemo(() => [...new Set((data || []).map((r) => r.action))].sort(), [data]);
  const filtersActive = view !== 'ALL' || incident || staff || action !== 'ALL';

  return (
    <>
      <PageHeader title="Audit & History" subtitle="Who accessed or changed which record, and when" onRefresh={refresh} refreshing={loading} updatedAt={updatedAt} />
      <div className="space-y-4">
        <InfoNote tone="sky" icon={ShieldCheck}>Audit records are written by the backend and are read-only here. Visible to hospital administrators only.</InfoNote>

        <div className="card card-pad">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="label" htmlFor="a-view">View</label>
              <select id="a-view" className="input" value={view} onChange={(e) => setView(e.target.value)}>
                {Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="label" htmlFor="a-inc">Incident ID</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                <input id="a-inc" className="input pl-9" placeholder="INC-2026-0001" value={incident} onChange={(e) => setIncident(e.target.value)} />
              </div>
            </div>
            <div>
              <label className="label" htmlFor="a-staff">Staff ID / name</label>
              <input id="a-staff" className="input" value={staff} onChange={(e) => setStaff(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="a-action">Action</label>
              <select id="a-action" className="input" value={action} onChange={(e) => setAction(e.target.value)}>
                <option value="ALL">All actions</option>
                {actions.map((a) => <option key={a} value={a}>{actionMeta(a).label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              {filtersActive && (
                <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => { setView('ALL'); setIncident(''); setStaff(''); setAction('ALL'); }}>
                  <X className="h-3.5 w-3.5" /> Clear filters
                </button>
              )}
            </div>
          </div>
        </div>

        {loading && !data ? (
          <Loading label="Loading audit records…" />
        ) : error && !data ? (
          <ErrorPanel error={error} onRetry={refresh} />
        ) : (
          <>
            <StaleBanner error={error} onRetry={refresh} />
            <div className="card overflow-hidden">
              <div className="border-b border-slate-200 px-5 py-2.5 text-xs text-slate-500">
                Showing <strong className="text-slate-800">{rows.length}</strong> of {data?.length ?? 0} records
              </div>
              {rows.length === 0 ? (
                <EmptyState title="No audit records match" message={filtersActive ? 'Try clearing the filters.' : 'Nothing has been recorded yet.'} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-100">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th">Date &amp; time</th><th className="th">Incident ID</th><th className="th">Staff ID</th><th className="th">Role</th>
                        <th className="th">Action</th><th className="th">Status change</th><th className="th">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {rows.map((r) => {
                        const m = actionMeta(r.action);
                        return (
                          <tr key={r.id} className="hover:bg-slate-50/60">
                            <td className="td whitespace-nowrap text-xs">{formatDateTime(r.timestamp)}</td>
                            <td className="td">{r.incidentId ? <Link to={`/timeline/${r.incidentId}`} className="font-mono text-xs font-semibold text-teal-700 hover:underline">{r.incidentId}</Link> : <span className="text-slate-400">—</span>}</td>
                            <td className="td"><span className="font-mono text-xs">{r.staffId || '—'}</span>{r.staffName && <span className="block text-xs text-slate-500">{r.staffName}</span>}</td>
                            <td className="td text-xs">{r.staffRole ? roleLabel(r.staffRole) : '—'}</td>
                            <td className="td"><Chip tone={m.tone}>{m.label}</Chip></td>
                            <td className="td">
                              {r.fromStatus || r.toStatus ? (
                                <span className="inline-flex flex-wrap items-center gap-1">
                                  {r.fromStatus ? <StatusBadge status={r.fromStatus} /> : null}
                                  <span aria-hidden="true">→</span>
                                  {r.toStatus ? <StatusBadge status={r.toStatus} /> : null}
                                </span>
                              ) : <span className="text-slate-400">—</span>}
                            </td>
                            <td className="td max-w-xs text-xs text-slate-600">{r.details || '—'}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
