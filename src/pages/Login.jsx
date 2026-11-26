import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Cross, Eye, EyeOff, Loader2, LogIn, FlaskConical, Info } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { validateLogin, hasErrors } from '../utils/validators.js';
import { config } from '../config.js';
import { roleLabel } from '../utils/permissions.js';
import { ErrorPanel, InfoNote } from '../components/DataStates.jsx';

export default function Login() {
  const { login, isAuthenticated, notice, clearNotice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [demoAccounts, setDemoAccounts] = useState([]);

  // Demo credentials are loaded lazily and ONLY in demo mode, so a live build never bundles them.
  useEffect(() => {
    if (!config.useMock) return;
    import('../services/backends/mock/demoData.js').then((m) => setDemoAccounts(m.DEMO_USERS));
  }, []);

  if (isAuthenticated) return <Navigate to={location.state?.from || '/'} replace />;

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => ({ ...er, [k]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const v = validateLogin(form);
    setErrors(v);
    setSubmitError(null);
    if (hasErrors(v)) return;
    setBusy(true);
    clearNotice();
    try {
      await login(form.identifier, form.password);
      navigate(location.state?.from || '/', { replace: true });
    } catch (err) {
      setSubmitError(err);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 via-white to-teal-50 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl md:grid-cols-5">
        <div className="hidden flex-col justify-between bg-gradient-to-br from-teal-600 to-blue-700 p-8 text-white md:col-span-2 md:flex">
          <div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15">
              <Cross className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="mt-6 text-2xl font-bold leading-tight">Hospital ER Dashboard</h1>
            <p className="mt-2 text-sm text-teal-50">Incoming trauma queue, authorized emergency profiles and medical handoff for ER teams.</p>
          </div>
          <p className="text-xs text-teal-100">Emergency SOS Face Identification &amp; Medical Handoff System — college prototype. Synthetic data only.</p>
        </div>

        <div className="p-6 sm:p-8 md:col-span-3">
          <h2 className="text-xl font-bold text-slate-900">Staff sign in</h2>
          <p className="mt-1 text-sm text-slate-500">{config.hospital.name}</p>

          <div className="mt-4 space-y-3">
            {notice && <InfoNote tone="amber" icon={Info}>{notice}</InfoNote>}
            {submitError && <ErrorPanel error={submitError} compact />}
          </div>

          <form onSubmit={submit} noValidate className="mt-4 space-y-4">
            <div>
              <label htmlFor="identifier" className="label">Staff ID / Email</label>
              <input id="identifier" className={`input ${errors.identifier ? 'input-error' : ''}`} value={form.identifier} onChange={set('identifier')} autoComplete="username" autoFocus aria-invalid={!!errors.identifier} aria-describedby={errors.identifier ? 'identifier-err' : undefined} />
              {errors.identifier && <p id="identifier-err" className="mt-1 text-xs text-red-600">{errors.identifier}</p>}
            </div>
            <div>
              <label htmlFor="password" className="label">Password</label>
              <div className="relative">
                <input id="password" type={showPw ? 'text' : 'password'} className={`input pr-10 ${errors.password ? 'input-error' : ''}`} value={form.password} onChange={set('password')} autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-err' : undefined} />
                <button type="button" onClick={() => setShowPw((s) => !s)} className="absolute inset-y-0 right-0 px-3 text-slate-400 hover:text-slate-600" aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {errors.password && <p id="password-err" className="mt-1 text-xs text-red-600">{errors.password}</p>}
            </div>
            <button type="submit" className="btn-primary w-full" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogIn className="h-4 w-4" aria-hidden="true" />}
              {busy ? 'Signing in…' : 'Login'}
            </button>
          </form>

          {config.useMock && demoAccounts.length > 0 && (
            <div className="mt-6 rounded-2xl border border-fuchsia-200 bg-fuchsia-50 p-4">
              <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-fuchsia-700">
                <FlaskConical className="h-4 w-4" aria-hidden="true" /> Demo accounts (synthetic — demo mode only)
              </p>
              <ul className="mt-2 space-y-2">
                {demoAccounts.map((a) => (
                  <li key={a.staff_id} className="flex items-center justify-between gap-2 text-xs text-slate-700">
                    <span className="min-w-0">
                      <strong>{roleLabel(a.role)}</strong> — <span className="font-mono">{a.staff_id}</span> / <span className="font-mono">{a.password}</span>
                    </span>
                    <button type="button" className="btn-ghost !px-2.5 !py-1 text-xs" onClick={() => { setForm({ identifier: a.staff_id, password: a.password }); setErrors({}); }}>
                      Use
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
