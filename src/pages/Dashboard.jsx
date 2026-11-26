import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Ambulance, DoorOpen, Hospital, Stethoscope, Siren, MapPin, ArrowRight, Eye, Activity } from 'lucide-react';
import { useIncidents } from '../hooks/useIncidents.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import { Loading, ErrorPanel, StaleBanner, EmptyState } from '../components/DataStates.jsx';
import { StatusBadge, SeverityBadge, DemoTag } from '../components/StatusBadge.jsx';
import { BloodGroup } from '../components/Field.jsx';
import { PatientName, MedicalList, NotAvailable, Restricted } from '../components/PatientTable.jsx';
import { isIncoming, isCritical, severityRank, STATUSES, HAS_ARRIVED } from '../utils/statuses.js';
import { etaText } from '../utils/display.js';
import { formatTime, timeAgo } from '../utils/format.js';

const byPriorityThenEta = (a, b) =>
  severityRank(a.severity) - severityRank(b.severity) || (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999);

function IncomingCard({ i, canView, onView }) {
  return (
    <article className={`rounded-xl border p-4 ${i.severity === 'CRITICAL' ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs font-bold text-slate-900">{i.id}</span>
        <SeverityBadge severity={i.severity} />
        <StatusBadge status={i.status} />
        {i.isDemo && <DemoTag />}
        <span className="ml-auto text-sm font-bold text-slate-900">ETA: {etaText(i)}</span>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Patient</dt>
          <dd><PatientName incident={i} /></dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Age</dt>
          <dd>{i.restricted ? <Restricted /> : i.age ?? <NotAvailable text="—" />}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Blood group</dt>
          <dd>
            {i.restricted ? <Restricted /> : i.bloodGroup ? <BloodGroup group={i.bloodGroup} verified={i.bloodGroupVerified} /> : <NotAvailable text={i.identityVerified ? 'Not available' : 'Unconfirmed'} />}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Ambulance</dt>
          <dd className="font-mono text-xs">{i.ambulanceId || <NotAvailable text="Not assigned" />}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Allergies</dt>
          <dd><MedicalList incident={i} items={i.allergies} tone="red" /></dd>
        </div>
        <div className="col-span-1 sm:col-span-2">
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Medical conditions</dt>
          <dd><MedicalList incident={i} items={i.conditions} tone="blue" /></dd>
        </div>
        <div className="col-span-2 sm:col-span-4">
          <dt className="text-[11px] font-semibold uppercase text-slate-500">Incident location</dt>
          <dd className="inline-flex items-start gap-1 text-slate-700">
            <MapPin className="mt-0.5 h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
            {i.locationText || <NotAvailable />}
          </dd>
        </div>
      </dl>
      {canView && (
        <div className="mt-3">
          <button type="button" className="btn-blue !py-1.5 text-xs" onClick={() => onView(i.id)}>
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> VIEW PATIENT
          </button>
        </div>
      )}
    </article>
  );
}

export default function Dashboard() {
  const { data, error, loading, refresh, updatedAt } = useIncidents();
  const { can } = useAuth();
  const navigate = useNavigate();
  const canView = can('profile.view');

  const m = useMemo(() => {
    const all = data || [];
    return {
      all,
      incoming: all.filter(isIncoming).sort(byPriorityThenEta),
      arrived: all.filter((i) => i.status === 'ARRIVED'),
      inEr: all.filter((i) => i.status === 'IN_ER'),
      treating: all.filter((i) => i.status === 'UNDER_TREATMENT'),
      critical: all.filter(isCritical),
      enRoute: all.filter((i) => i.status === 'EN_ROUTE').sort((a, b) => (a.etaMinutes ?? 9999) - (b.etaMinutes ?? 9999)),
      received: all.filter((i) => HAS_ARRIVED.includes(i.status)).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
      activity: [...all].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)).slice(0, 8),
      statusCounts: STATUSES.map((s) => ({ s, n: all.filter((i) => i.status === s).length })).filter((x) => x.n > 0),
    };
  }, [data]);

  const view = (id) => navigate(`/patients/${id}`);

  return (
    <>
      <PageHeader title="Hospital Dashboard" subtitle="Live overview of incoming and in-department emergency patients" onRefresh={refresh} refreshing={loading} updatedAt={updatedAt} />
      {loading && !data ? (
        <Loading label="Loading dashboard…" />
      ) : error && !data ? (
        <ErrorPanel error={error} onRetry={refresh} />
      ) : (
        <div className="space-y-6">
          <StaleBanner error={error} onRetry={refresh} />

          <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard icon={Ambulance} label="Total incoming" value={m.incoming.length} hint="Not yet arrived" tone="blue" />
            <StatCard icon={DoorOpen} label="Patients arrived" value={m.arrived.length} hint="Awaiting ER admission" tone="teal" />
            <StatCard icon={Hospital} label="Patients in ER" value={m.inEr.length} tone="blue" />
            <StatCard icon={Stethoscope} label="Under treatment" value={m.treating.length} tone="violet" />
            <StatCard icon={Siren} label="Critical patients" value={m.critical.length} hint="Critical/high priority, active" tone="red" alert />
          </section>

          <div className="grid gap-6 lg:grid-cols-3">
            <section className="card lg:col-span-2" aria-labelledby="alerts-h">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
                <h2 id="alerts-h" className="flex items-center gap-2 text-sm font-bold text-slate-800">
                  <Siren className="h-4 w-4 text-red-600" aria-hidden="true" /> Incoming trauma alerts
                </h2>
                <Link to="/incidents" className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:underline">
                  Full queue <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
              <div className="space-y-3 p-4">
                {m.incoming.length === 0 ? (
                  <EmptyState title="No incoming patients" message="New emergencies appear here as soon as an ambulance is assigned." />
                ) : (
                  m.incoming.map((i) => <IncomingCard key={i.id} i={i} canView={canView} onView={view} />)
                )}
              </div>
            </section>

            <div className="space-y-6">
              <section className="card" aria-labelledby="amb-h">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h2 id="amb-h" className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Ambulance className="h-4 w-4 text-amber-600" aria-hidden="true" /> Ambulance arrivals
                  </h2>
                </div>
                {m.enRoute.length === 0 ? (
                  <EmptyState title="No ambulances en route" />
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {m.enRoute.map((i) => (
                      <li key={i.id}>
                        <Link to={`/tracking/${i.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                          <span className="min-w-0">
                            <span className="block font-mono text-xs font-bold">{i.ambulanceId || 'Ambulance not assigned'}</span>
                            <span className="block truncate text-xs text-slate-500">{i.id}</span>
                          </span>
                          <span className="text-sm font-bold text-slate-900">{etaText(i)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="card" aria-labelledby="status-h">
                <div className="border-b border-slate-200 px-5 py-3">
                  <h2 id="status-h" className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <Activity className="h-4 w-4 text-blue-600" aria-hidden="true" /> Emergency incident status
                  </h2>
                </div>
                <ul className="space-y-2 p-4">
                  {m.statusCounts.length === 0 && <li className="text-sm text-slate-500">No incidents.</li>}
                  {m.statusCounts.map(({ s, n }) => (
                    <li key={s} className="flex items-center justify-between gap-2">
                      <StatusBadge status={s} />
                      <span className="text-sm font-bold text-slate-800">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="card" aria-labelledby="recent-h">
              <div className="border-b border-slate-200 px-5 py-3">
                <h2 id="recent-h" className="text-sm font-bold text-slate-800">Recently received patients</h2>
              </div>
              {m.received.length === 0 ? (
                <EmptyState title="No patients received yet" />
              ) : (
                <ul className="divide-y divide-slate-100">
                  {m.received.slice(0, 5).map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold">{i.id}</p>
                        <div className="text-sm"><PatientName incident={i} /></div>
                      </div>
                      <StatusBadge status={i.status} />
                      {canView && (
                        <button type="button" className="btn-blue !px-3 !py-1.5 text-xs" onClick={() => view(i.id)}>
                          <Eye className="h-3.5 w-3.5" aria-hidden="true" /> VIEW PATIENT
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card" aria-labelledby="activity-h">
              <div className="border-b border-slate-200 px-5 py-3">
                <h2 id="activity-h" className="text-sm font-bold text-slate-800">Recent hospital activity</h2>
                <p className="text-xs text-slate-400">Latest update per incident</p>
              </div>
              <ul className="divide-y divide-slate-100">
                {m.activity.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-16 shrink-0 font-mono text-xs text-slate-500" title={timeAgo(i.updatedAt)}>{formatTime(i.updatedAt)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-xs font-semibold">{i.id}</span> <span className="text-slate-500">→</span>
                    </span>
                    <StatusBadge status={i.status} />
                  </li>
                ))}
                {m.activity.length === 0 && <li><EmptyState title="No activity yet" /></li>}
              </ul>
            </section>
          </div>
        </div>
      )}
    </>
  );
}

