import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuth } from '@/features/auth/auth-context';
import { formatDay, formatMobile, formatWhen, patientLine, statusLabel } from '@/lib/format';
import type { ClinicalAlert, FollowUp, LabOrder, Patient } from '@/types';
import { PatientForm } from '@/components/forms/PatientForm';
import { Badge, Banner, Button, Card } from '@/components/ui';

type Chart = {
  access: string;
  patient: Patient;
  visits: Array<{
    id: string;
    createdAt: string;
    chiefComplaint: string | null;
    diagnosis: string | null;
    doctor: { name: string } | null;
    queue: { status: string; tokenNumber: number } | null;
  }>;
  documents: Array<{ id: string; fileName: string; docType: string; createdAt: string }>;
  labOrders: LabOrder[];
  followUps: FollowUp[];
  alerts: ClinicalAlert[];
};

export function PatientPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const chartQuery = useQuery({ queryKey: ['patient', id], queryFn: () => api<Chart>(`/api/patients/${id}`) });
  const [editing, setEditing] = useState(false);
  const [link, setLink] = useState('');
  const chart = chartQuery.data;

  if (chartQuery.isError) return <Banner>{chartQuery.error.message}</Banner>;
  if (!chart) return <p className="text-sm text-slate-500">Loading the chart…</p>;
  const { patient } = chart;
  const canEdit = user && user.role !== 'LAB';

  return (
    <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-[320px_1fr]">
      <Card className="p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{patient.patientCode}</div>
        <h2 className="font-serif text-3xl leading-tight">{patient.fullName}</h2>
        <p className="text-sm text-slate-500">{patientLine(patient)} · {formatMobile(patient.mobile)}</p>
        {patient.allergies && <p className="mt-3 text-sm text-rose-800">Allergies: {patient.allergies}</p>}
        {patient.medicalHistory && <p className="mt-2 text-sm">{patient.medicalHistory}</p>}
        {patient.address && <p className="mt-2 text-sm text-slate-600">{patient.address}</p>}
        <p className="mt-3 text-xs text-slate-500">
          WhatsApp {patient.consentWhatsapp ? 'allowed' : 'not consented'} · SMS {patient.consentSms ? 'allowed' : 'not consented'}
        </p>
        {canEdit && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setEditing((value) => !value)}>
              {editing ? 'Close editor' : 'Edit details'}
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const created = await api<{ url: string }>(`/api/patients/${patient.id}/share-links`, {
                  method: 'POST',
                  body: JSON.stringify({ days: 7 }),
                });
                setLink(created.url);
              }}
            >
              Patient link
            </Button>
          </div>
        )}
        {link && <p className="mt-3 break-all text-xs text-slate-600">Share this expiring link: {link}</p>}
        {editing && (
          <div className="mt-4">
            <PatientForm
              patientId={patient.id}
              initial={{
                fullName: patient.fullName,
                mobile: patient.mobile,
                sex: patient.sex,
                dateOfBirth: patient.dateOfBirth?.slice(0, 10) ?? '',
                ageYears: patient.ageYears ? String(patient.ageYears) : '',
                address: patient.address ?? '',
                emergencyContactName: patient.emergencyContactName ?? '',
                emergencyContactPhone: patient.emergencyContactPhone ?? '',
                allergies: patient.allergies ?? '',
                medicalHistory: patient.medicalHistory ?? '',
                consentWhatsapp: Boolean(patient.consentWhatsapp),
                consentSms: Boolean(patient.consentSms),
              }}
              onSaved={(saved) => {
                queryClient.setQueryData<Chart>(['patient', id], (current) => (current ? { ...current, patient: saved } : current));
                setEditing(false);
              }}
            />
          </div>
        )}
      </Card>
      <div className="space-y-4">
        {chart.alerts.length > 0 && (
          <div className="space-y-2">
            {chart.alerts.map((alert) => (
              <Banner key={alert.id} tone={alert.severity === 'HIGH' ? 'error' : 'info'}>
                {alert.message}
              </Banner>
            ))}
          </div>
        )}
        <Card className="p-5">
          <h3 className="font-serif text-2xl">Visits</h3>
          <ul className="mt-3 divide-y divide-line">
            {chart.visits.map((visit) => (
              <li key={visit.id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">{formatWhen(visit.createdAt)}</div>
                    <div className="text-sm">{visit.chiefComplaint}</div>
                    {visit.diagnosis && <div className="text-sm text-slate-600">{visit.diagnosis}</div>}
                    <div className="text-xs text-slate-500">{visit.doctor?.name}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {visit.queue && <Badge value={visit.queue.status}>{statusLabel(visit.queue.status)}</Badge>}
                    <Link className="text-sm text-teal underline" to={`/consult/${visit.id}`}>
                      Open
                    </Link>
                  </div>
                </div>
              </li>
            ))}
            {chart.visits.length === 0 && <li className="py-3 text-sm text-slate-500">No visits yet.</li>}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-serif text-2xl">Laboratory</h3>
          <ul className="mt-3 space-y-3">
            {chart.labOrders.map((order) => (
              <li key={order.id}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{order.testName}</span>
                  <Badge value={order.status}>{statusLabel(order.status)}</Badge>
                </div>
                {order.reports.map((report) => (
                  <a key={report.id} className="mt-1 block text-sm text-teal underline" href={`/api/lab-reports/${report.id}/file`} target="_blank" rel="noreferrer">
                    {report.fileName} · {formatWhen(report.reportedAt)}
                  </a>
                ))}
              </li>
            ))}
            {chart.labOrders.length === 0 && <li className="text-sm text-slate-500">No laboratory orders.</li>}
          </ul>
        </Card>
        <Card className="p-5">
          <h3 className="font-serif text-2xl">Documents</h3>
          {canEdit && (
            <form
              className="mt-3 flex flex-wrap items-center gap-2"
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                await api(`/api/patients/${patient.id}/documents`, { method: 'POST', body: data });
                form.reset();
                await queryClient.invalidateQueries({ queryKey: ['patient', id] });
              }}
            >
              <select name="docType" className="rounded-lg border border-line bg-white px-3 py-2 text-sm">
                <option value="REFERRAL">Referral</option>
                <option value="OTHER">Other</option>
              </select>
              <input name="file" type="file" accept="application/pdf,image/png,image/jpeg,image/webp" required className="text-sm" />
              <Button>Upload</Button>
            </form>
          )}
          <ul className="mt-3 space-y-1 text-sm">
            {chart.documents.map((document) => (
              <li key={document.id}>
                <a className="text-teal underline" href={`/api/patients/documents/${document.id}/file`} target="_blank" rel="noreferrer">
                  {document.fileName}
                </a>
                <span className="text-slate-500"> · {document.docType} · {formatDay(document.createdAt)}</span>
              </li>
            ))}
            {chart.documents.length === 0 && <li className="text-slate-500">No documents uploaded.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
