import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, Lock, Info } from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { getIncident, getTimeline, updateStatus } from '../services/incidentService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import IncidentPicker from '../components/IncidentPicker.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { StatusBadge, SeverityBadge } from '../components/StatusBadge.jsx';
import { Field, FieldGrid } from '../components/Field.jsx';
import { Loading, ErrorPanel, InfoNote, StaleBanner, EmptyState } from '../components/DataStates.jsx';
import { allowedTransitions, PRE_ARRIVAL, statusLabel } from '../utils/statuses.js';
import { hasErrors, validateStatusChange } from '../utils/validators.js';
import { formatDateTime } from '../utils/format.js';
import { roleLabel } from '../utils/permissions.js';

// Visual stepper of the hospital workflow. STABLE / OTHER_OUTCOME share one step.
const STEPS = [
  { key: 'ARRIVED', codes: ['ARRIVED'] },
  { key: 'IN_ER', codes: ['IN_ER'] },
  { key: 'UNDER_TREATMENT', codes: ['UNDER_TREATMENT'] },
  { key: 'OUTCOME', codes: ['STABLE', 'OTHER_OUTCOME'] },
  { key: 'CLOSED', codes: ['CLOSED'] },
];

function Stepper({ status }) {
  const current = STEPS.findIndex((s) => s.codes.includes(status));
  const beforeArrival = PRE_ARRIVAL.includes(status);
  return (
    <ol className="grid grid-cols-5 gap-1 sm:gap-2" aria-label="Status workflow">
      {STEPS.map((s, i) => {
        const done = !beforeArrival && i < current;
        const active = i === current;
        const label = s.key === 'OUTCOME' ? (active ? statusLabel(status) : 'Stable / Other outcome') : statusLabel(s.key);
        return (
          <li key={s.key} className="flex flex-col items-center gap-1.5 text-center" aria-current={active ? 'step' : undefined}>
            <span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ring-1 ring-inset ${active ? 'bg-teal-600 text-white ring-teal-700' : done ? 'bg-teal-50 text-teal-700 ring-teal-200' : 'bg-slate-100 text-slate-400 ring-slate-200'}`}>
              {done ? <Check className="h-4 w-4" aria-hidden="true" /> : i + 1}
            </span>
            <span className={`text-[11px] leading-tight sm:text-xs ${active ? 'font-bold text-slate-900' : 'text-slate-500'}`}>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export default function StatusManagement() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const toast = useToast();
  const incidentQ = useAsyncData(() => getIncident(incidentId), [incidentId], { enabled: !!incidentId, refreshOnChange: true });
  const timelineQ = useAsyncData(() => getTimeline(incidentId), [incidentId], { enabled: !!incidentId, refreshOnChange: true });

  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState({});
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  if (!incidentId) {
    return (
      <>
        <PageHeader title="Patient Status Management" subtitle="Choose the incident whose status you want to update" />
        <IncidentPicker basePath="/status" />
      </>
    );
  }

  const incident = incidentQ.data;
  const options = incident && can('status.update') ? allowedTransitions(incident.status, user.role) : [];
  const history = (timelineQ.data || []).filter((e) => e.type === 'STATUS_CHANGED').reverse();

  const choose = (to) => {
    const errs = validateStatusChange({ to, notes });
    setErrors(errs);
    if (hasErrors(errs)) {
      toast.error(errs.notes);
      return;
    }
    setSubmitError(null);
    setTarget(to);
  };

  const apply = async () => {
    setBusy(true);
    try {
      await updateStatus(incident, target, notes);
      toast.success(`Status changed to ${statusLabel(target)}.`);
      setNotes('');
      setTarget(null);
      // updateStatus() emits a change event: dashboard, queue and this page's timeline refresh themselves.
      incidentQ.refreshSilent();
      timelineQ.refreshSilent();
    } catch (err) {
      if (err?.kind === 'UNAUTHENTICATED') return;
      setSubmitError(err);
      setTarget(null);
      toast.error(err?.message || 'The status could not be updated.');
      incidentQ.refreshSilent(); // somebody else may have changed it first
    } finally {
      setBusy(false);
    }
  };

  const reason = !incident
    ? null
    : !can('status.update')
      ? 'Your role is view-only for status changes.'
      : PRE_ARRIVAL.includes(incident.status) && incident.status !== 'EN_ROUTE'
        ? 'Earlier stages are managed by the EMS module. The hospital can record arrival once the ambulance is en route.'
        : incident.status === 'CLOSED'
          ? 'This incident is closed. No further status changes are possible.'
          : options.length === 0
            ? `Your role (${roleLabel(user.role)}) cannot make the next change from ${statusLabel(incident.status)}.`
            : null;

  return (
    <>
      <PageHeader
        title="Patient Status Management"
        subtitle={incidentId}
        onRefresh={() => { incidentQ.refresh(); timelineQ.refresh(); }}
        refreshing={incidentQ.loading}
        updatedAt={incidentQ.updatedAt}
        actions={<button type="button" className="btn-ghost" onClick={() => navigate('/status')}><ArrowLeft className="h-4 w-4" /> All incidents</button>}
      />
      {incidentQ.loading && !incident ? (
        <Loading label="Loading incident…" />
      ) : incidentQ.error && !incident ? (
        <ErrorPanel error={incidentQ.error} onRetry={incidentQ.refresh} />
      ) : (
        <div className="space-y-5">
          <StaleBanner error={incidentQ.error} onRetry={incidentQ.refresh} />
          {submitError && <ErrorPanel error={submitError} />}

          <div className="card card-pad">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <StatusBadge status={incident.status} showCode />
              <SeverityBadge severity={incident.severity} />
            </div>
            <FieldGrid cols={3}>
              <Field label="Incident ID" value={incident.id} mono />
              <Field label="Patient" value={incident.patientName} unconfirmed />
              <Field label="Ambulance" value={incident.ambulanceId} mono />
            </FieldGrid>
            <div className="mt-6"><Stepper status={incident.status} /></div>
          </div>

          <div className="card card-pad space-y-4">
            <h2 className="text-sm font-bold text-slate-800">Update status</h2>
            {reason && <InfoNote tone="sky" icon={options.length === 0 && incident.status === 'CLOSED' ? Lock : Info}>{reason}</InfoNote>}
            {options.length > 0 && (
              <>
                <div>
                  <label htmlFor="status-notes" className="label">Notes {options.includes('OTHER_OUTCOME') ? '(required for Other outcome)' : '(optional)'}</label>
                  <textarea id="status-notes" rows={3} className={`input ${errors.notes ? 'input-error' : ''}`} value={notes} onChange={(e) => { setNotes(e.target.value); setErrors({}); }} aria-invalid={!!errors.notes} />
                  {errors.notes && <p className="mt-1 text-xs text-red-600">{errors.notes}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {options.map((to) => (
                    <button key={to} type="button" className={to === 'CLOSED' ? 'btn-danger' : 'btn-primary'} onClick={() => choose(to)}>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" /> Mark as {statusLabel(to)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400">Only permitted next steps are offered. The backend re-checks every change.</p>
              </>
            )}
          </div>

          <div className="card">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <h2 className="text-sm font-bold text-slate-800">Status change history</h2>
              {can('timeline.view') && <Link to={`/timeline/${incidentId}`} className="text-xs font-semibold text-teal-700 hover:underline">Full timeline</Link>}
            </div>
            {timelineQ.loading && !timelineQ.data ? (
              <Loading label="Loading history…" />
            ) : history.length === 0 ? (
              <EmptyState title="No status changes recorded yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100 text-sm">
                  <thead className="bg-slate-50"><tr><th className="th">Time</th><th className="th">Previous</th><th className="th">New</th><th className="th">Staff</th><th className="th">Notes</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {history.map((e) => (
                      <tr key={e.id}>
                        <td className="td whitespace-nowrap">{formatDateTime(e.timestamp)}</td>
                        <td className="td">{e.fromStatus ? <StatusBadge status={e.fromStatus} /> : '—'}</td>
                        <td className="td"><StatusBadge status={e.toStatus} /></td>
                        <td className="td"><span className="font-mono text-xs">{e.staffId || '—'}</span></td>
                        <td className="td text-slate-600">{e.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        title={`Change status to ${target ? statusLabel(target) : ''}?`}
        tone={target === 'CLOSED' ? 'danger' : 'primary'}
        confirmLabel="Confirm change"
        busy={busy}
        onConfirm={apply}
        onCancel={() => setTarget(null)}
      >
        <p>{incident && target ? `${statusLabel(incident.status)} → ${statusLabel(target)}` : ''} for <span className="font-mono">{incidentId}</span>.</p>
        <p className="mt-1">Your staff ID and the time will be recorded in the audit trail.{target === 'CLOSED' ? ' A closed record cannot be reopened.' : ''}</p>
      </ConfirmDialog>
    </>
  );
}
