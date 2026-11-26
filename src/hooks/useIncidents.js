import { useAsyncData } from './useAsyncData.js';
import { listIncidents } from '../services/incidentService.js';
import { config } from '../config.js';

// All incidents, polled at VITE_POLL_INTERVAL_MS (the agreed contract has no push channel yet;
// swap this hook's internals for SSE/WebSocket once Member 2 provides one).
export function useIncidents({ poll = true } = {}) {
  return useAsyncData(() => listIncidents(), [], {
    intervalMs: poll ? config.pollIntervalMs : 0,
    refreshOnChange: true,
  });
}
