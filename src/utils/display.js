import { HAS_ARRIVED } from './statuses.js';
import { formatEta } from './format.js';

// Text for the ETA column/cards. Arrived patients no longer have an ETA.
export function etaText(incident) {
  if (HAS_ARRIVED.includes(incident.status)) return 'Arrived';
  return formatEta(incident.etaMinutes);
}

export const identityLabel = (status) =>
  ({
    VERIFIED: 'Verified',
    PENDING_REVIEW: 'Pending review',
    UNVERIFIED: 'Not verified',
    REJECTED: 'Rejected',
  })[status] || 'Unknown';
