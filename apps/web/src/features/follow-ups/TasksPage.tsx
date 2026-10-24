import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useServerQuery } from '@/hooks/use-server-query';
import { formatDay, formatMobile, formatWhen, statusLabel, todayYmd } from '@/lib/format';
import type { FollowUp, LabReport } from '@/types';
import { Badge, Button, Card, TextInput } from '@/components/ui';

type Tasks = {
  followUps: FollowUp[];
  reportReviews: Array<LabReport & { patient: { id: string; fullName: string; patientCode: string }; labOrder: { testName: string } | null }>;
};

export function TasksPage() {
  const queryClient = useQueryClient();
  const tasksQuery = useServerQuery<Tasks>(['tasks'], '/api/tasks');
  const tasks = tasksQuery.data;
  const [dates, setDates] = useState<Record<string, string>>({});

  async function update(id: string, status: string, followUpDate?: string) {
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status, followUpDate }) });
    await queryClient.invalidateQueries({ queryKey: ['tasks'] });
  }

  if (tasksQuery.isError) return <p className="text-sm text-rose-800">Could not load tasks.</p>;
  if (!tasks) return <p className="text-sm text-slate-500">Loading tasks…</p>;

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-serif text-2xl">Follow-ups</h2>
        <ul className="mt-3 space-y-4">
          {tasks.followUps.map((task) => (
            <li key={task.id} className="border-t border-line pt-3">
              <div className="flex items-center justify-between gap-2">
                <Link className="font-medium hover:underline" to={`/patients/${task.patient?.id}`}>{task.patient?.fullName}</Link>
                <Badge value={task.status}>{statusLabel(task.status)}</Badge>
              </div>
              <div className="text-sm text-slate-500">{formatDay(task.dueDate)} · {formatMobile(task.patient?.mobile)} · {task.doctor?.name}</div>
              {task.instructions && <p className="text-sm">{task.instructions}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => void update(task.id, 'COMPLETED')}>Done</Button>
                <Button variant="ghost" onClick={() => void update(task.id, 'UNREACHABLE')}>Unreachable</Button>
                <Button variant="ghost" onClick={() => void update(task.id, 'DECLINED')}>Declined</Button>
                <TextInput type="date" className="max-w-40" value={dates[task.id] ?? todayYmd()} onChange={(event) => setDates({ ...dates, [task.id]: event.target.value || todayYmd() })} />
                <Button variant="secondary" onClick={() => void update(task.id, 'RESCHEDULED', dates[task.id] || todayYmd())}>
                  Move to this date
                </Button>
              </div>
            </li>
          ))}
          {tasks.followUps.length === 0 && <li className="text-sm text-slate-500">No open follow-ups.</li>}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="font-serif text-2xl">Reports awaiting review</h2>
        <ul className="mt-3 space-y-3">
          {tasks.reportReviews.map((report) => (
            <li key={report.id} className="border-t border-line pt-3 text-sm">
              <Link className="font-medium hover:underline" to={`/patients/${report.patient.id}`}>{report.patient.fullName}</Link>
              <div className="text-slate-500">{report.labOrder?.testName ?? report.fileName} · {formatWhen(report.reportedAt)}</div>
              <a className="text-teal underline" href={`/api/lab-reports/${report.id}/file`} target="_blank" rel="noreferrer">Open file</a>
            </li>
          ))}
          {tasks.reportReviews.length === 0 && <li className="text-sm text-slate-500">No reports waiting.</li>}
        </ul>
      </Card>
    </div>
  );
}
