import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuth } from '@/features/auth/auth-context';
import { celsiusToFahrenheit, formatWhen, patientLine, todayYmd, vitalSummary, ymd } from '@/lib/format';
import type { ClinicalAlert, Consultation, LabOrder, Patient, Prescription, RxItem, Vital } from '@/types';
import { Badge, Banner, Button, Card, Field, TextArea, TextInput } from '@/components/ui';

type VisitPayload = {
  access: 'clinical' | 'operational' | 'laboratory';
  visit: {
    id: string;
    chiefComplaint: string | null;
    createdAt: string;
    patient: Patient;
    doctor: { id: string; name: string } | null;
    vitals: Vital[];
    queue: { id: string; status: string; tokenNumber: number } | null;
    consultation: Consultation | null;
    prescriptions: Prescription[];
    labOrders: LabOrder[];
    alerts: ClinicalAlert[];
  };
  history: Array<{
    id: string;
    createdAt: string;
    chiefComplaint: string | null;
    diagnosis: string | null;
    treatmentPlan: string | null;
    doctor: { name: string } | null;
    vitals: Vital | null;
    prescriptions: Prescription[];
  }>;
};

const emptyItem = (): RxItem => ({
  medicineName: '',
  strength: '',
  dosage: '',
  frequency: '',
  duration: '',
  route: '',
  quantity: '',
  formulation: '',
  instructions: '',
});

export function ConsultPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<VisitPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [correcting, setCorrecting] = useState(false);
  const [reason, setReason] = useState('');
  const [complaint, setComplaint] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [examination, setExamination] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpInstructions, setFollowUpInstructions] = useState('');
  const [prescriptionNotes, setPrescriptionNotes] = useState('');
  const [items, setItems] = useState<RxItem[]>([emptyItem()]);
  const [labTests, setLabTests] = useState<string[]>([]);
  const [testName, setTestName] = useState('');

  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        let payload = await api<VisitPayload>(`/api/visits/${id}`);
        const queue = payload.visit.queue;
        if (
          user?.role === 'DOCTOR' &&
          queue &&
          ['WAITING', 'REGISTERED', 'CALLED'].includes(queue.status)
        ) {
          try {
            await api(`/api/queue/${queue.id}/start`, { method: 'POST' });
            payload = await api<VisitPayload>(`/api/visits/${id}`);
          } catch (err) {
            if (!cancel) setError(err instanceof Error ? err.message : 'Could not start the consultation');
          }
        }
        if (cancel) return;
        apply(payload);
      } catch (err) {
        if (!cancel) setError(err instanceof Error ? err.message : 'Could not open the visit');
      }
    }
    void load();
    return () => {
      cancel = true;
    };
  }, [id, user?.role]);

  function apply(payload: VisitPayload) {
    const note = payload.visit.consultation;
    const rx = payload.visit.prescriptions[0];
    setData(payload);
    setComplaint(payload.visit.chiefComplaint ?? '');
    setSymptoms(note?.symptoms ?? '');
    setExamination(note?.examination ?? '');
    setDiagnosis(note?.diagnosis ?? '');
    setClinicalNotes(note?.clinicalNotes ?? '');
    setTreatmentPlan(note?.treatmentPlan ?? '');
    setFollowUpDate(note?.followUpDate ? ymd(note.followUpDate) : note?.status === 'FINALIZED' ? '' : todayYmd());
    setFollowUpInstructions(note?.followUpInstructions ?? '');
    setPrescriptionNotes(rx?.notes ?? '');
    setItems(rx?.items?.length ? rx.items : [emptyItem()]);
  }

  function body() {
    return {
      chiefComplaint: complaint,
      symptoms,
      examination,
      diagnosis,
      clinicalNotes,
      treatmentPlan,
      followUpDate: followUpDate || null,
      followUpInstructions,
      prescriptionNotes,
      items: items
        .filter((item) => item.medicineName.trim())
        .map((item) => ({
          medicineName: item.medicineName.trim(),
          strength: item.strength || null,
          dosage: item.dosage || null,
          frequency: item.frequency || null,
          duration: item.duration || null,
          route: item.route || null,
          quantity: item.quantity || null,
          formulation: item.formulation || null,
          instructions: item.instructions || null,
        })),
      labTests,
      reason: reason || null,
    };
  }

  async function save(finalize: boolean) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const saved = await api<{ prescriptions: Prescription[] }>(
        `/api/visits/${id}/${finalize ? 'finalize' : 'consultation'}`,
        { method: finalize ? 'POST' : 'PUT', body: JSON.stringify(body()) },
      );
      const fresh = await api<VisitPayload>(`/api/visits/${id}`);
      apply(fresh);
      setCorrecting(false);
      const approved = (saved.prescriptions ?? fresh.visit.prescriptions).find((item) => item.status === 'APPROVED');
      setNotice(finalize ? 'Record approved. You can print the prescription.' : 'Draft saved.');
      if (finalize && approved) setNotice(`Record approved. Prescription v${approved.version} is ready to print.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <p className="text-sm text-slate-500">Opening the chart…</p>;
  if (!data) return <Banner>{error}</Banner>;

  const clinical = data.access === 'clinical' && user?.role === 'DOCTOR';
  const locked = data.visit.consultation?.status === 'FINALIZED' && !correcting;
  const latestApproved = data.visit.prescriptions.find((item) => item.status === 'APPROVED');
  const patient = data.visit.patient;

  return (
    <div className="mx-auto grid max-w-6xl gap-5 xl:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{patient.patientCode}</div>
          <h2 className="font-serif text-3xl leading-tight">{patient.fullName}</h2>
          <p className="text-sm text-slate-500">{patientLine(patient)}</p>
          {patient.allergies && <p className="mt-2 text-sm text-rose-800">Allergies: {patient.allergies}</p>}
          {patient.medicalHistory && clinical && <p className="mt-2 text-sm">{patient.medicalHistory}</p>}
          <Link className="mt-2 inline-block text-sm text-teal underline" to={`/patients/${patient.id}`}>Full profile</Link>
        </Card>
        <Card className="p-4">
          <h3 className="font-serif text-xl">This visit</h3>
          <ul className="mt-2 space-y-2 text-sm">
            {data.visit.vitals.map((vital) => (
              <li key={vital.id}>
                <div>{vitalSummary(vital)}</div>
                <div className="text-xs text-slate-500">
                  {vital.source === 'PATIENT' ? 'Patient-reported' : 'Measured by staff'}
                  {vital.bmi ? ` · BMI ${vital.bmi}` : ''}
                  {celsiusToFahrenheit(vital.temperatureC) ? '' : ''}
                  {' · '}
                  {formatWhen(vital.recordedAt)}
                </div>
              </li>
            ))}
            {data.visit.vitals.length === 0 && <li className="text-slate-500">No vitals recorded.</li>}
          </ul>
        </Card>
        {data.visit.alerts.map((alert) => (
          <Banner key={alert.id} tone={alert.severity === 'HIGH' ? 'error' : 'info'}>
            {alert.message}
            {clinical && alert.state !== 'RESOLVED' && (
              <button
                className="ml-2 underline"
                onClick={async () => {
                  await api(`/api/alerts/${alert.id}/acknowledge`, { method: 'POST' });
                  const fresh = await api<VisitPayload>(`/api/visits/${id}`);
                  setData(fresh);
                }}
              >
                Acknowledge
              </button>
            )}
          </Banner>
        ))}
        <Card className="p-4">
          <h3 className="font-serif text-xl">Earlier visits</h3>
          <ul className="mt-2 space-y-3">
            {data.history.map((visit) => (
              <li key={visit.id} className="border-t border-line pt-3 text-sm first:border-0 first:pt-0">
                <div className="font-medium">{formatWhen(visit.createdAt)}</div>
                <div>{visit.chiefComplaint}</div>
                {visit.diagnosis && <div className="text-slate-600">{visit.diagnosis}</div>}
                {visit.vitals && <div className="text-xs text-slate-500">{vitalSummary(visit.vitals)}</div>}
                {visit.prescriptions[0]?.items?.map((item, index) => (
                  <div key={index} className="text-xs text-slate-600">
                    {item.medicineName} {item.strength} {item.frequency}
                  </div>
                ))}
              </li>
            ))}
            {data.history.length === 0 && <li className="text-sm text-slate-500">No earlier visits.</li>}
          </ul>
        </Card>
      </div>

      <Card className="p-5">
        {data.access !== 'clinical' ? (
          <div className="space-y-3 text-sm">
            <p>This visit is open for queue and vitals. Diagnosis, notes, and medicine details stay with the treating doctor.</p>
            <p className="text-slate-600">Complaint: {data.visit.chiefComplaint}</p>
            {latestApproved && user?.role !== 'LAB' && (
              <a href={`/api/prescriptions/${latestApproved.id}/pdf`} target="_blank" rel="noreferrer">
                <Button>Print approved prescription</Button>
              </a>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-serif text-3xl">Consultation</h2>
                <p className="text-sm text-slate-500">{formatWhen(data.visit.createdAt)} · {data.visit.doctor?.name ?? user?.name}</p>
              </div>
              {data.visit.consultation && <Badge value={data.visit.consultation.status}>{data.visit.consultation.status}</Badge>}
            </div>
            {notice && <Banner tone="info">{notice}</Banner>}
            {error && <Banner>{error}</Banner>}
            {locked && (
              <Banner tone="info">
                This record is finalized. Corrections keep the original and require a reason.
                <Button className="ml-3" variant="secondary" onClick={() => setCorrecting(true)}>Correct record</Button>
              </Banner>
            )}
            <Field label="Chief complaint">
              <TextInput value={complaint} disabled={locked || !clinical} onChange={(event) => setComplaint(event.target.value)} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Symptoms">
                <TextArea value={symptoms} disabled={locked || !clinical} onChange={(event) => setSymptoms(event.target.value)} />
              </Field>
              <Field label="Examination">
                <TextArea value={examination} disabled={locked || !clinical} onChange={(event) => setExamination(event.target.value)} />
              </Field>
            </div>
            <Field label="Diagnosis">
              <TextInput value={diagnosis} disabled={locked || !clinical} onChange={(event) => setDiagnosis(event.target.value)} />
            </Field>
            <Field label="Clinical notes">
              <TextArea value={clinicalNotes} disabled={locked || !clinical} onChange={(event) => setClinicalNotes(event.target.value)} />
            </Field>
            <Field label="Treatment plan">
              <TextArea value={treatmentPlan} disabled={locked || !clinical} onChange={(event) => setTreatmentPlan(event.target.value)} />
            </Field>

            <div>
              <div className="mb-2 font-serif text-2xl">Prescription</div>
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div key={index} className="rounded-xl border border-line bg-white p-3">
                    <div className="grid gap-2 md:grid-cols-5">
                      <TextInput placeholder="Medicine" value={item.medicineName} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'medicineName', event.target.value)} />
                      <TextInput placeholder="Strength" value={item.strength ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'strength', event.target.value)} />
                      <TextInput placeholder="Dose" value={item.dosage ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'dosage', event.target.value)} />
                      <TextInput placeholder="1-0-1" value={item.frequency ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'frequency', event.target.value)} />
                      <TextInput placeholder="Duration" value={item.duration ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'duration', event.target.value)} />
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-3">
                      <TextInput placeholder="Route" value={item.route ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'route', event.target.value)} />
                      <TextInput placeholder="Quantity" value={item.quantity ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'quantity', event.target.value)} />
                      <TextInput placeholder="Instructions" value={item.instructions ?? ''} disabled={locked || !clinical} onChange={(event) => updateItem(index, 'instructions', event.target.value)} />
                    </div>
                    {clinical && !locked && items.length > 1 && (
                      <button className="mt-2 text-xs text-rose-800" onClick={() => setItems(items.filter((_, itemIndex) => itemIndex !== index))}>
                        Remove medicine
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {clinical && !locked && (
                <Button className="mt-3" variant="secondary" onClick={() => setItems([...items, emptyItem()])}>
                  Add medicine
                </Button>
              )}
              <div className="mt-3">
                <Field label="Prescription instructions">
                  <TextArea value={prescriptionNotes} disabled={locked || !clinical} onChange={(event) => setPrescriptionNotes(event.target.value)} />
                </Field>
              </div>
            </div>

            <div>
              <div className="font-serif text-2xl">Tests and follow-up</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {labTests.map((test) => (
                  <button key={test} className="rounded-full bg-stone-200 px-3 py-1 text-xs" onClick={() => setLabTests(labTests.filter((item) => item !== test))} disabled={locked}>
                    {test} ×
                  </button>
                ))}
                {data.visit.labOrders.map((order) => (
                  <Badge key={order.id} value={order.status}>{order.testName}</Badge>
                ))}
              </div>
              {clinical && !locked && (
                <div className="mt-2 flex gap-2">
                  <TextInput placeholder="Fasting blood glucose" value={testName} onChange={(event) => setTestName(event.target.value)} />
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (testName.trim().length < 2) return;
                      setLabTests([...labTests, testName.trim()]);
                      setTestName('');
                    }}
                  >
                    Add test
                  </Button>
                </div>
              )}
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <Field label="Follow-up date">
                  <div className="flex gap-2">
                    <TextInput type="date" value={followUpDate} disabled={locked || !clinical} onChange={(event) => setFollowUpDate(event.target.value)} />
                    {clinical && !locked && (
                      <Button type="button" variant="secondary" onClick={() => setFollowUpDate(todayYmd())}>
                        Today
                      </Button>
                    )}
                  </div>
                </Field>
                <Field label="Follow-up instructions">
                  <TextInput value={followUpInstructions} disabled={locked || !clinical} onChange={(event) => setFollowUpInstructions(event.target.value)} />
                </Field>
              </div>
            </div>

            {correcting && (
              <Field label="Reason for the correction">
                <TextInput value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What was wrong, and what changed" />
              </Field>
            )}

            {clinical && (
              <div className="flex flex-wrap gap-2">
                {!locked && data.visit.consultation?.status !== 'FINALIZED' && (
                  <Button variant="secondary" disabled={busy} onClick={() => void save(false)}>Save draft</Button>
                )}
                {!locked && (
                  <Button disabled={busy || (correcting && reason.trim().length < 5)} onClick={() => void save(true)}>
                    {data.visit.consultation?.status === 'FINALIZED' ? 'Save correction' : 'Approve and complete'}
                  </Button>
                )}
                {latestApproved && (
                  <a href={`/api/prescriptions/${latestApproved.id}/pdf`} target="_blank" rel="noreferrer">
                    <Button variant="secondary">Print prescription</Button>
                  </a>
                )}
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );

  function updateItem(index: number, key: keyof RxItem, value: string) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, [key]: value } : item)));
  }
}
