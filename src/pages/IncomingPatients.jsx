import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { useIncidents } from '../hooks/useIncidents.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import PatientTable from '../components/PatientTable.jsx';
import { Loading, ErrorPanel, StaleBanner, EmptyState } from '../components/DataStates.jsx';
import { STATUSES, STATUS_META, severityRank } from '../utils/statuses.js';

const SORTS = {
  priority: { label: 'Priority (highest first)', fn: (a, b) => severityRank(a.severity) - severityRank(b.severity) || (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999) },
  etaAsc: { label: 'ETA (soonest first)', fn: (a, b) => (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999) || severityRank(a.severity) - severityRank(b.severity) },
  etaDesc: { label: 'ETA (latest first)', fn: (a, b) => (b.etaMinutes ?? -1) - (a.etaMinutes ?? -1) },
};

export default function IncomingPatients() {
  const { data, error, loading, refresh, updatedAt } = useIncidents();
  const { can } = useAuth();
  const navigate = useNavigate();
  const [idQuery, setIdQuery] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState('priority');
  const [hideClosed, setHideClosed] = useState(true);
  const canViewNames = can('profile.view');

  const rows = useMemo(() => {
    const idQ = idQuery.trim().toLowerCase();
    const nameQ = nameQuery.trim().toLowerCase();
    return (data || [])
      .filter((i) => (status === 'ALL' ? true : i.status === status))
      .filter((i) => !(hideClosed && status === 'ALL' && i.status === 'CLOSED'))
      .filter((i) => !idQ || i.id.toLowerCase().includes(idQ))
      // names are only searchable when they are verified, authorized and displayed
      .filter((i) => !nameQ || (i.patientName && i.patientName.toLowerCase().includes(nameQ)))
      .sort(SORTS[sort].fn);
  }, [data, idQuery, nameQuery, status, sort, hideClosed]);

  const filtersActive = idQuery || nameQuery || status !== 'ALL';

  return (
    <>
      <PageHeader title="Incoming Trauma Queue" subtitle="All incidents routed to this hospital" onRefresh={refresh} refreshing={loading} updatedAt={updatedAt} />

      <div className="card card-pad mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className="label" htmlFor="q-id">Search by Incident ID</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input id="q-id" className="input pl-9" placeholder="INC-2026-0001" value={idQuery} onChange={(e) => setIdQuery(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="q-name">Search by patient name</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
              <input id="q-name" className="input pl-9" placeholder="Verified names only" value={nameQuery} onChange={(e) => setNameQuery(e.target.value)} disabled={!canViewNames} title={canViewNames ? '' : 'Your role cannot view patient names'} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="f-status">Filter by status</label>
            <select id="f-status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="ALL">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label} ({s})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="f-sort">Sort by</label>
            <select id="f-sort" className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-3">
            <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
              <input type="checkbox" checked={hideClosed} onChange={(e) => setHideClosed(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-teal-600" />
              Hide closed
            </label>
            {filtersActive && (
              <button type="button" className="btn-ghost !py-2 text-xs" onClick={() => { setIdQuery(''); setNameQuery(''); setStatus('ALL'); }}>
                <X className="h-3.5 w-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {loading && !data ? (
        <Loading label="Loading incoming patients…" />
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={refresh} />
      ) : (
        <div className="space-y-3">
          <StaleBanner error={error} onRetry={refresh} />
          <div className="card overflow-hidden">
            <div className="border-b border-slate-200 px-5 py-2.5 text-xs text-slate-500">
              Showing <strong className="text-slate-800">{rows.length}</strong> of {data?.length ?? 0} incidents
            </div>
            {rows.length === 0 ? (
              <EmptyState title="No incidents match" message={filtersActive ? 'Try clearing the filters.' : 'No incoming patients at the moment.'} />
            ) : (
              <PatientTable incidents={rows} canView={can('profile.view')} onView={(id) => navigate(`/patients/${id}`)} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
