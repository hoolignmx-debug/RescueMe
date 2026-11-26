import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  UserRound, HeartPulse, Siren, Phone, ArrowLeft, Ambulance, ClipboardCheck, Activity, History, Droplets, ShieldAlert, ShieldQuestion, Lock,
} from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { getProfile, getPatientPhoto } from '../services/incidentService.js';
import { useAuth } from '../context/AuthContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import IncidentPicker from '../components/IncidentPicker.jsx';
import { Field, FieldGrid, ListValue, BloodGroup } from '../components/Field.jsx';
import { StatusBadge, SeverityBadge, DemoTag, Chip } from '../components/StatusBadge.jsx';
import { Loading, ErrorPanel, InfoNote } from '../components/DataStates.jsx';
import { formatDateTime, formatEta } from '../utils/format.js';
import { identityLabel } from '../utils/display.js';
import { HAS_ARRIVED } from '../utils/statuses.js';

const DONOR = { YES: 'Registered organ donor', NO: 'Not a registered donor', UNKNOWN: 'Unknown' };

function Section({ icon: Icon, title, tone = 'teal', children }) {
  const tones = { teal: 'bg-teal-50 text-teal-600', red: 'bg-red-50 text-red-600', blue: 'bg-blue-50 text-blue-600', violet: 'bg-violet-50 text-violet-600' };
  return (
    <section className="card">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function Photo({ photoUrl }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let revoke = null;
    let cancelled = false;
    if (photoUrl) {
      getPatientPhoto(photoUrl)
        .then((u) => {
          if (cancelled) return;
          revoke = u;
          setSrc(u);
        })
        .catch(() => setSrc(null));
    }
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [photoUrl]);
  return src ? (
    <img src={src} alt="Patient reference" className="h-28 w-28 rounded-2xl object-cover ring-1 ring-slate-200" />
  ) : (
    <div className="flex h-28 w-28 flex-col items-center justify-center gap-1 rounded-2xl bg-slate-100 text-center text-[11px] text-slate-400">
      <UserRound className="h-8 w-8" aria-hidden="true" />
      No photo on file
    </div>
  );
}

export default function PatientProfile() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: p, error, loading, refresh } = useAsyncData(() => getProfile(incidentId), [incidentId], { enabled: !!incidentId });

  if (!incidentId) {
    return (
      <>
        <PageHeader title="Patient Emergency Profile" subtitle="Choose an incident to open its authorized emergency summary" />
        <IncidentPicker basePath="/patients" />
      </>
    );
  }

  const restricted = (field) => !!p?.access.restrictedFields.includes(field);
  const arrived = p && HAS_ARRIVED.includes(p.incident.status);

  return (
    <>
      <PageHeader
        title="Patient Emergency Profile"
        subtitle={incidentId}
        onRefresh={refresh}
        refreshing={loading}
        actions={
          <button type="button" className="btn-ghost" onClick={() => navigate('/incidents')}>
            <ArrowLeft className="h-4 w-4" /> Back to queue
          </button>
        }
      />
      {loading && !p ? (
        <Loading label="Loading authorized emergency profile…" />
      ) : error ? (
        <ErrorPanel error={error} onRetry={refresh} />
      ) : (
        <div className="space-y-5">
          <div className="card card-pad flex flex-wrap items-center gap-3">
            <span className="font-mono text-sm font-bold">{p.incidentId}</span>
            <StatusBadge status={p.incident.status} />
            <SeverityBadge severity={p.incident.severity} />
            {p.isDemo && <DemoTag />}
            <div className="ml-auto flex flex-wrap gap-2">
              {can('tracking.view') && <Link className="btn-ghost !py-1.5 text-xs" to={`/tracking/${incidentId}`}><Ambulance className="h-3.5 w-3.5" /> Tracking</Link>}
              {can('handoff.view') && <Link className="btn-ghost !py-1.5 text-xs" to={`/handoff/${incidentId}`}><ClipboardCheck className="h-3.5 w-3.5" /> Handoff</Link>}
              <Link className="btn-ghost !py-1.5 text-xs" to={`/status/${incidentId}`}><Activity className="h-3.5 w-3.5" /> Status</Link>
              {can('timeline.view') && <Link className="btn-ghost !py-1.5 text-xs" to={`/timeline/${incidentId}`}><History className="h-3.5 w-3.5" /> Timeline</Link>}
              {can('bloodbank.view') && <Link className="btn-ghost !py-1.5 text-xs" to={`/blood-bank/${incidentId}`}><Droplets className="h-3.5 w-3.5" /> Blood bank</Link>}
            </div>
          </div>

          {!p.patient.verified && (
            <InfoNote tone="amber" icon={ShieldQuestion}>
              <strong>Identity not verified ({identityLabel(p.patient.identityStatus)}).</strong> Do not treat any name or medical details as confirmed. Unverified values are shown as “Unconfirmed”.
            </InfoNote>
          )}
          {p.access.level === 'LIMITED' && (
            <InfoNote tone="sky" icon={Lock}>
              Limited access for your role: some fields are withheld by the backend and marked “Restricted for your role”.
            </InfoNote>
          )}
          {p.patient.verified && !p.medical.bloodGroupVerified && p.medical.bloodGroup && (
            <InfoNote tone="amber" icon={ShieldAlert}>
              The blood group on the emergency profile is <strong>not verified</strong>. Follow hospital blood-typing and compatibility protocols.
            </InfoNote>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <Section icon={UserRound} title="A. Patient identity" tone="blue">
              <div className="flex gap-5">
                <Photo photoUrl={p.patient.photoUrl} />
                <FieldGrid>
                  <Field label="Patient name" value={p.patient.name} unconfirmed />
                  <Field label="Age" value={p.patient.age} unconfirmed />
                  <Field label="Gender" value={p.patient.gender} unconfirmed />
                  <Field label="Patient ID" value={p.patient.userId} mono />
                  <Field label="Identity verification">
                    <Chip tone={p.patient.verified ? 'green' : 'amber'}>{identityLabel(p.patient.identityStatus)}</Chip>
                  </Field>
                </FieldGrid>
              </div>
            </Section>

            <Section icon={HeartPulse} title="B. Medical information" tone="red">
              <FieldGrid>
                <Field label="Blood group">
                  <BloodGroup group={p.medical.bloodGroup} verified={p.medical.bloodGroupVerified} />
                </Field>
                <Field label="Known allergies">
                  <ListValue items={p.medical.allergies} tone="red" unknownLabel={p.patient.verified ? 'Not available' : 'Unconfirmed'} />
                </Field>
                <Field label="Chronic conditions (incl. asthma / diabetes)">
                  <ListValue items={p.medical.conditions} tone="blue" unknownLabel={p.patient.verified ? 'Not available' : 'Unconfirmed'} />
                </Field>
                <Field label="Pacemaker / medical implants">
                  <ListValue items={p.medical.implants} tone="violet" unknownLabel={p.patient.verified ? 'Not available' : 'Unconfirmed'} />
                </Field>
                <Field label="Relevant medication (as recorded)">
                  <ListValue items={p.medical.medications} tone="slate" unknownLabel={p.patient.verified ? 'Not available' : 'Unconfirmed'} />
                </Field>
                <Field
                  label="Organ donor preference"
                  restricted={restricted('medical_profile.donor_preference')}
                  value={p.medical.donorPreference ? DONOR[p.medical.donorPreference] || p.medical.donorPreference : null}
                  unconfirmed={!p.patient.verified}
                />
              </FieldGrid>
              <p className="mt-4 text-xs text-slate-400">Emergency-profile data is informational. It does not replace clinical assessment.</p>
            </Section>

            <Section icon={Siren} title="C. Emergency information" tone="violet">
              <FieldGrid>
                <Field label="Incident ID" value={p.incidentId} mono />
                <Field label="Accident time" value={p.incident.accidentTime ? formatDateTime(p.incident.accidentTime) : null} />
                <Field label="Incident location" value={p.incident.address} />
                <Field
                  label="GPS coordinates"
                  value={p.incident.latitude !== null && p.incident.longitude !== null ? `${p.incident.latitude.toFixed(5)}, ${p.incident.longitude.toFixed(5)}` : null}
                  mono
                />
                <Field label="Incident severity"><SeverityBadge severity={p.incident.severity} /></Field>
                <Field label="Ambulance ID" value={p.ambulance?.id} mono />
                <Field label="Hospital arrival ETA" value={arrived ? 'Arrived' : p.ambulance?.etaMinutes !== null && p.ambulance?.etaMinutes !== undefined ? formatEta(p.ambulance.etaMinutes) : null} />
              </FieldGrid>
            </Section>

            <Section icon={Phone} title="D. Emergency contacts" tone="teal">
              {p.contacts.length === 0 ? (
                <p className="text-sm text-slate-500">No emergency contacts on file.</p>
              ) : (
                <ul className="space-y-4">
                  {p.contacts.map((c, idx) => (
                    <li key={`${c.name}-${idx}`}>
                      <FieldGrid cols={3}>
                        <Field label="Contact name" value={c.name} />
                        <Field label="Relationship" value={c.relationship} />
                        <Field label="Phone" value={c.phone} restricted={restricted('emergency_contacts.phone')} mono />
                      </FieldGrid>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
