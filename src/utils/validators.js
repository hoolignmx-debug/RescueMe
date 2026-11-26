// Form validation. Each function returns an object of { fieldName: message }.
// An empty object means the form is valid.

const MAX_TEXT = 2000;
const blank = (v) => v === undefined || v === null || String(v).trim() === '';

export const CONSCIOUSNESS_OPTIONS = [
  { value: 'ALERT', label: 'Alert' },
  { value: 'VOICE', label: 'Responds to voice' },
  { value: 'PAIN', label: 'Responds to pain' },
  { value: 'UNRESPONSIVE', label: 'Unresponsive' },
  { value: 'UNKNOWN', label: 'Unknown / not assessed' },
];

export const BREATHING_OPTIONS = [
  { value: 'NORMAL', label: 'Normal' },
  { value: 'LABOURED', label: 'Laboured / distressed' },
  { value: 'ASSISTED', label: 'Assisted ventilation' },
  { value: 'ABSENT', label: 'Absent' },
  { value: 'UNKNOWN', label: 'Unknown / not assessed' },
];

export function validateLogin({ identifier, password }) {
  const errors = {};
  const id = String(identifier ?? '').trim();
  if (!id) errors.identifier = 'Enter your Staff ID or email.';
  else if (id.length > 120) errors.identifier = 'Staff ID or email is too long.';
  if (blank(password)) errors.password = 'Enter your password.';
  return errors;
}

function checkLengths(form, fields, errors) {
  for (const f of fields) {
    if (String(form[f] ?? '').length > MAX_TEXT) errors[f] = `Keep this under ${MAX_TEXT} characters.`;
  }
}

const PARAMEDIC_TEXT = [
  'initial_condition',
  'visible_injuries',
  'initial_observations',
  'treatment_provided',
  'medication_administered',
  'additional_notes',
];

export function validateParamedicHandoff(form) {
  const errors = {};
  if (blank(form.arrival_time)) errors.arrival_time = 'Arrival time is required.';
  else if (Number.isNaN(new Date(form.arrival_time).getTime())) errors.arrival_time = 'Enter a valid date and time.';
  else if (new Date(form.arrival_time).getTime() > Date.now() + 5 * 60000)
    errors.arrival_time = 'Arrival time cannot be in the future.';
  if (blank(form.initial_condition)) errors.initial_condition = 'Describe the initial patient condition.';
  if (blank(form.consciousness)) errors.consciousness = 'Select a consciousness status.';
  if (blank(form.breathing)) errors.breathing = 'Select a breathing status.';
  if (blank(form.visible_injuries)) errors.visible_injuries = 'Record visible injuries (write "None observed" if none).';
  if (blank(form.initial_observations)) errors.initial_observations = 'Enter initial observations.';
  checkLengths(form, PARAMEDIC_TEXT, errors);
  return errors;
}

export function validateDoctorAssessment(form) {
  const errors = {};
  if (blank(form.doctor_id)) errors.doctor_id = 'Doctor ID is required.';
  if (blank(form.doctor_name)) errors.doctor_name = 'Doctor name is required.';
  if (blank(form.accepted_at)) errors.accepted_at = 'Handoff acceptance time is required.';
  else if (Number.isNaN(new Date(form.accepted_at).getTime())) errors.accepted_at = 'Enter a valid date and time.';
  if (blank(form.initial_assessment)) errors.initial_assessment = 'Enter the initial assessment.';
  checkLengths(form, ['initial_assessment', 'treatment_notes'], errors);
  return errors;
}

export function validateTreatmentNote(text) {
  const errors = {};
  if (blank(text)) errors.text = 'Enter the note text.';
  else if (String(text).length > MAX_TEXT) errors.text = `Keep this under ${MAX_TEXT} characters.`;
  return errors;
}

export function validateStatusChange({ to, notes }) {
  const errors = {};
  if (to === 'OTHER_OUTCOME' && blank(notes)) errors.notes = 'Describe the outcome when selecting Other outcome.';
  if (String(notes ?? '').length > MAX_TEXT) errors.notes = `Keep this under ${MAX_TEXT} characters.`;
  return errors;
}

export const hasErrors = (errors) => Object.keys(errors).length > 0;
