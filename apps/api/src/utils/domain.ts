export const CLINIC_TIMEZONE = 'Asia/Kolkata';

const METRIC_UNITS: Record<string, string> = {
  systolic: 'mmHg',
  diastolic: 'mmHg',
  spo2: '%',
  temperatureC: '°C',
  glucose: 'mg/dL',
  pulse: 'bpm',
};

export type AlertOperator = 'gte' | 'gt' | 'lte' | 'lt';

export type VitalReading = {
  systolic?: number | null;
  diastolic?: number | null;
  glucose?: number | null;
  temperatureC?: number | null;
  spo2?: number | null;
  pulse?: number | null;
};

export type AlertRuleInput = {
  id: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: 'INFO' | 'MEDIUM' | 'HIGH';
  label: string;
  isActive: boolean;
};

export function clinicToday(timeZone = CLINIC_TIMEZONE, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('Could not resolve the clinic date');
  return `${year}-${month}-${day}`;
}

export function dateFromYmd(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function zonedStart(ymd: string, timeZone = CLINIC_TIMEZONE) {
  if (timeZone === 'Asia/Kolkata') return new Date(`${ymd}T00:00:00+05:30`);
  return new Date(`${ymd}T00:00:00.000Z`);
}

export function addDays(ymd: string, days: number) {
  const date = dateFromYmd(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeMobile(input: string) {
  const digits = input.replace(/\D/g, '');
  const ten = digits.length > 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(ten)) {
    return null;
  }
  return ten;
}

export function formatMobile(mobile: string) {
  return `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}`;
}

export function bmi(weightKg?: number | null, heightCm?: number | null) {
  if (!weightKg || !heightCm) return null;
  const meters = heightCm / 100;
  if (meters <= 0) return null;
  return Math.round((weightKg / (meters * meters)) * 10) / 10;
}

export function fahrenheitToCelsius(value: number) {
  return Math.round((((value - 32) * 5) / 9) * 10) / 10;
}

export function celsiusToFahrenheit(value: number) {
  return Math.round(((value * 9) / 5 + 32) * 10) / 10;
}

export function ageFromDob(dob: Date, now = new Date()) {
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const month = now.getUTCMonth() - dob.getUTCMonth();
  if (month < 0 || (month === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

export function metricUnit(metric: string) {
  return METRIC_UNITS[metric] ?? '';
}

export function evaluateAlerts(rules: AlertRuleInput[], vital: VitalReading) {
  const hits: Array<{ rule: AlertRuleInput; value: number; units: string }> = [];
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const raw = vital[rule.metric as keyof VitalReading];
    if (raw == null || Number.isNaN(raw)) continue;
    const hit =
      (rule.operator === 'gte' && raw >= rule.threshold) ||
      (rule.operator === 'gt' && raw > rule.threshold) ||
      (rule.operator === 'lte' && raw <= rule.threshold) ||
      (rule.operator === 'lt' && raw < rule.threshold);
    if (hit) {
      hits.push({ rule, value: raw, units: metricUnit(rule.metric) });
    }
  }
  return hits;
}

export function alertMessage(label: string, value: number, units: string) {
  const unitText = units ? ` ${units}` : '';
  return `${label}: ${value}${unitText}. This measurement is outside the clinic's configured range. It is not a diagnosis.`;
}

export const DEFAULT_ALERT_RULES: Array<Omit<AlertRuleInput, 'id' | 'isActive'> & { isActive?: boolean }> = [
  { metric: 'systolic', operator: 'gte', threshold: 180, severity: 'HIGH', label: 'Systolic blood pressure' },
  { metric: 'diastolic', operator: 'gte', threshold: 120, severity: 'HIGH', label: 'Diastolic blood pressure' },
  { metric: 'spo2', operator: 'lt', threshold: 92, severity: 'HIGH', label: 'Oxygen saturation' },
  { metric: 'temperatureC', operator: 'gte', threshold: 39.4, severity: 'HIGH', label: 'Temperature' },
  { metric: 'glucose', operator: 'gte', threshold: 300, severity: 'HIGH', label: 'Blood glucose' },
  { metric: 'glucose', operator: 'lt', threshold: 54, severity: 'HIGH', label: 'Blood glucose' },
  { metric: 'pulse', operator: 'gte', threshold: 130, severity: 'MEDIUM', label: 'Pulse' },
  { metric: 'pulse', operator: 'lte', threshold: 45, severity: 'MEDIUM', label: 'Pulse' },
];

export const ALERT_METRICS = ['systolic', 'diastolic', 'spo2', 'temperatureC', 'glucose', 'pulse'] as const;

export function vitalError(vital: {
  systolic?: number | null;
  diastolic?: number | null;
}) {
  const hasSystolic = vital.systolic != null;
  const hasDiastolic = vital.diastolic != null;
  if (hasSystolic !== hasDiastolic) return 'Enter both systolic and diastolic blood pressure';
  if (hasSystolic && hasDiastolic && (vital.systolic as number) <= (vital.diastolic as number)) {
    return 'Systolic pressure should be higher than diastolic';
  }
  return null;
}

export function sortQueue<T extends { priority: 'EMERGENCY' | 'NORMAL'; position: number }>(entries: T[]) {
  return [...entries].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'EMERGENCY' ? -1 : 1;
    return a.position - b.position;
  });
}
