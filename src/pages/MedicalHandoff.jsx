import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ClipboardList, Stethoscope, StickyNote, History as HistoryIcon, Save, CheckCircle2, Lock, Info, AlertTriangle } from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { getIncident, listMedicalNotes, addMedicalNote } from '../services/incidentService.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import PageHeader from '../components/PageHeader.jsx';
import IncidentPicker from '../components/IncidentPicker.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { Field, FieldGrid } from '../components/Field.jsx';
import { StatusBadge, Chip } from '../components/StatusBadge.jsx';
import { Loading, ErrorPanel, InfoNote, EmptyState } from '../components/DataStates.jsx';
import {
  BREATHING_OPTIONS, CONSCIOUSNESS_OPTIONS, hasErrors, validateDoctorAssessment, validateParamedicHandoff, validateTreatmentNote,
} from '../utils/validators.js';
import { formatDateTime, fromLocalInputValue, newRequestId, toLocalInputValue } from '../utils/format.js';
import { roleLabel } from '../utils/permissions.js';
import { HAS_ARRIVED } from '../utils/statuses.js';

const KIND_LABEL = {
  PARAMEDIC_HANDOFF: 'Paramedic handoff',
  DOCTOR_ASSESSMENT: 'Doctor assessment',
  HANDOFF_ACCEPTANCE: 'Patient accepted',
  TREATMENT_NOTE: 'Treatment note',
};
const KIND_TONE = { PARAMEDIC_HANDOFF: 'teal', DOCTOR_ASSESSMENT: 'blue', HANDOFF_ACCEPTANCE: 'green', TREATMENT_NOTE: 'slate' };

const FIELD_LABEL = {
  arrival_time: 'Arrival time',
  initial_condition: 'Initial patient condition',
  consciousness: 'Consciousness',
  breathing: 'Breathing',
  visible_injuries: 'Visible injuries',
  initial_observations: 'Initial observations',
  treatment_provided: 'Treatment already provided',
  medication_administered: 'Medication administered',
  additional_notes: 'Additional notes',
  doctor_id: 'Doctor ID',
  doctor_name: 'Doctor name',
  accepted_at: 'Handoff acceptance time',
  initial_assessment: 'Initial assessment',
  treatment_notes: 'Treatment notes',
  text: 'Note',
};
const TIME_FIELDS = new Set(['arrival_time', 'accepted_at']);
const ENUM_LABELS = Object.fromEntries([...CONSCIOUSNESS_OPTIONS, ...BREATHING_OPTIONS].map((o) => [o.value, o.label]));

const emptyParamedic = () => ({
  arrival_time: toLocalInputValue(new Date()),
  initial_condition: '', consciousness: '', breathing: '', visible_injuries: '', initial_observations: '',
  treatment_provided: '', medication_administered: '', additional_notes: '',
});

function TextField({ id, label, required, value, onChange, error, rows = 3, disabled, hint }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}{required && <span className="text-red-500"> *</span>}</label>
      <textarea id={id} rows={rows} className={`input ${error ? 'input-error' : ''}`} value={value} onChange={onChange} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${id}-err` : undefined} />
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function InputField({ id, label, required, error, children }) {
  return (
    <div>
      <label htmlFor={id} className="label">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {error && <p id={`${id}-err`} className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Card({ icon: Icon, title, tone = 'teal', children, aside }) {
  const tones = { teal: 'bg-teal-50 text-teal-600', blue: 'bg-blue-50 text-blue-600', slate: 'bg-slate-100 text-slate-600' };
  return (
    <section className="card">
      <div className="flex items-center gap-3 border-b border-slate-200 px-5 py-3">
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tones[tone]}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <h2 className="flex-1 text-sm font-bold text-slate-800">{title}</h2>
        {aside}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function RecordFields({ fields }) {
  const entries = Object.entries(fields || {}).filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '');
  if (entries.length === 0) return <p className="text-xs italic text-slate-400">No details recorded.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className={k === 'text' || String(v).length > 60 ? 'sm:col-span-2' : ''}>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{FIELD_LABEL[k] || k}</dt>
          <dd className="whitespace-pre-wrap break-words text-sm text-slate-800">
            {TIME_FIELDS.has(k) ? formatDateTime(v) : ENUM_LABELS[v] || String(v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export default function MedicalHandoff() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const toast = useToast();

  const incidentQ = useAsyncData(() => getIncident(incidentId), [incidentId], { enabled: !!incidentId, refreshOnChange: true });
  const notesQ = useAsyncData(() => listMedicalNotes(incidentId), [incidentId], { enabled: !!incidentId, refreshOnChange: true });

  const [paramedic, setParamedic] = useState(emptyParamedic);
  const [doctor, setDoctor] = useState(() => ({
    doctor_id: user?.staffId || '', doctor_name: user?.name || '', accepted_at: toLocalInputValue(new Date()), initial_assessment: '', treatment_notes: '',
  }));
  const [noteText, setNoteText] = useState('');
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(null); // 'PARAMEDIC' | 'DOCTOR' | 'ACCEPT' | 'NOTE'
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [cancelAsk, setCancelAsk] = useState(false);
  // One idempotency key per submission attempt: a retried request is never saved twice.
  // The key is renewed whenever the form content changes (see touch()).
  const requestIds = useRef({});
  const touch = (action) => {
    delete requestIds.current[action];
    setSubmitError(null);
  };
  const requestId = (action) => (requestIds.current[action] ||= newRequestId());

  if (!incidentId) {
    return (
      <>
        <PageHeader title="Medical Handoff" subtitle="Choose the incident to record or review a handoff" />
        <IncidentPicker basePath="/handoff" filter={(i) => i.status !== 'IDENTITY_VERIFIED'} />
      </>
    );
  }

  const incident = incidentQ.data;
  const notes = notesQ.data || [];
  const arrived = incident && HAS_ARRIVED.includes(incident.status);
  const closed = incident?.status === 'CLOSED';
  const locked = !arrived || closed;
  const latest = (kind) => notes.find((n) => n.kind === kind); // notes arrive newest first
  const paramedicRecord = latest('PARAMEDIC_HANDOFF');
  const doctorRecord = latest('DOCTOR_ASSESSMENT');
  const accepted = latest('HANDOFF_ACCEPTANCE');

  const canParamedic = can('handoff.submit_paramedic');
  const canDoctor = can('handoff.submit_doctor');
  const canAccept = can('handoff.accept');
  const canNote = can('notes.add');

  const dirty =
    paramedic.initial_condition || paramedic.visible_injuries || paramedic.initial_observations || paramedic.treatment_provided ||
    paramedic.medication_administered || paramedic.additional_notes || paramedic.consciousness || paramedic.breathing ||
    doctor.initial_assessment || doctor.treatment_notes || noteText;

  const setP = (k) => (e) => { setParamedic((f) => ({ ...f, [k]: e.target.value })); touch('PARAMEDIC'); };
  const setD = (k) => (e) => { setDoctor((f) => ({ ...f, [k]: e.target.value })); touch('DOCTOR'); touch('ACCEPT'); };

  // Step 1: validate, then ask for confirmation.
  const ask = (action) => {
    let errs = {};
    if (action === 'PARAMEDIC') errs = validateParamedicHandoff(paramedic);
    if (action === 'DOCTOR') errs = validateDoctorAssessment(doctor);
    if (action === 'ACCEPT') {
      errs = validateDoctorAssessment(doctor);
      if (!paramedicRecord && !hasErrors(errs)) errs = { _form: 'A paramedic handoff must be recorded before the patient can be accepted.' };
      if (accepted) errs = { _form: 'This handoff has already been accepted.' };
    }
    if (action === 'NOTE') errs = validateTreatmentNote(noteText);
    setErrors(errs);
    setSubmitError(null);
    if (hasErrors(errs)) {
      if (errs._form) toast.error(errs._form);
      else toast.error('Please correct the highlighted fields.');
      return;
    }
    setPending(action);
  };

  // Step 2: confirmed -> send. Staff ID and timestamps are set by the backend from the access token.
  const submit = async () => {
    const action = pending;
    setBusy(true);
    setSubmitError(null);
    try {
      if (action === 'PARAMEDIC') {
        await addMedicalNote(incidentId, 'PARAMEDIC_HANDOFF', { ...paramedic, arrival_time: fromLocalInputValue(paramedic.arrival_time) }, requestId('PARAMEDIC'));
        toast.success('Paramedic handoff saved against ' + incidentId + '.');
        setParamedic(emptyParamedic());
      } else if (action === 'DOCTOR') {
        await addMedicalNote(incidentId, 'DOCTOR_ASSESSMENT', { ...doctor, accepted_at: fromLocalInputValue(doctor.accepted_at) }, requestId('DOCTOR'));
        toast.success('Doctor assessment saved.');
      } else if (action === 'ACCEPT') {
        await addMedicalNote(incidentId, 'HANDOFF_ACCEPTANCE', { ...doctor, accepted_at: fromLocalInputValue(doctor.accepted_at) }, requestId('ACCEPT'));
        toast.success('Patient accepted. Handoff completed.');
      } else if (action === 'NOTE') {
        await addMedicalNote(incidentId, 'TREATMENT_NOTE', { text: noteText.trim() }, requestId('NOTE'));
        toast.success('Treatment note added.');
        setNoteText('');
      }
      delete requestIds.current[action];
      setPending(null);
      notesQ.refreshSilent();
      incidentQ.refreshSilent();
    } catch (err) {
      if (err?.kind === 'UNAUTHENTICATED') return; // the auth context signs the user out
      setSubmitError(err);
      setPending(null);
      toast.error(err?.message || 'The handoff could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const confirmText = {
    PARAMEDIC: ['Save paramedic handoff?', 'This clinical record will be saved to the incident with your staff ID and a timestamp. It cannot be edited afterwards; corrections are added as new notes.'],
    DOCTOR: ['Save doctor assessment?', 'Your assessment will be saved to the incident with your staff ID and a timestamp.'],
    ACCEPT: ['Accept this patient?', 'You confirm that you are the receiving doctor and have received the handoff. This is recorded in the audit trail and cannot be undone.'],
    NOTE: ['Add treatment note?', 'The note will be added to the incident record with your staff ID and a timestamp.'],
  }[pending] || ['', ''];

  const cancel = () => (dirty ? setCancelAsk(true) : navigate(`/patients/${incidentId}`));

  return (
    <>
      <PageHeader
        title="Medical Handoff"
        subtitle={incidentId}
        onRefresh={() => { incidentQ.refresh(); notesQ.refresh(); }}
        refreshing={incidentQ.loading || notesQ.loading}
        actions={<button type="button" className="btn-ghost" onClick={() => navigate('/handoff')}><ArrowLeft className="h-4 w-4" /> All incidents</button>}
      />

      {incidentQ.loading && !incident ? (
        <Loading label="Loading incident…" />
      ) : incidentQ.error && !incident ? (
        <ErrorPanel error={incidentQ.error} onRetry={incidentQ.refresh} />
      ) : (
        <div className="space-y-5">
          <InfoNote tone="sky" icon={Info}>
            This form <strong>records and communicates</strong> clinical information. It does not recommend treatment or medication.
          </InfoNote>
          {!arrived && <InfoNote tone="amber" icon={Lock}>The patient has not arrived yet (status: {incident.status.replace(/_/g, ' ')}). Handoff entries unlock when the status is Arrived.</InfoNote>}
          {closed && <InfoNote tone="amber" icon={Lock}>This incident is closed. Records are read-only.</InfoNote>}
          {!incident.identityVerified && <InfoNote tone="amber" icon={AlertTriangle}>Identity is <strong>not verified</strong>. Treat patient details as unconfirmed.</InfoNote>}
          {submitError && <ErrorPanel error={submitError} />}

          <Card icon={ClipboardList} title="Patient information" aside={<StatusBadge status={incident.status} />}>
            <FieldGrid cols={2}>
              <Field label="Incident ID" value={incident.id} mono />
              <Field label="Patient ID" value={incident.patientId} mono />
              <Field label="Patient name" value={incident.patientName} unconfirmed />
              <Field label="Ambulance ID" value={incident.ambulanceId} mono />
            </FieldGrid>
          </Card>

          {/* ---------------- Paramedic handoff ---------------- */}
          <Card icon={ClipboardList} title="Paramedic handoff" aside={paramedicRecord && <Chip tone="green">Recorded</Chip>}>
            {canParamedic ? (
              <form onSubmit={(e) => { e.preventDefault(); ask('PARAMEDIC'); }} noValidate className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <InputField id="arrival_time" label="Arrival time" required error={errors.arrival_time}>
                    <input id="arrival_time" type="datetime-local" className={`input ${errors.arrival_time ? 'input-error' : ''}`} value={paramedic.arrival_time} onChange={setP('arrival_time')} disabled={locked} />
                  </InputField>
                  <InputField id="consciousness" label="Consciousness status" required error={errors.consciousness}>
                    <select id="consciousness" className={`input ${errors.consciousness ? 'input-error' : ''}`} value={paramedic.consciousness} onChange={setP('consciousness')} disabled={locked}>
                      <option value="">Select…</option>
                      {CONSCIOUSNESS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </InputField>
                  <InputField id="breathing" label="Breathing status" required error={errors.breathing}>
                    <select id="breathing" className={`input ${errors.breathing ? 'input-error' : ''}`} value={paramedic.breathing} onChange={setP('breathing')} disabled={locked}>
                      <option value="">Select…</option>
                      {BREATHING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </InputField>
                </div>
                <TextField id="initial_condition" label="Initial patient condition" required value={paramedic.initial_condition} onChange={setP('initial_condition')} error={errors.initial_condition} disabled={locked} />
                <TextField id="visible_injuries" label="Visible injuries" required value={paramedic.visible_injuries} onChange={setP('visible_injuries')} error={errors.visible_injuries} disabled={locked} hint='Write "None observed" if there are none.' />
                <TextField id="initial_observations" label="Initial observations" required value={paramedic.initial_observations} onChange={setP('initial_observations')} error={errors.initial_observations} disabled={locked} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <TextField id="treatment_provided" label="Treatment already provided" value={paramedic.treatment_provided} onChange={setP('treatment_provided')} error={errors.treatment_provided} disabled={locked} />
                  <TextField id="medication_administered" label="Medication administered, if known" value={paramedic.medication_administered} onChange={setP('medication_administered')} error={errors.medication_administered} disabled={locked} />
                </div>
                <TextField id="additional_notes" label="Additional notes" value={paramedic.additional_notes} onChange={setP('additional_notes')} error={errors.additional_notes} disabled={locked} rows={2} />
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                  <button type="button" className="btn-ghost" onClick={cancel}>Cancel</button>
                  <button type="submit" className="btn-primary" disabled={locked}><Save className="h-4 w-4" aria-hidden="true" /> Save Handoff</button>
                </div>
              </form>
            ) : paramedicRecord ? (
              <>
                <p className="mb-3 text-xs text-slate-500">Recorded by {paramedicRecord.staffName || paramedicRecord.staffId} · {formatDateTime(paramedicRecord.recordedAt)}</p>
                <RecordFields fields={paramedicRecord.fields} />
              </>
            ) : (
              <p className="text-sm italic text-slate-500">No paramedic handoff has been recorded yet. It is entered by the transporting paramedic.</p>
            )}
          </Card>

          {/* ---------------- Receiving doctor ---------------- */}
          <Card icon={Stethoscope} title="Receiving doctor" tone="blue" aside={accepted ? <Chip tone="green">Patient accepted</Chip> : paramedicRecord ? <Chip tone="amber">Awaiting acceptance</Chip> : null}>
            {canDoctor || canAccept ? (
              <form onSubmit={(e) => { e.preventDefault(); ask('DOCTOR'); }} noValidate className="space-y-4">
                {!paramedicRecord && <InfoNote tone="amber" icon={Info}>No paramedic handoff yet — the patient cannot be accepted until one is recorded.</InfoNote>}
                {errors._form && <p className="text-sm text-red-600" role="alert">{errors._form}</p>}
                <div className="grid gap-4 sm:grid-cols-3">
                  <InputField id="doctor_id" label="Doctor ID" required error={errors.doctor_id}>
                    <input id="doctor_id" className={`input ${errors.doctor_id ? 'input-error' : ''}`} value={doctor.doctor_id} onChange={setD('doctor_id')} disabled={locked} readOnly />
                  </InputField>
                  <InputField id="doctor_name" label="Doctor name" required error={errors.doctor_name}>
                    <input id="doctor_name" className={`input ${errors.doctor_name ? 'input-error' : ''}`} value={doctor.doctor_name} onChange={setD('doctor_name')} disabled={locked} readOnly />
                  </InputField>
                  <InputField id="accepted_at" label="Handoff acceptance time" required error={errors.accepted_at}>
                    <input id="accepted_at" type="datetime-local" className={`input ${errors.accepted_at ? 'input-error' : ''}`} value={doctor.accepted_at} onChange={setD('accepted_at')} disabled={locked} />
                  </InputField>
                </div>
                <p className="-mt-2 text-xs text-slate-400">Doctor ID and name come from your signed-in session.</p>
                <TextField id="initial_assessment" label="Initial assessment" required value={doctor.initial_assessment} onChange={setD('initial_assessment')} error={errors.initial_assessment} disabled={locked} />
                <TextField id="treatment_notes" label="Treatment notes" value={doctor.treatment_notes} onChange={setD('treatment_notes')} error={errors.treatment_notes} disabled={locked} />
                <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
                  <button type="button" className="btn-ghost" onClick={cancel}>Cancel</button>
                  {canDoctor && <button type="submit" className="btn-blue" disabled={locked}><Save className="h-4 w-4" aria-hidden="true" /> Save Handoff</button>}
                  {canAccept && (
                    <button type="button" className="btn-primary" disabled={locked || !!accepted} onClick={() => ask('ACCEPT')}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> {accepted ? 'Accepted' : 'Accept Patient'}
                    </button>
                  )}
                </div>
              </form>
            ) : doctorRecord || accepted ? (
              <>
                {[doctorRecord, accepted].filter(Boolean).map((r) => (
                  <div key={r.id} className="mb-4 last:mb-0">
                    <p className="mb-2 text-xs text-slate-500">{KIND_LABEL[r.kind]} · {r.staffName || r.staffId} · {formatDateTime(r.recordedAt)}</p>
                    <RecordFields fields={r.fields} />
                  </div>
                ))}
              </>
            ) : (
              <p className="text-sm italic text-slate-500">The receiving doctor has not recorded an assessment yet.</p>
            )}
          </Card>

          {/* ---------------- Treatment notes (doctor) ---------------- */}
          {canNote && (
            <Card icon={StickyNote} title="Add treatment note" tone="slate">
              <form onSubmit={(e) => { e.preventDefault(); ask('NOTE'); }} noValidate className="space-y-3">
                <TextField id="note_text" label="Note" value={noteText} onChange={(e) => { setNoteText(e.target.value); touch('NOTE'); }} error={errors.text} disabled={locked} rows={3} hint="Record what was done or observed. Identical repeated notes are rejected as duplicates." />
                <div className="flex justify-end">
                  <button type="submit" className="btn-ghost" disabled={locked}><StickyNote className="h-4 w-4" aria-hidden="true" /> Add note</button>
                </div>
              </form>
            </Card>
          )}

          {/* ---------------- History ---------------- */}
          <Card icon={HistoryIcon} title="Previous handoff records" tone="slate" aside={<span className="text-xs text-slate-400">{notes.length} record{notes.length === 1 ? '' : 's'}</span>}>
            {notesQ.loading && !notesQ.data ? (
              <Loading label="Loading records…" />
            ) : notesQ.error && !notesQ.data ? (
              <ErrorPanel error={notesQ.error} onRetry={notesQ.refresh} compact />
            ) : notes.length === 0 ? (
              <EmptyState title="No records yet" message="Handoff records for this incident will appear here." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {notes.map((n) => (
                  <li key={n.id} className="py-4 first:pt-0 last:pb-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Chip tone={KIND_TONE[n.kind] || 'slate'}>{KIND_LABEL[n.kind] || n.kind}</Chip>
                      <span className="text-xs text-slate-500">
                        {n.staffName || n.staffId}{n.staffRole ? ` (${roleLabel(n.staffRole)})` : ''} · <span className="font-mono">{n.staffId}</span> · {formatDateTime(n.recordedAt)}
                      </span>
                    </div>
                    <RecordFields fields={n.fields} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="flex flex-wrap gap-2 text-xs">
            <Link className="btn-ghost !py-1.5" to={`/patients/${incidentId}`}>Patient profile</Link>
            <Link className="btn-ghost !py-1.5" to={`/status/${incidentId}`}>Status management</Link>
            {can('timeline.view') && <Link className="btn-ghost !py-1.5" to={`/timeline/${incidentId}`}>Timeline</Link>}
          </div>
        </div>
      )}

      <ConfirmDialog open={!!pending} title={confirmText[0]} confirmLabel="Confirm and save" busy={busy} onConfirm={submit} onCancel={() => setPending(null)}>
        <p>{confirmText[1]}</p>
        <p className="mt-2 font-mono text-xs text-slate-500">{incidentId}</p>
      </ConfirmDialog>
      <ConfirmDialog open={cancelAsk} title="Discard unsaved entries?" tone="danger" confirmLabel="Discard" cancelLabel="Keep editing" onConfirm={() => navigate(`/patients/${incidentId}`)} onCancel={() => setCancelAsk(false)}>
        <p>Anything you typed on this page has not been saved.</p>
      </ConfirmDialog>
    </>
  );
}
