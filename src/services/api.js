// Central HTTP client for Member 2's backend.
// - Base URL comes from VITE_API_BASE_URL (src/config.js)
// - Adds the bearer token, applies a timeout, and normalises every failure into ApiError
// - Never fabricates a success: failures always throw

import { config } from '../config.js';
import { getToken, notifyUnauthorized } from './session.js';

export class ApiError extends Error {
  constructor(kind, message, { status = 0, code = null, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // NETWORK | TIMEOUT | UNAUTHENTICATED | INVALID_CREDENTIALS | FORBIDDEN | NOT_FOUND
    //                   NOT_IMPLEMENTED | DUPLICATE | INVALID_TRANSITION | VALIDATION | CONFLICT | SERVER | UNKNOWN
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const isApiError = (e) => e instanceof ApiError;

// Understands FastAPI error bodies: {detail: "text"} | {detail: {code, message}} | {detail: [{loc, msg}]}
function parseErrorBody(body) {
  if (!body || typeof body !== 'object') return { message: null, code: null };
  const d = body.detail ?? body.error ?? body.message ?? null;
  if (typeof d === 'string') return { message: d, code: body.code ?? null };
  if (Array.isArray(d)) {
    return { message: d.map((x) => x?.msg).filter(Boolean).join('; ') || null, code: 'VALIDATION' };
  }
  if (d && typeof d === 'object') return { message: d.message ?? null, code: d.code ?? null };
  return { message: null, code: body.code ?? null };
}

function toApiError(status, body, { notImplementedOn404, login }) {
  const { message, code } = parseErrorBody(body);
  const opts = { status, code, details: body };
  if (status === 401) {
    return login
      ? new ApiError('INVALID_CREDENTIALS', 'Invalid Staff ID/email or password.', opts)
      : new ApiError('UNAUTHENTICATED', 'Your session has expired. Please sign in again.', opts);
  }
  if (status === 403) {
    return new ApiError('FORBIDDEN', message || 'You are not authorized to access this record.', opts);
  }
  if (status === 404 || status === 405 || status === 501) {
    return notImplementedOn404
      ? new ApiError(
          'NOT_IMPLEMENTED',
          'The backend does not provide this feature yet. See docs/API_INTEGRATION.md for the endpoint Member 2 needs to add.',
          opts,
        )
      : new ApiError('NOT_FOUND', message || 'The requested record was not found.', opts);
  }
  if (status === 409) {
    if (code === 'DUPLICATE_NOTE') return new ApiError('DUPLICATE', message || 'An identical note was already saved.', opts);
    if (code === 'INVALID_TRANSITION') return new ApiError('INVALID_TRANSITION', message || 'That status change is not allowed.', opts);
    return new ApiError('CONFLICT', message || 'The request conflicts with the current record state.', opts);
  }
  if (status === 400 || status === 422) {
    if (code === 'INVALID_TRANSITION') return new ApiError('INVALID_TRANSITION', message || 'That status change is not allowed.', opts);
    return new ApiError('VALIDATION', message || 'The submitted data was rejected by the server.', opts);
  }
  if (status >= 500) {
    return new ApiError('SERVER', 'The hospital backend reported an internal error. Please try again shortly.', opts);
  }
  return new ApiError('UNKNOWN', message || `Unexpected response (${status}).`, opts);
}

async function send(path, { method = 'GET', body, query, signal, auth = true, headers = {} } = {}) {
  let url = `${config.apiBaseUrl}${path}`;
  if (query) {
    const qs = new URLSearchParams(
      Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''),
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, config.requestTimeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const finalHeaders = { Accept: 'application/json', ...headers };
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json';
  const token = getToken();
  if (auth && token) finalHeaders.Authorization = `Bearer ${token}`;

  try {
    return await fetch(url, {
      method,
      headers: finalHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      credentials: 'omit',
    });
  } catch (err) {
    if (timedOut) {
      throw new ApiError('TIMEOUT', 'The backend took too long to respond. Check your connection and try again.');
    }
    if (err?.name === 'AbortError') throw err; // caller cancelled
    throw new ApiError('NETWORK', 'Cannot reach the hospital backend. Check your connection or whether the server is running.');
  } finally {
    clearTimeout(timer);
  }
}

export async function request(path, opts = {}) {
  const res = await send(path, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = toApiError(res.status, data, {
      notImplementedOn404: !!opts.optionalEndpoint,
      login: !!opts.login,
    });
    if (err.kind === 'UNAUTHENTICATED' && opts.auth !== false) notifyUnauthorized(err.message);
    throw err;
  }
  return data;
}

// Authenticated binary fetch (e.g. patient photo). <img src> cannot send the bearer token,
// so we fetch the bytes ourselves and hand back a temporary object URL.
export async function requestBlobUrl(path) {
  const res = await send(path, { headers: { Accept: 'image/*' } });
  if (!res.ok) throw toApiError(res.status, null, {});
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
