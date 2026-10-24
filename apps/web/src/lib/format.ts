import type { Patient, Vital } from '../types';

const sexLabel: Record<string, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
  UNDISCLOSED: 'Undisclosed',
};

export function ageOf(patient: { dateOfBirth?: string | null; ageYears?: number | null }) {
  if (patient.dateOfBirth) {
    const dob = new Date(patient.dateOfBirth);
    const now = new Date();
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const month = now.getUTCMonth() - dob.getUTCMonth();
    if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
    return age;
  }
  return patient.ageYears ?? null;
}

export function patientLine(patient: Pick<Patient, 'sex' | 'dateOfBirth' | 'ageYears'>) {
  const age = ageOf(patient);
  return [age != null ? `${age} yrs` : null, sexLabel[patient.sex] ?? patient.sex].filter(Boolean).join(' · ');
}

export function formatMobile(mobile?: string | null) {
  if (!mobile) return '';
  const digits = mobile.replace(/\D/g, '').slice(-10);
  if (digits.length !== 10) return mobile;
  return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
}

export function formatWhen(iso?: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDay(iso?: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

export function ymd(iso?: string | null) {
  if (!iso) return '';
  return iso.slice(0, 10);
}

export function todayYmd(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function celsiusToFahrenheit(value?: number | null) {
  if (value == null) return null;
  return Math.round(((value * 9) / 5 + 32) * 10) / 10;
}

export function waitLabel(iso: string, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function tokenLabel(token: number) {
  return `#${String(token).padStart(2, '0')}`;
}

export function vitalSummary(vital?: Vital | null) {
  if (!vital) return 'No vitals yet';
  const parts: string[] = [];
  if (vital.systolic && vital.diastolic) parts.push(`${vital.systolic}/${vital.diastolic}`);
  if (vital.pulse) parts.push(`${vital.pulse} bpm`);
  if (vital.spo2) parts.push(`SpO₂ ${vital.spo2}%`);
  const temp = celsiusToFahrenheit(vital.temperatureC);
  if (temp) parts.push(`${temp}°F`);
  if (vital.glucose) parts.push(`${vital.glucose} mg/dL`);
  return parts.join(' · ') || 'Vitals recorded';
}

export function statusLabel(status: string) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}
