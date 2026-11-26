import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Droplets, FlaskConical, ShieldAlert, AlertTriangle } from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { getBloodBank } from '../services/hospitalService.js';
import { config } from '../config.js';
import PageHeader from '../components/PageHeader.jsx';
import IncidentPicker from '../components/IncidentPicker.jsx';
import { Field, FieldGrid, BloodGroup } from '../components/Field.jsx';
import { Chip } from '../components/StatusBadge.jsx';
import { Loading, ErrorPanel, StaleBanner, InfoNote } from '../components/DataStates.jsx';
import { formatDateTime } from '../utils/format.js';

const AVAILABILITY = {
  AVAILABLE: { label: 'Available', tone: 'green' },
  LOW: { label: 'Low stock', tone: 'amber' },
  UNAVAILABLE: { label: 'Unavailable', tone: 'red' },
  CHECKING: { label: 'Checking', tone: 'sky' },
  UNKNOWN: { label: 'Unknown', tone: 'gray' },
};
const PREPARATION = {
  NOT_STARTED: { label: 'Not started', tone: 'gray' },
  IN_PROGRESS: { label: 'In progress', tone: 'amber' },
  READY: { label: 'Ready (informational)', tone: 'green' },
  UNKNOWN: { label: 'Unknown', tone: 'gray' },
};

export default function BloodBank() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const q = useAsyncData(() => getBloodBank(incidentId), [incidentId], { enabled: !!incidentId, intervalMs: config.pollIntervalMs });

  if (!incidentId) {
    return (
      <>
        <PageHeader title="Blood Bank Preparation" subtitle="Choose an incident" />
        <IncidentPicker basePath="/blood-bank" />
      </>
    );
  }

  const b = q.data;
  const avail = AVAILABILITY[b?.availability] || AVAILABILITY.UNKNOWN;
  const prep = PREPARATION[b?.preparation] || PREPARATION.UNKNOWN;
  const verificationText = !b?.bloodGroup ? 'Not available' : b.verified ? 'Verified' : 'Pending — not clinically verified';

  return (
    <>
      <PageHeader
        title="Blood Bank Preparation"
        subtitle={incidentId}
        onRefresh={q.refresh}
        refreshing={q.loading}
        updatedAt={q.updatedAt}
        actions={<button type="button" className="btn-ghost" onClick={() => navigate('/blood-bank')}><ArrowLeft className="h-4 w-4" /> All incidents</button>}
      />
      <div className="space-y-5">
        <InfoNote tone="red" icon={ShieldAlert}>
          <strong>Informational preparation aid only.</strong> Blood units are never selected or issued from an emergency profile.
          Clinical blood typing, compatibility testing and hospital protocols must always be followed.
        </InfoNote>

        {q.loading && !b ? (
          <Loading label="Loading blood bank status…" />
        ) : q.error && !b ? (
          <ErrorPanel error={q.error} onRetry={q.refresh} />
        ) : (
          <>
            <StaleBanner error={q.error} onRetry={q.refresh} />
            {b.isDemo && <InfoNote tone="fuchsia" icon={FlaskConical}><strong>DEMO DATA.</strong> Blood bank stock is synthetic.</InfoNote>}
            {!b.bloodGroup && (
              <InfoNote tone="amber" icon={AlertTriangle}>
                <strong>No blood group on record.</strong> Request clinical blood typing before any preparation decision.
              </InfoNote>
            )}
            {b.bloodGroup && !b.verified && (
              <InfoNote tone="amber" icon={AlertTriangle}>
                The blood group comes from the emergency profile and is <strong>not verified</strong>. Do not rely on it for transfusion.
              </InfoNote>
            )}

            <div className="card card-pad">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-800"><Droplets className="h-4 w-4 text-red-500" aria-hidden="true" /> Preparation status</div>
              <FieldGrid cols={2}>
                <Field label="Patient blood group"><BloodGroup group={b.bloodGroup} verified={b.verified} /></Field>
                <Field label="Verification" value={verificationText} />
                <Field label="Blood bank status"><Chip tone={avail.tone}>{avail.label}</Chip></Field>
                <Field label="Preparation"><Chip tone={prep.tone}>{prep.label}</Chip></Field>
              </FieldGrid>
              <p className="mt-4 text-xs text-slate-400">Last updated {formatDateTime(b.updatedAt)}{b.source ? ` · source: ${b.source}` : ''}</p>
            </div>

            <div className="card card-pad">
              <h2 className="mb-3 text-sm font-bold text-slate-800">Blood bank inventory {b.isDemo ? '(synthetic)' : ''}</h2>
              {b.inventory.length === 0 ? (
                <p className="text-sm italic text-slate-500">Inventory data is not available.</p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {b.inventory.map((i) => (
                    <li key={i.group} className={`rounded-xl border px-3 py-2 text-center ${i.group === b.bloodGroup ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
                      <p className="text-lg font-bold text-slate-900">{i.group}</p>
                      <p className="text-xs text-slate-500">{i.units === null ? 'Unknown' : `${i.units} unit${i.units === 1 ? '' : 's'}`}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
