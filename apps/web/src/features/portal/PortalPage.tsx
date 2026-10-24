import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Banner, Card } from '@/components/ui';
import { formatDay } from '@/lib/format';
import { api } from '@/services/api';

type Portal = {
  clinic: { name: string };
  patient: { fullName: string; patientCode: string };
  expiresAt: string;
  prescriptions: Array<{ id: string; createdAt: string; version: number }>;
  reports: Array<{ id: string; fileName: string; reportedAt: string; labOrder: { testName: string } | null }>;
  followUps: Array<{ id: string; dueDate: string; instructions: string | null }>;
};

export function PortalPage() {
  const { token = '' } = useParams();
  const portal = useQuery({
    queryKey: ['portal', token],
    retry: false,
    queryFn: () => api<Portal>(`/api/portal/${token}`),
  });

  if (portal.isError) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <Banner>This link is unavailable. Ask the clinic for a new one.</Banner>
      </div>
    );
  }
  if (!portal.data) return <p className="px-4 py-16 text-sm text-slate-500">Opening your records…</p>;
  const { data } = portal;

  return (
    <div className="mx-auto max-w-lg space-y-4 px-4 py-10">
      <div>
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{data.clinic.name}</div>
        <h1 className="font-serif text-4xl">{data.patient.fullName}</h1>
        <p className="text-sm text-slate-500">{data.patient.patientCode} · link expires {formatDay(data.expiresAt)}</p>
      </div>
      <Card className="p-5">
        <h2 className="font-serif text-2xl">Prescriptions</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.prescriptions.length === 0 && <li className="text-slate-500">None shared yet.</li>}
          {data.prescriptions.map((item) => (
            <li key={item.id}>
              <a className="text-teal underline" href={`/api/portal/${token}/prescriptions/${item.id}/pdf`}>
                Prescription v{item.version} · {formatDay(item.createdAt)}
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="font-serif text-2xl">Laboratory reports</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.reports.length === 0 && <li className="text-slate-500">None shared yet.</li>}
          {data.reports.map((item) => (
            <li key={item.id}>
              <a className="text-teal underline" href={`/api/portal/${token}/reports/${item.id}/file`}>
                {item.labOrder?.testName ?? item.fileName}
              </a>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-5">
        <h2 className="font-serif text-2xl">Follow-ups</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {data.followUps.length === 0 && <li className="text-slate-500">No follow-up is scheduled.</li>}
          {data.followUps.map((item) => (
            <li key={item.id}>
              <span className="font-medium">{formatDay(item.dueDate)}</span>
              {item.instructions ? ` · ${item.instructions}` : ''}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
