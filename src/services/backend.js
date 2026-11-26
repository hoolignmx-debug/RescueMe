// Chooses between the REAL backend and the clearly-labelled DEMO backend.
// Switch with VITE_USE_MOCK in .env. There is NO automatic fallback: if the real
// backend is down, the UI shows an error instead of quietly showing demo data.

import { config } from '../config.js';
import { realBackend } from './backends/realBackend.js';

let cached = null;

export async function getBackend() {
  if (cached) return cached;
  if (config.useMock) {
    const mod = await import('./backends/mock/mockBackend.js');
    cached = mod.mockBackend;
  } else {
    cached = realBackend;
  }
  return cached;
}

export const isDemoMode = () => config.useMock;
