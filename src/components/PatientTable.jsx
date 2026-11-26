import { Eye, MapPin } from 'lucide-react';
import { StatusBadge, SeverityBadge, DemoTag, Chip } from './StatusBadge.jsx';
import { BloodGroup, ListValue } from './Field.jsx';
import { etaText } from '../utils/display.js';

export const Restricted = () => <span className="text-xs italic text-slate-400">Restricted</span>;
export const NotAvailable = ({ text = 'Not available' }) => <span className="text-xs italic text-slate-400">{text}</span>;

export function PatientName({ incident }) {
  if (incident.restricted) return <Restricted />;
  if (incident.patientName) return <span className="font-semibold text-slate-900">{incident.patientName}</span>;
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="text-sm font-semibold text-slate-500">Unidentified patient</span>
      <Chip tone="amber">Identity {incident.identityStatus === 'PENDING_REVIEW' ? 'pending review' : 'not verified'}</Chip>
    </span>
  );
}

export function BloodCell({ incident }) {
  if (incident.restricted) return <Restricted />;
  if (incident.bloodGroup) return <BloodGroup group={incident.bloodGroup} verified={incident.bloodGroupVerified} />;
  return <NotAvailable text={incident.identityVerified ? 'Not available' : 'Unconfirmed'} />;
}

export function MedicalList({ incident, items, tone }) {
  if (incident.restricted) return <Restricted />;
  return <ListValue items={items} tone={tone} unknownLabel={incident.identityVerified ? 'Not available' : 'Unconfirmed'} />;
}

export default function PatientTable({ incidents, onView, canView = true }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[68rem] w-full divide-y divide-slate-200">
        <thead className="bg-slate-50">
          <tr>
            {['Incident ID', 'Patient name', 'Age', 'Incident location', 'Blood group', 'Allergies', 'Ambulance ID', 'ETA', 'Status', 'Action'].map((h) => (
              <th key={h} scope="col" className="th">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {incidents.map((i) => (
            <tr key={i.id} className="hover:bg-slate-50/70">
              <td className="td">
                <div className="font-mono text-xs font-semibold text-slate-900">{i.id}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  <SeverityBadge severity={i.severity} />
                  {i.isDemo && <DemoTag />}
                </div>
              </td>
              <td className="td">
                <PatientName incident={i} />
              </td>
              <td className="td">{i.restricted ? <Restricted /> : i.age ?? <NotAvailable text="—" />}</td>
              <td className="td max-w-[14rem]">
                {i.locationText ? (
                  <span className="inline-flex items-start gap-1 text-slate-700">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden="true" />
                    {i.locationText}
                  </span>
                ) : (
                  <NotAvailable />
                )}
              </td>
              <td className="td">
                <BloodCell incident={i} />
              </td>
              <td className="td">
                <MedicalList incident={i} items={i.allergies} tone="red" />
              </td>
              <td className="td font-mono text-xs">{i.ambulanceId || <NotAvailable text="Not assigned" />}</td>
              <td className="td whitespace-nowrap font-semibold text-slate-800">{etaText(i)}</td>
              <td className="td">
                <StatusBadge status={i.status} />
              </td>
              <td className="td">
                {canView ? (
                  <button type="button" className="btn-blue !px-3 !py-1.5 text-xs" onClick={() => onView(i.id)}>
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" /> VIEW PATIENT
                  </button>
                ) : (
                  <NotAvailable text="No clinical access" />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
