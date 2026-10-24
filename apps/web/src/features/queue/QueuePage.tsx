import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { useAuth } from '@/features/auth/auth-context';
import { useServerQuery } from '@/hooks/use-server-query';
import { formatDay, formatMobile, patientLine, statusLabel, todayYmd, tokenLabel, vitalSummary, waitLabel } from '@/lib/format';
import type { Patient, QueueEntry } from '@/types';
import { PatientForm } from '@/components/forms/PatientForm';
import { Badge, Banner, Button, Card, Field, TextArea, TextInput } from '@/components/ui';

type VitalsForm = {
  systolic: string;
  diastolic: string;
  pulse: string;
  spo2: string;
  temperatureF: string;
  glucose: string;
  glucoseType: string;
  weightKg: string;
  heightCm: string;
  source: 'STAFF' | 'PATIENT';
};

const blankVitals: VitalsForm = {
  systolic: '',
  diastolic: '',
  pulse: '',
  spo2: '',
  temperatureF: '',
  glucose: '',
  glucoseType: '',
  weightKg: '',
  heightCm: '',
  source: 'STAFF',
};

export function QueuePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [visitDate, setVisitDate] = useState(todayYmd);
  const [datePinned, setDatePinned] = useState(false);
  const queueQuery = useServerQuery<{ entries: QueueEntry[]; date: string }>(['queue', visitDate], `/api/queue?date=${visitDate}`);
  const entries = queueQuery.data?.entries ?? [];
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Patient[]>([]);
  const [searched, setSearched] = useState('');
  const [selected, setSelected] = useState<Patient | null>(null);
  const [complaint, setComplaint] = useState('');
  const [vitals, setVitals] = useState<VitalsForm>(blankVitals);
  const [emergency, setEmergency] = useState(false);
  const [reason, setReason] = useState('');
  const [registering, setRegistering] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [action, setAction] = useState<{ id: string; kind: string } | null>(null);
  const [actionReason, setActionReason] = useState('');

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
      if (!datePinned) setVisitDate(todayYmd());
    }, 30000);
    return () => window.clearInterval(timer);
  }, [datePinned]);

  function chooseVisitDate(value: string) {
    const today = todayYmd();
    setVisitDate(value || today);
    setDatePinned(Boolean(value) && value !== today);
  }

  function useToday() {
    setVisitDate(todayYmd());
    setDatePinned(false);
  }

  useEffect(() => {
    if (queueQuery.error) setError(queueQuery.error.message);
  }, [queueQuery.error]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        setSearched('');
        return;
      }
      const current = query.trim();
      api<{ patients: Patient[] }>(`/api/patients?q=${encodeURIComponent(current)}`)
        .then((data) => {
          setResults(data.patients);
          setSearched(current);
        })
        .catch(() => {
          setResults([]);
          setSearched(current);
        });
    }, 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const open = entries.filter((entry) => !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status));
  const done = entries.filter((entry) => ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status));

  async function addToQueue() {
    if (!selected) return;
    setBusy(true);
    setError('');
    const number = (value: string) => (value.trim() === '' ? null : Number(value));
    try {
      await api('/api/queue', {
        method: 'POST',
        body: JSON.stringify({
          patientId: selected.id,
          chiefComplaint: complaint,
          visitDate,
          priority: emergency ? 'EMERGENCY' : 'NORMAL',
          priorityReason: emergency ? reason : null,
          vitals: {
            systolic: number(vitals.systolic),
            diastolic: number(vitals.diastolic),
            pulse: number(vitals.pulse),
            spo2: number(vitals.spo2),
            temperatureF: number(vitals.temperatureF),
            glucose: number(vitals.glucose),
            glucoseType: vitals.glucoseType || null,
            weightKg: number(vitals.weightKg),
            heightCm: number(vitals.heightCm),
            source: vitals.source,
          },
        }),
      });
      setSelected(null);
      setComplaint('');
      setVitals(blankVitals);
      setEmergency(false);
      setReason('');
      setQuery('');
      useToday();
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add the patient');
    } finally {
      setBusy(false);
    }
  }

  async function runAction() {
    if (!action || actionReason.trim().length < 3) return;
    setBusy(true);
    setError('');
    try {
      if (action.kind === 'up' || action.kind === 'down') {
        await api(`/api/queue/${action.id}/reorder`, {
          method: 'POST',
          body: JSON.stringify({ direction: action.kind, reason: actionReason }),
        });
      } else if (action.kind === 'emergency') {
        await api(`/api/queue/${action.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ priority: 'EMERGENCY', priorityReason: actionReason, reason: actionReason }),
        });
      } else {
        await api(`/api/queue/${action.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: action.kind, reason: actionReason }),
        });
      }
      setAction(null);
      setActionReason('');
      await queryClient.invalidateQueries({ queryKey: ['queue'] });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the queue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid items-start gap-5 xl:grid-cols-[420px_1fr]">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl">Desk</h2>
            <p className="text-sm text-slate-500">{datePinned ? formatDay(visitDate) : `Today, ${formatDay(todayYmd())}`}</p>
          </div>
          <Button variant="secondary" onClick={() => setRegistering((value) => !value)}>
            {registering ? 'Find patient' : 'New patient'}
          </Button>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Visit date">
            <TextInput type="date" value={visitDate} onChange={(event) => chooseVisitDate(event.target.value)} />
          </Field>
          <Button type="button" variant={datePinned ? 'secondary' : 'primary'} onClick={useToday}>
            Today
          </Button>
        </div>
        {registering ? (
          <div className="mt-4">
            <PatientForm
              initial={{ fullName: query, mobile: /^\d/.test(query) ? query : '' }}
              onSaved={(patient) => {
                setSelected(patient);
                setRegistering(false);
                setQuery('');
              }}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <TextInput
              autoFocus
              placeholder="Name, mobile, or patient ID"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelected(null);
              }}
            />
            {!selected && results.length > 0 && (
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
                {results.map((patient) => (
                  <li key={patient.id}>
                    <button className="block w-full px-3 py-2 text-left hover:bg-teal-soft" onClick={() => setSelected(patient)}>
                      <div className="font-medium">{patient.fullName}</div>
                      <div className="text-xs text-slate-500">
                        {patient.patientCode} · {formatMobile(patient.mobile)} · {patientLine(patient)}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!selected && searched === query.trim() && query.trim().length >= 2 && results.length === 0 && (
              <p className="text-sm text-slate-500">No matching record. Register a new patient instead of guessing.</p>
            )}
            {selected && (
              <div className="space-y-3">
                <div className="rounded-xl bg-teal-soft px-3 py-2">
                  <div className="font-medium">{selected.fullName}</div>
                  <div className="text-xs text-teal-dark">
                    {selected.patientCode} · {formatMobile(selected.mobile)} · {patientLine(selected)}
                  </div>
                  {selected.allergies && <div className="mt-1 text-xs text-rose-800">Allergies: {selected.allergies}</div>}
                  <Link className="mt-1 inline-block text-xs underline" to={`/patients/${selected.id}`}>
                    Open profile
                  </Link>
                </div>
                <Field label="Reason for visit">
                  <TextArea value={complaint} onChange={(event) => setComplaint(event.target.value)} placeholder="Headache since morning" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="BP systolic">
                    <TextInput inputMode="numeric" value={vitals.systolic} onChange={(event) => setVitals((current) => ({ ...current, systolic: event.target.value }))} />
                  </Field>
                  <Field label="BP diastolic">
                    <TextInput inputMode="numeric" value={vitals.diastolic} onChange={(event) => setVitals((current) => ({ ...current, diastolic: event.target.value }))} />
                  </Field>
                  <Field label="Pulse">
                    <TextInput inputMode="numeric" value={vitals.pulse} onChange={(event) => setVitals((current) => ({ ...current, pulse: event.target.value }))} />
                  </Field>
                  <Field label="Temp °F">
                    <TextInput inputMode="decimal" value={vitals.temperatureF} onChange={(event) => setVitals((current) => ({ ...current, temperatureF: event.target.value }))} />
                  </Field>
                </div>
                <details className="rounded-xl border border-line bg-white px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">More readings</summary>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Field label="SpO₂ %">
                      <TextInput inputMode="decimal" value={vitals.spo2} onChange={(event) => setVitals((current) => ({ ...current, spo2: event.target.value }))} />
                    </Field>
                    <Field label="Glucose mg/dL">
                      <TextInput inputMode="decimal" value={vitals.glucose} onChange={(event) => setVitals((current) => ({ ...current, glucose: event.target.value }))} />
                    </Field>
                    <Field label="Weight kg">
                      <TextInput inputMode="decimal" value={vitals.weightKg} onChange={(event) => setVitals((current) => ({ ...current, weightKg: event.target.value }))} />
                    </Field>
                    <Field label="Height cm">
                      <TextInput inputMode="decimal" value={vitals.heightCm} onChange={(event) => setVitals((current) => ({ ...current, heightCm: event.target.value }))} />
                    </Field>
                  </div>
                  <label className="mt-3 flex items-center gap-2">
                    <input type="checkbox" checked={vitals.source === 'PATIENT'} onChange={(event) => setVitals((current) => ({ ...current, source: event.target.checked ? 'PATIENT' : 'STAFF' }))} />
                    Patient reported these readings
                  </label>
                </details>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={emergency} onChange={(event) => setEmergency(event.target.checked)} />
                  Emergency priority
                </label>
                {emergency && (
                  <Field label="Why this is an emergency">
                    <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
                  </Field>
                )}
                <div className="flex gap-2">
                  <Button disabled={busy || complaint.trim().length < 3} onClick={() => void addToQueue()}>
                    {datePinned ? 'Add for this date' : 'Add for today'}
                  </Button>
                  <Button variant="ghost" onClick={() => setSelected(null)}>
                    Clear
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && <div className="mt-3"><Banner>{error}</Banner></div>}
      </Card>

      <div className="space-y-3">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="font-serif text-2xl">{datePinned ? 'Selected day' : 'Today’s list'}</h2>
            <p className="text-sm text-slate-500">{formatDay(visitDate)}</p>
          </div>
          {user?.role === 'DOCTOR' && (
            <Button
              onClick={async () => {
                setError('');
                try {
                  const result = await api<{ entry: QueueEntry }>('/api/queue/call-next', { method: 'POST' });
                  navigate(`/consult/${result.entry.visit.id}`);
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'No patient to call');
                }
              }}
            >
              Call next
            </Button>
          )}
        </div>
        {open.length === 0 && <Card className="p-6 text-sm text-slate-500">No one is waiting. The next registration will appear here for the doctor without a refresh.</Card>}
        {open.map((entry) => (
          <QueueRow
            key={entry.id}
            entry={entry}
            now={now}
            canManage={user?.role !== 'LAB'}
            isDoctor={user?.role === 'DOCTOR'}
            onAction={(kind) => {
              setAction({ id: entry.id, kind });
              setActionReason('');
            }}
          />
        ))}
        {done.length > 0 && <h3 className="pt-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Closed today</h3>}
        {done.map((entry) => (
          <QueueRow key={entry.id} entry={entry} now={now} canManage={false} isDoctor={user?.role === 'DOCTOR'} onAction={() => undefined} />
        ))}
        {action && (
          <Card className="p-4">
            <Field label="Reason for this queue change">
              <TextInput value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="At least a few words" />
            </Field>
            <div className="mt-3 flex gap-2">
              <Button disabled={busy || actionReason.trim().length < 3} onClick={() => void runAction()}>
                Confirm {statusLabel(action.kind)}
              </Button>
              <Button variant="ghost" onClick={() => setAction(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

function QueueActions({ entry, onAction }: { entry: QueueEntry; onAction: (kind: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Change
      </Button>
    );
  }
  return (
    <>
      <Button variant="secondary" onClick={() => onAction('up')}>Up</Button>
      <Button variant="secondary" onClick={() => onAction('down')}>Down</Button>
      {entry.priority !== 'EMERGENCY' && (
        <Button variant="danger" onClick={() => onAction('emergency')}>Emergency</Button>
      )}
      <Button variant="ghost" onClick={() => onAction('NO_SHOW')}>No-show</Button>
      <Button variant="ghost" onClick={() => onAction('CANCELLED')}>Cancel</Button>
      {entry.status !== 'WAITING' && (
        <Button variant="ghost" onClick={() => onAction('WAITING')}>Return</Button>
      )}
    </>
  );
}

function QueueRow({
  entry,
  now,
  canManage,
  isDoctor,
  onAction,
}: {
  entry: QueueEntry;
  now: number;
  canManage: boolean;
  isDoctor: boolean;
  onAction: (kind: string) => void;
}) {
  const active = !['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(entry.status);
  return (
    <Card className={`p-4 ${entry.priority === 'EMERGENCY' ? 'border-rose-300' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-[#13242b] font-serif text-lg text-white">{tokenLabel(entry.tokenNumber)}</div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link className="font-medium hover:underline" to={isDoctor ? `/consult/${entry.visit.id}` : `/patients/${entry.visit.patient.id}`}>
                {entry.visit.patient.fullName}
              </Link>
              <Badge value={entry.status}>{statusLabel(entry.status)}</Badge>
              {entry.priority === 'EMERGENCY' && <Badge value="EMERGENCY">Emergency</Badge>}
            </div>
            <div className="text-xs text-slate-500">
              {entry.visit.patient.patientCode} · {patientLine(entry.visit.patient)} · {formatMobile(entry.visit.patient.mobile)}
            </div>
            <div className="mt-1 text-sm">{entry.visit.chiefComplaint}</div>
            <div className="text-xs text-slate-500">
              {vitalSummary(entry.visit.vitals[0])} · waiting {waitLabel(entry.visit.createdAt, now)}
              {entry.visit.doctor ? ` · ${entry.visit.doctor.name}` : ''}
            </div>
            {entry.priorityReason && <div className="text-xs text-rose-800">{entry.priorityReason}</div>}
          </div>
        </div>
        {active && (
          <div className="flex flex-wrap gap-2">
            {isDoctor && (
              <Link to={`/consult/${entry.visit.id}`}>
                <Button>Open chart</Button>
              </Link>
            )}
            {canManage && <QueueActions entry={entry} onAction={onAction} />}
          </div>
        )}
      </div>
    </Card>
  );
}
