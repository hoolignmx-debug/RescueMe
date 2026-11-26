import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Play, Square, MapPinOff, TimerOff, FlaskConical, UserRound } from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { getTracking } from '../services/incidentService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { config } from '../config.js';
import PageHeader from '../components/PageHeader.jsx';
import IncidentPicker from '../components/IncidentPicker.jsx';
import TrackingMap from '../components/TrackingMap.jsx';
import { Field, FieldGrid } from '../components/Field.jsx';
import { StatusBadge, Chip } from '../components/StatusBadge.jsx';
import { Loading, ErrorPanel, StaleBanner, InfoNote } from '../components/DataStates.jsx';
import { formatDateTime, formatEta, timeAgo } from '../utils/format.js';
import { HAS_ARRIVED } from '../utils/statuses.js';

const SIM_SECONDS = 60; // a one-minute demo run
const SIM_ETA_MIN = 8; // represents an 8 minute drive

const coords = (p) => (p && p.latitude !== null && p.longitude !== null ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : null);

export default function AmbulanceTracking() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const { can } = useAuth();
  const { data: t, error, loading, refresh, updatedAt } = useAsyncData(() => getTracking(incidentId), [incidentId], {
    enabled: !!incidentId,
    intervalMs: config.pollIntervalMs,
  });

  // ---- clearly labelled simulated movement (client-side only, never sent anywhere) ----
  const [sim, setSim] = useState(null); // { from:{latitude,longitude}, startedAt }
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!sim) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [sim]);
  useEffect(() => setSim(null), [incidentId]);

  const view = useMemo(() => {
    if (!t) return null;
    const progress = sim ? Math.min(1, (Date.now() - sim.startedAt) / (SIM_SECONDS * 1000)) : 0;
    const h = t.hospital;
    const simPos =
      sim && h && h.latitude !== null
        ? {
            latitude: sim.from.latitude + (h.latitude - sim.from.latitude) * progress,
            longitude: sim.from.longitude + (h.longitude - sim.from.longitude) * progress,
          }
        : null;
    return { progress, simPos, simEta: sim ? Math.ceil((1 - progress) * SIM_ETA_MIN) : null };
  }, [t, sim, setTick]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!incidentId) {
    return (
      <>
        <PageHeader title="Ambulance Tracking & ETA" subtitle="Choose an incident to see its ambulance" />
        <IncidentPicker basePath="/tracking" />
      </>
    );
  }

  const real = t?.ambulance?.location;
  const realIsGps = real?.source === 'GPS';
  const arrived = t && HAS_ARRIVED.includes(t.incidentStatus || '');
  const startPoint = real || (t?.incidentLocation && t.incidentLocation.latitude !== null ? t.incidentLocation : null);
  const canSimulate = t && !realIsGps && t.hospital?.latitude !== null && startPoint && !arrived;

  const ambulancePos = view?.simPos || real;
  const ambulanceSimulated = !!view?.simPos || (!!real && !realIsGps);
  const points = t
    ? [
        t.incidentLocation && { key: 'inc', label: 'Accident', kind: 'incident', ...t.incidentLocation, simulated: t.isDemo },
        ambulancePos && { key: 'amb', label: t.ambulance?.id || 'Ambulance', kind: 'ambulance', ...ambulancePos, simulated: ambulanceSimulated },
        t.hospital && { key: 'hos', label: t.hospital.name, kind: 'hospital', ...t.hospital, simulated: t.isDemo },
      ].filter(Boolean)
    : [];

  const etaMinutes = sim ? view.simEta : t?.etaMinutes;
  const etaText = arrived ? 'Arrived' : etaMinutes === null || etaMinutes === undefined ? null : formatEta(etaMinutes);

  return (
    <>
      <PageHeader
        title="Ambulance Tracking & ETA"
        subtitle={incidentId}
        onRefresh={refresh}
        refreshing={loading}
        updatedAt={updatedAt}
        actions={
          <button type="button" className="btn-ghost" onClick={() => navigate('/tracking')}>
            <ArrowLeft className="h-4 w-4" /> All incidents
          </button>
        }
      />
      {loading && !t ? (
        <Loading label="Loading ambulance tracking…" />
      ) : error && !t ? (
        <ErrorPanel error={error} onRetry={refresh} />
      ) : (
        <div className="space-y-5">
          <StaleBanner error={error} onRetry={refresh} />
          {t.isDemo && (
            <InfoNote tone="fuchsia" icon={FlaskConical}>
              <strong>DEMO DATA.</strong> Ambulance and hospital positions are synthetic and are not real GPS readings.
            </InfoNote>
          )}
          {!t.ambulance && <InfoNote tone="amber" icon={MapPinOff}>No ambulance has been assigned to this incident yet.</InfoNote>}
          {t.ambulance && !real && !sim && (
            <InfoNote tone="amber" icon={MapPinOff}>
              No ambulance location is available (no GPS fix received). {canSimulate ? 'You can start the labelled simulation below to rehearse arrival.' : ''}
            </InfoNote>
          )}
          {t.ambulance && etaText === null && (
            <InfoNote tone="amber" icon={TimerOff}>No ETA is available for this ambulance yet.</InfoNote>
          )}

          <div className="card card-pad">
            <FieldGrid cols={3}>
              <Field label="Incident ID" value={t.incidentId} mono />
              <Field label="Ambulance ID" value={t.ambulance?.id} mono />
              <Field label="Ambulance status">
                {t.ambulance?.status ? <Chip tone="amber">{t.ambulance.status.replace(/_/g, ' ')}</Chip> : null}
              </Field>
              <Field label="Current ambulance location">
                {ambulancePos ? (
                  <span className="text-sm">
                    <span className="font-mono">{coords(ambulancePos)}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {ambulanceSimulated ? <strong className="text-fuchsia-700">SIMULATED — not real GPS</strong> : 'GPS'}
                      {real?.updatedAt && !sim ? ` · updated ${timeAgo(real.updatedAt)} (${formatDateTime(real.updatedAt)})` : ''}
                    </span>
                  </span>
                ) : null}
              </Field>
              <Field label="Destination hospital" value={t.hospital?.name} />
              <Field label={sim ? 'Estimated arrival (simulated)' : 'Estimated arrival time'} value={etaText} />
              <Field label="Incident location" value={t.incidentLocation?.address} />
              <Field label="Incident status"><StatusBadge status={t.incidentStatus || 'UNKNOWN'} /></Field>
            </FieldGrid>
          </div>

          <div className="card card-pad space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-slate-800">Map</h2>
              <div className="flex flex-wrap gap-2">
                {can('profile.view') && (
                  <Link to={`/patients/${incidentId}`} className="btn-ghost !py-1.5 text-xs"><UserRound className="h-3.5 w-3.5" /> Patient profile</Link>
                )}
                {canSimulate && !sim && (
                  <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setSim({ from: { latitude: startPoint.latitude, longitude: startPoint.longitude }, startedAt: Date.now() })}>
                    <Play className="h-3.5 w-3.5" /> Start simulated movement
                  </button>
                )}
                {sim && (
                  <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => setSim(null)}>
                    <Square className="h-3.5 w-3.5" /> Stop simulation
                  </button>
                )}
              </div>
            </div>
            {sim && (
              <InfoNote tone="fuchsia" icon={FlaskConical}>
                <strong>Simulation running ({Math.round(view.progress * 100)}%).</strong> This moves a marker on your screen only. It is not an ambulance position and is not stored or shared.
              </InfoNote>
            )}
            <TrackingMap points={points} anySimulated={points.some((p) => p.simulated)} />
          </div>
        </div>
      )}
    </>
  );
}
