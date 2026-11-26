import { getBackend } from './backend.js';
import { ApiError } from './api.js';

const VALID_ROLES = ['ER_DOCTOR', 'PARAMEDIC', 'ADMIN'];

// Returns { token, expiresAt (ms epoch), user: { staffId, name, email, role } }
export async function login(identifier, password) {
  const b = await getBackend();
  const res = await b.login(identifier.trim(), password);
  const token = res?.access_token;
  const role = String(res?.user?.role || '').toUpperCase();
  if (!token || !VALID_ROLES.includes(role)) {
    // never treat a malformed response as a successful login
    throw new ApiError('UNKNOWN', 'The server returned an unexpected login response. Please contact the system administrator.');
  }
  const ttl = Number(res.expires_in);
  return {
    token,
    expiresAt: Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 15 * 60) * 1000,
    user: {
      staffId: res.user.staff_id,
      name: res.user.name || res.user.staff_id,
      email: res.user.email || null,
      role,
    },
  };
}

// Best-effort server-side token revocation; local sign-out always proceeds.
export async function logout() {
  try {
    const b = await getBackend();
    await b.logout();
  } catch {
    /* ignore: token is dropped locally regardless */
  }
}
