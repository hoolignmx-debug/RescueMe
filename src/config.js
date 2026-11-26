// Central configuration. All values are PUBLIC (bundled into the browser).
// Tolerates a missing import.meta.env so the same modules run in Node tests.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const toBool = (value, fallback) =>
  value === undefined || value === '' ? fallback : String(value).toLowerCase() === 'true';
const toNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const config = {
  apiBaseUrl: String(env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/+$/, ''),
  // Demo mode is ON unless explicitly disabled, and is always announced in the UI.
  useMock: toBool(env.VITE_USE_MOCK, true),
  requestTimeoutMs: toNumber(env.VITE_REQUEST_TIMEOUT_MS, 10000),
  pollIntervalMs: toNumber(env.VITE_POLL_INTERVAL_MS, 15000),
  hospital: {
    name: env.VITE_HOSPITAL_NAME || 'Demo General Hospital',
    // Synthetic demo coordinates (not a real facility).
    latitude: 28.4089,
    longitude: 77.3178,
  },
};
