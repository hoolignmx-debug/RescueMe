import { useState } from 'react';
import { FlaskConical, ChevronDown } from 'lucide-react';
import { config } from '../config.js';
import { emitDataChanged } from '../services/bus.js';
import { useToast } from '../context/ToastContext.jsx';

// Always visible in demo mode so synthetic data can never be mistaken for real patients.
// The tools menu lets presenters/testers simulate failures (outage, expired session).
export default function DemoBanner() {
  const [open, setOpen] = useState(false);
  const [outage, setOutage] = useState(false);
  const toast = useToast();
  if (!config.useMock) return null;

  const controls = async () => (await import('../services/backends/mock/mockBackend.js')).demoControls;

  const run = async (fn, message) => {
    const c = await controls();
    fn(c);
    toast.info(message);
    emitDataChanged('incidents');
  };

  return (
    <div className="border-b border-fuchsia-200 bg-fuchsia-50 px-4 py-2 text-sm text-fuchsia-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <FlaskConical className="h-4 w-4 shrink-0" aria-hidden="true" />
        <p className="flex-1">
          <strong>DEMO DATA</strong> — all patients, staff, ambulances and the blood bank are synthetic and served by a built-in simulated backend. Nothing here is real.
        </p>
        <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 font-semibold underline" aria-expanded={open}>
          Demo tools <ChevronDown className={`h-4 w-4 transition ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => run((c) => c.reset(), 'Demo data reset to the original five patients.')}>
            Reset demo data
          </button>
          <button
            type="button"
            className="btn-ghost !py-1.5 text-xs"
            onClick={() => {
              const next = !outage;
              setOutage(next);
              run((c) => c.setOutage(next), next ? 'Simulated backend outage ON.' : 'Simulated backend outage OFF.');
            }}
          >
            {outage ? 'End simulated outage' : 'Simulate backend outage'}
          </button>
          <button type="button" className="btn-ghost !py-1.5 text-xs" onClick={() => run((c) => c.expireCurrentSession(), 'Session token expired — the next request will sign you out.')}>
            Expire my session token
          </button>
        </div>
      )}
    </div>
  );
}
