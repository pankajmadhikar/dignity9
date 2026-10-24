import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuth } from '@/features/auth/auth-context';
import { useServerQuery } from '@/hooks/use-server-query';
import { formatWhen, patientLine } from '@/lib/format';
import type { LabOrder } from '@/types';
import { Badge, Banner, Button, Card, TextArea, TextInput } from '@/components/ui';

export function LabsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const labs = useServerQuery<{ orders: LabOrder[] }>(['labs'], '/api/labs');
  const orders = labs.data?.orders ?? [];
  const [error, setError] = useState('');
  const [note, setNote] = useState<Record<string, string>>({});

  return (
    <div className="mx-auto max-w-3xl space-y-3">
      {(error || labs.error) && <Banner>{error || labs.error?.message}</Banner>}
      <p className="text-sm text-slate-500">Upload the laboratory file against the order. The report stays tied to that patient and visit.</p>
      {orders.length === 0 && <Card className="p-5 text-sm text-slate-500">No open laboratory orders.</Card>}
      {orders.map((order) => (
        <Card key={order.id} className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium">{order.testName}</div>
              <div className="text-sm text-slate-500">
                {order.patient && (
                  <Link className="underline" to={`/patients/${order.patient.id}`}>{order.patient.fullName}</Link>
                )}
                {order.patient ? ` · ${order.patient.patientCode} · ${patientLine(order.patient)}` : ''}
              </div>
            </div>
            <Badge value={order.status} />
          </div>
          <ul className="mt-2 space-y-1 text-sm">
            {order.reports.map((report) => (
              <li key={report.id} className="flex flex-wrap items-center justify-between gap-2">
                <a className="text-teal underline" href={`/api/lab-reports/${report.id}/file`} target="_blank" rel="noreferrer">
                  {report.fileName}
                </a>
                <span className="text-xs text-slate-500">{report.laboratory} · {formatWhen(report.reportedAt)} {report.reviewedAt ? '· reviewed' : '· awaiting review'}</span>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 flex flex-wrap items-center gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const data = new FormData(form);
              try {
                await api(`/api/lab-orders/${order.id}/report`, { method: 'POST', body: data });
                form.reset();
                await queryClient.invalidateQueries({ queryKey: ['labs'] });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Upload failed');
              }
            }}
          >
            <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className="text-sm" />
            <TextInput name="laboratory" placeholder="Laboratory name" className="max-w-48" />
            <Button>Upload report</Button>
          </form>
          {user?.role === 'DOCTOR' && order.reports.some((report) => !report.reviewedAt) && (
            <div className="mt-3 space-y-2">
              <TextArea placeholder="Review note" value={note[order.id] ?? ''} onChange={(event) => setNote({ ...note, [order.id]: event.target.value })} />
              <Button
                variant="secondary"
                onClick={async () => {
                  const report = order.reports.find((item) => !item.reviewedAt);
                  if (!report) return;
                  await api(`/api/lab-reports/${report.id}/review`, {
                    method: 'POST',
                    body: JSON.stringify({ note: note[order.id] ?? '' }),
                  });
                  await queryClient.invalidateQueries({ queryKey: ['labs'] });
                }}
              >
                Mark reviewed
              </Button>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
