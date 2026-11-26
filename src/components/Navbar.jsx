import { useState } from 'react';
import { Menu, LogOut, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { roleLabel } from '../utils/permissions.js';
import { config } from '../config.js';
import ConfirmDialog from './ConfirmDialog.jsx';

export default function Navbar({ onMenu }) {
  const { user, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const doLogout = async () => {
    setBusy(true);
    await logout();
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur">
      <button type="button" onClick={onMenu} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </button>

      <div className="hidden min-w-0 sm:block">
        <p className="truncate text-sm font-semibold text-slate-800">{config.hospital.name}</p>
        <p className="text-xs text-slate-500">Emergency Department</p>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <span
          className={`hidden rounded-full px-2.5 py-1 text-xs font-bold ring-1 ring-inset sm:inline ${
            config.useMock ? 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
          }`}
        >
          {config.useMock ? 'DEMO MODE' : 'LIVE BACKEND'}
        </span>
        <div className="flex items-center gap-2.5 rounded-xl border border-slate-200 py-1 pl-1.5 pr-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-100 text-teal-700">
            <User className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="hidden leading-tight sm:block">
            <p className="max-w-[12rem] truncate text-sm font-semibold text-slate-800">{user?.name}</p>
            <p className="text-xs text-slate-500">
              {roleLabel(user?.role)} · {user?.staffId}
            </p>
          </div>
        </div>
        <button type="button" className="btn-ghost !px-3" onClick={() => setConfirming(true)}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>

      <ConfirmDialog open={confirming} title="Sign out?" confirmLabel="Sign out" busy={busy} onConfirm={doLogout} onCancel={() => setConfirming(false)}>
        Your session token will be revoked and you will need to sign in again to view patient information.
      </ConfirmDialog>
    </header>
  );
}
