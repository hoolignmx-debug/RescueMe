import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import AppLayout from './components/AppLayout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import IncomingPatients from './pages/IncomingPatients.jsx';
import PatientProfile from './pages/PatientProfile.jsx';
import AmbulanceTracking from './pages/AmbulanceTracking.jsx';
import MedicalHandoff from './pages/MedicalHandoff.jsx';
import StatusManagement from './pages/StatusManagement.jsx';
import IncidentTimeline from './pages/IncidentTimeline.jsx';
import BloodBank from './pages/BloodBank.jsx';
import AuditHistory from './pages/AuditHistory.jsx';

// Route guard. Unauthenticated users go to /login (and come back afterwards).
// Authenticated users without the required permission see an explicit "not authorized" page.
// NOTE: this only hides screens. The backend must enforce the same rules on every API call.
function Protected({ permission, children }) {
  const { isAuthenticated, can } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (permission && !can(permission)) return <NotAuthorized />;
  return children;
}

function NotAuthorized() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center" role="alert">
      <ShieldAlert className="mx-auto h-10 w-10 text-red-500" aria-hidden="true" />
      <h1 className="mt-3 text-lg font-bold text-slate-900">Access not authorized</h1>
      <p className="mt-1 text-sm text-slate-600">Your role does not have permission to open this page. This attempt may be recorded.</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="card mx-auto mt-10 max-w-lg p-8 text-center">
      <h1 className="text-lg font-bold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-600">Use the menu to navigate.</p>
    </div>
  );
}

// Per-incident pages accept an optional :incidentId; without one they show an incident picker.
const incidentRoute = (path, permission, Page) => (
  <>
    <Route path={path} element={<Protected permission={permission}><Page /></Protected>} />
    <Route path={`${path}/:incidentId`} element={<Protected permission={permission}><Page /></Protected>} />
  </>
);

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><AppLayout /></Protected>}>
        <Route index element={<Protected permission="incidents.view"><Dashboard /></Protected>} />
        <Route path="incidents" element={<Protected permission="incidents.view"><IncomingPatients /></Protected>} />
        {incidentRoute('patients', 'profile.view', PatientProfile)}
        {incidentRoute('tracking', 'tracking.view', AmbulanceTracking)}
        {incidentRoute('handoff', 'handoff.view', MedicalHandoff)}
        {incidentRoute('status', 'incidents.view', StatusManagement)}
        {incidentRoute('timeline', 'timeline.view', IncidentTimeline)}
        {incidentRoute('blood-bank', 'bloodbank.view', BloodBank)}
        <Route path="audit" element={<Protected permission="audit.view"><AuditHistory /></Protected>} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
