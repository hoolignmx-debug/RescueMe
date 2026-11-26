import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import { useAsyncData } from '../hooks/useAsyncData.js';
import { getIncident, getTimeline } from '../services/incidentService.js';
import { config } from '../config.js';
import PageHeader from '../components/PageHeader.jsx';
import IncidentPicker from '../components/IncidentPicker.jsx';
import Timeline from '../components/Timeline.jsx';
import { StatusBadge, SeverityBadge } from '../components/StatusBadge.jsx';
import { Loading, ErrorPanel, StaleBanner, EmptyState, InfoNote } from '../components/DataStates.jsx';

export default function IncidentTimeline() {
  const { incidentId } = useParams();
  const navigate = useNavigate();
  const opts = { enabled: !!incidentId, refreshOnChange: true, intervalMs: config.pollIntervalMs };
  const timelineQ = useAsyncData(() => getTimeline(incidentId), [incidentId], opts);
  const incidentQ = useAsyncData(() => getIncident(incidentId), [incidentId], opts);

  if (!incidentId) {
    return (
      <>
        <PageHeader title="Incident Timeline" subtitle="Choose an incident to see its full timeline" />
        <IncidentPicker basePath="/timeline" />
      </>
    );
  }

  const events = timelineQ.data || [];
  const incident = incidentQ.data;

  return (
    <>
      <PageHeader
        title="Incident Timeline"
        subtitle={incidentId}
        onRefresh={() => { timelineQ.refresh(); incidentQ.refresh(); }}
        refreshing={timelineQ.loading}
        updatedAt={timelineQ.updatedAt}
        actions={<button type="button" className="btn-ghost" onClick={() => navigate('/timeline')}><ArrowLeft className="h-4 w-4" /> All incidents</button>}
      />
      {timelineQ.loading && !timelineQ.data ? (
        <Loading label="Loading timeline…" />
      ) : timelineQ.error && !timelineQ.data ? (
        <ErrorPanel error={timelineQ.error} onRetry={timelineQ.refresh} />
      ) : (
        <div className="space-y-4">
          <StaleBanner error={timelineQ.error} onRetry={timelineQ.refresh} />
          {incident?.isDemo && (
            <InfoNote tone="fuchsia" icon={FlaskConical}>
              <strong>DEMO DATA.</strong> These events are synthetic; their times are illustrative.
            </InfoNote>
          )}
          <div className="card card-pad">
            {incident && (
              <div className="mb-5 flex flex-wrap items-center gap-2 border-b border-slate-100 pb-4">
                <span className="font-mono text-sm font-bold text-slate-900">{incident.id}</span>
                <StatusBadge status={incident.status} />
                <SeverityBadge severity={incident.severity} />
              </div>
            )}
            {events.length === 0 ? (
              <EmptyState title="No events recorded" message="Events appear here as the incident progresses." />
            ) : (
              <Timeline events={events} />
            )}
          </div>
          <p className="text-xs text-slate-400">Times are the timestamps stored by the backend, shown in your local time zone.</p>
        </div>
      )}
    </>
  );
}
