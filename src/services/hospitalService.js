import { getBackend } from './backend.js';
import { normalizeBloodBank, normalizeAudit } from './normalize.js';

export async function getBloodBank(incidentId) {
  const b = await getBackend();
  return normalizeBloodBank(await b.getBloodBank(incidentId));
}

export async function listAudit(params = {}) {
  const b = await getBackend();
  return normalizeAudit(await b.listAudit(params));
}
