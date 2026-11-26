const isValidDate = (d) => d instanceof Date && !Number.isNaN(d.getTime());
const toDate = (value) => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return isValidDate(d) ? d : null;
};

export const formatTime = (value) => {
  const d = toDate(value);
  return d ? d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—';
};

export const formatDateTime = (value) => {
  const d = toDate(value);
  return d
    ? d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';
};

export const formatEta = (minutes) => {
  if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return 'Not available';
  const m = Number(minutes);
  if (m <= 0) return 'Arriving now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

// Value for <input type="datetime-local"> in the user's local timezone.
export const toLocalInputValue = (value = new Date()) => {
  const d = toDate(value);
  if (!d) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const fromLocalInputValue = (value) => {
  const d = toDate(value);
  return d ? d.toISOString() : null;
};

export const timeAgo = (value) => {
  const d = toDate(value);
  if (!d) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.floor(hrs / 24)} d ago`;
};

export const titleCase = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

export const newRequestId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
