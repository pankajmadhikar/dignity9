import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { useServerQuery } from '@/hooks/use-server-query';
import { formatDay, patientLine, statusLabel, tokenLabel, vitalSummary } from '@/lib/format';
import type { ClinicalAlert, FollowUp, LabReport, QueueEntry } from '@/types';
import { Badge, Banner, Button, Card } from '@/components/ui';

type Dashboard = {
  counts: Record<string, number>;
  active: QueueEntry | null;
  next: QueueEntry | null;
  waiting: QueueEntry[];
  reportReviews: Array<LabReport & { patient: { id: string; fullName: string; patientCode: string }; labOrder: { testName: string } | null }>;
  followUps: FollowUp[];
  alerts: ClinicalAlert[];
};

export function DoctorPage() {
  const navigate = useNavigate();
  const dashboard = useServerQuery<Dashboard>(['dashboard'], '/api/dashboard');
  const data = dashboard.data;
  const [error, setError] = useState('');

  async function callNext() {
    setError('');
    try {
      const result = await api<{ entry: QueueEntry }>('/api/queue/call-next', { method: 'POST' });
      navigate(`/consult/${result.entry.visit.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No patient to call');
    }
  }

  if (dashboard.isError) return <Banner>{dashboard.error.message}</Banner>;
  if (!data) return <p className="text-sm text-slate-500">Loading today’s board…</p>;

  return (
    <div className="space-y-5">
      {error && <Banner>{error}</Banner>}
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Waiting', data.counts.waiting],
          ['Called', data.counts.called],
          ['In consult', data.counts.inConsultation],
          ['Completed', data.counts.completed],
          ['No-show', data.counts.noShow],
          ['Reports', data.reportReviews.length],
        ].map(([label, value]) => (
          <Card key={String(label)} className="px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
            <div className="font-serif text-3xl">{value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.3fr_0.7fr]">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-2xl">Queue</h2>
            <Button onClick={() => void callNext()}>Call next</Button>
          </div>
          {data.active && (
            <Card className="border-teal bg-teal-soft p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-dark">Current patient</div>
              <div className="mt-1 font-serif text-2xl">{data.active.visit.patient.fullName}</div>
              <div className="text-sm">{data.active.visit.chiefComplaint}</div>
              <Link to={`/consult/${data.active.visit.id}`}><Button className="mt-3">Continue chart</Button></Link>
            </Card>
          )}
          {data.waiting.map((entry) => (
            <Card key={entry.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-xl">{tokenLabel(entry.tokenNumber)}</span>
                    <span className="font-medium">{entry.visit.patient.fullName}</span>
                    {entry.priority === 'EMERGENCY' && <Badge value="EMERGENCY">Emergency</Badge>}
                  </div>
                  <div className="text-sm">{entry.visit.chiefComplaint}</div>
                  <div className="text-xs text-slate-500">
                    {patientLine(entry.visit.patient)} · {vitalSummary(entry.visit.vitals[0])}
                  </div>
                  {entry.priorityReason && <div className="text-xs text-rose-800">{entry.priorityReason}</div>}
                </div>
                <Link to={`/consult/${entry.visit.id}`}><Button variant="secondary">Open</Button></Link>
              </div>
            </Card>
          ))}
          {data.waiting.length === 0 && !data.active && <Card className="p-5 text-sm text-slate-500">The waiting room is clear.</Card>}
        </div>
        <div className="space-y-4">
          <Card className="p-4">
            <h3 className="font-serif text-xl">Reports to review</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {data.reportReviews.map((report) => (
                <li key={report.id}>
                  <Link className="font-medium hover:underline" to={`/patients/${report.patient.id}`}>{report.patient.fullName}</Link>
                  <div className="text-slate-500">{report.labOrder?.testName ?? report.fileName}</div>
                </li>
              ))}
              {data.reportReviews.length === 0 && <li className="text-slate-500">None pending.</li>}
            </ul>
          </Card>
          <Card className="p-4">
            <h3 className="font-serif text-xl">Follow-ups due</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {data.followUps.map((task) => (
                <li key={task.id}>
                  <Link className="font-medium hover:underline" to={`/patients/${task.patient?.id}`}>{task.patient?.fullName}</Link>
                  <div className="text-slate-500">{formatDay(task.dueDate)} · {statusLabel(task.status)}</div>
                </li>
              ))}
              {data.followUps.length === 0 && <li className="text-slate-500">None due today.</li>}
            </ul>
          </Card>
          <Card className="p-4">
            <h3 className="font-serif text-xl">Measurement alerts</h3>
            <div className="mt-2 space-y-2">
              {data.alerts.map((alert) => (
                <Banner key={alert.id} tone={alert.severity === 'HIGH' ? 'error' : 'info'}>
                  <div className="font-medium">{alert.patient?.fullName}</div>
                  {alert.message}
                </Banner>
              ))}
              {data.alerts.length === 0 && <p className="text-sm text-slate-500">No open alerts.</p>}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
