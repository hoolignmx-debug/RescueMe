import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Siren, UserRound, Ambulance, ClipboardCheck, Activity, History, Droplets, ScrollText, X, Cross,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { config } from '../config.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'incidents.view', end: true },
  { to: '/incidents', label: 'Incoming Queue', icon: Siren, perm: 'incidents.view' },
  { to: '/patients', label: 'Patient Profile', icon: UserRound, perm: 'profile.view' },
  { to: '/tracking', label: 'Ambulance Tracking', icon: Ambulance, perm: 'tracking.view' },
  { to: '/handoff', label: 'Medical Handoff', icon: ClipboardCheck, perm: 'handoff.view' },
  { to: '/status', label: 'Status Management', icon: Activity, perm: 'incidents.view' },
  { to: '/timeline', label: 'Incident Timeline', icon: History, perm: 'timeline.view' },
  { to: '/blood-bank', label: 'Blood Bank', icon: Droplets, perm: 'bloodbank.view' },
  { to: '/audit', label: 'Audit & History', icon: ScrollText, perm: 'audit.view' },
];

export default function Sidebar({ open, onClose }) {
  const { can } = useAuth();
  const items = NAV.filter((n) => can(n.perm));

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center gap-3 border-b border-slate-200 px-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal-600 text-white">
            <Cross className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-900">ER Dashboard</p>
            <p className="truncate text-xs text-slate-500">{config.hospital.name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 lg:hidden" aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-teal-50 text-teal-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`
              }
            >
              <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
        <p className="border-t border-slate-200 p-3 text-[11px] leading-snug text-slate-400">
          College prototype. Synthetic data only. Not for real clinical use.
        </p>
      </aside>
    </>
  );
}
