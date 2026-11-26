import {
  AlertOctagon, BadgeCheck, HelpCircle, RadioTower, Ambulance, Navigation, DoorOpen, Hospital, Stethoscope, HeartPulse,
  CheckCircle2, ClipboardCheck, ClipboardList, StickyNote, Archive, CircleDot,
} from 'lucide-react';
import { formatTime, formatDateTime } from '../utils/format.js';
import { statusLabel } from '../utils/statuses.js';
import { roleLabel } from '../utils/permissions.js';

const STATUS_ICON = {
  EN_ROUTE: Navigation,
  ARRIVED: DoorOpen,
  IN_ER: Hospital,
  UNDER_TREATMENT: Stethoscope,
  STABLE: HeartPulse,
  OTHER_OUTCOME: CircleDot,
  CLOSED: Archive,
};

// Turns a backend event into a readable line. Times shown come from the backend, never generated here.
export function describeEvent(e) {
  switch (e.type) {
    case 'INCIDENT_RECEIVED':
      return { text: 'Emergency incident received.', icon: AlertOctagon, tone: 'red' };
    case 'IDENTITY_VERIFIED':
      return { text: 'Identity verification completed.', icon: BadgeCheck, tone: 'teal' };
    case 'IDENTITY_PENDING':
      return { text: 'Identity verification pending review.', icon: HelpCircle, tone: 'amber' };
    case 'EMS_NOTIFIED':
      return { text: 'EMS notified.', icon: RadioTower, tone: 'slate' };
    case 'AMBULANCE_ASSIGNED':
      return { text: 'Ambulance assigned.', icon: Ambulance, tone: 'indigo' };
    case 'HANDOFF_SUBMITTED':
      return { text: 'Paramedic handoff recorded.', icon: ClipboardList, tone: 'blue' };
    case 'DOCTOR_ASSESSMENT_SAVED':
      return { text: 'Doctor assessment saved.', icon: ClipboardCheck, tone: 'blue' };
    case 'HANDOFF_ACCEPTED':
      return { text: 'Medical handoff accepted by receiving doctor.', icon: CheckCircle2, tone: 'green' };
    case 'NOTE_ADDED':
      return { text: 'Treatment note added.', icon: StickyNote, tone: 'slate' };
    case 'STATUS_CHANGED': {
      const to = e.toStatus;
      const map = {
        EN_ROUTE: 'Ambulance en route.',
        ARRIVED: 'Patient arrived at hospital.',
        IN_ER: 'Patient admitted to ER.',
        UNDER_TREATMENT: 'Treatment started.',
        STABLE: 'Patient status updated: stable.',
        OTHER_OUTCOME: 'Patient status updated: other outcome.',
        CLOSED: 'Patient record closed.',
      };
      return { text: map[to] || `Status changed to ${statusLabel(to)}.`, icon: STATUS_ICON[to] || CircleDot, tone: to === 'CLOSED' ? 'slate' : 'blue' };
    }
    default:
      return { text: e.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) + '.', icon: CircleDot, tone: 'slate' };
  }
}

const DOT = {
  red: 'bg-red-100 text-red-600',
  teal: 'bg-teal-100 text-teal-600',
  amber: 'bg-amber-100 text-amber-600',
  slate: 'bg-slate-100 text-slate-600',
  indigo: 'bg-indigo-100 text-indigo-600',
  blue: 'bg-blue-100 text-blue-600',
  green: 'bg-emerald-100 text-emerald-600',
};

export default function Timeline({ events }) {
  return (
    <ol className="relative">
      {events.map((e, idx) => {
        const { text, icon: Icon, tone } = describeEvent(e);
        const last = idx === events.length - 1;
        return (
          <li key={e.id} className="relative flex gap-4 pb-6 last:pb-0">
            {!last && <span className="absolute left-[1.0625rem] top-9 h-[calc(100%-2.25rem)] w-px bg-slate-200" aria-hidden="true" />}
            <span className={`z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${DOT[tone]}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-sm text-slate-900">
                <time dateTime={e.timestamp || undefined} title={formatDateTime(e.timestamp)} className="mr-2 font-mono text-xs font-bold text-slate-500">
                  {formatTime(e.timestamp)}
                </time>
                — {text}
              </p>
              {(e.staffName || e.staffId) && (
                <p className="text-xs text-slate-500">
                  by {e.staffName || e.staffId}
                  {e.staffRole ? ` (${roleLabel(e.staffRole)})` : ''}
                </p>
              )}
              {e.type === 'STATUS_CHANGED' && e.fromStatus && (
                <p className="text-xs text-slate-400">
                  {statusLabel(e.fromStatus)} → {statusLabel(e.toStatus)}
                </p>
              )}
              {e.notes && <p className="mt-1 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600">“{e.notes}”</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
