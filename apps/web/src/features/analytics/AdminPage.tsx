import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from '@/services/api';
import { useAuth } from '@/features/auth/auth-context';
import { formatWhen } from '@/lib/format';
import { Banner, Button, Card, Field, Select, TextInput } from '@/components/ui';

type Analytics = {
  visits: { today: number; week: number; month: number };
  patients: { newToday: number; returningToday: number };
  queue: { completed: number; noShow: number; cancelled: number; averageWaitMinutes: number | null };
  pendingReports: number;
  overdueFollowUps: number;
  notifications: { tracked: boolean; note: string };
};

type Staff = {
  id: string;
  name: string;
  email: string;
  role: string;
  specialty: string | null;
  isActive: boolean;
};

type Rule = {
  id: string;
  metric: string;
  operator: string;
  threshold: number;
  severity: 'INFO' | 'MEDIUM' | 'HIGH';
  label: string;
  isActive: boolean;
};

type Audit = { id: string; action: string; entityType: string; createdAt: string; userId: string | null };

export function AdminPage() {
  const { user, clinic, refresh } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const analyticsQuery = useQuery({ queryKey: ['analytics'], queryFn: () => api<Analytics>('/api/analytics') });
  const rulesQuery = useQuery({ queryKey: ['alert-rules'], queryFn: () => api<{ rules: Rule[] }>('/api/alert-rules') });
  const staffQuery = useQuery({ queryKey: ['users'], queryFn: () => api<{ users: Staff[] }>('/api/users'), enabled: isAdmin });
  const logsQuery = useQuery({ queryKey: ['audit'], queryFn: () => api<{ logs: Audit[] }>('/api/audit'), enabled: isAdmin });
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ notifications: Array<{ id: string; channel: string; status: string; template: string; createdAt: string; error: string | null; patient: { fullName: string } | null }> }>('/api/notifications'),
  });
  const analytics = analyticsQuery.data ?? null;
  const logs = logsQuery.data?.logs ?? [];
  const [staff, setStaff] = useState<Staff[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState('');
  const [clinicForm, setClinicForm] = useState({ name: '', address: '', phone: '', email: '', registrationNo: '' });
  const [account, setAccount] = useState({ name: '', email: '', password: 'Clinic#2026', role: 'RECEPTIONIST', specialty: '' });

  useEffect(() => {
    if (clinic) {
      setClinicForm({
        name: clinic.name ?? '',
        address: clinic.address ?? '',
        phone: clinic.phone ?? '',
        email: clinic.email ?? '',
        registrationNo: clinic.registrationNo ?? '',
      });
    }
  }, [clinic]);

  useEffect(() => {
    if (rulesQuery.data) setRules(rulesQuery.data.rules);
  }, [rulesQuery.data]);

  useEffect(() => {
    if (staffQuery.data) setStaff(staffQuery.data.users);
  }, [staffQuery.data]);

  useEffect(() => {
    if (analyticsQuery.error) setError(analyticsQuery.error.message);
  }, [analyticsQuery.error]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {error && <Banner>{error}</Banner>}
      {analytics && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Visits today', analytics.visits.today],
            ['This week', analytics.visits.week],
            ['This month', analytics.visits.month],
            ['New / returning', `${analytics.patients.newToday} / ${analytics.patients.returningToday}`],
            ['Completed', analytics.queue.completed],
            ['No-show', analytics.queue.noShow],
            ['Avg wait', analytics.queue.averageWaitMinutes == null ? '—' : `${analytics.queue.averageWaitMinutes} min`],
            ['Unreviewed reports', analytics.pendingReports],
          ].map(([label, value]) => (
            <Card key={String(label)} className="px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
              <div className="font-serif text-3xl">{value}</div>
            </Card>
          ))}
        </div>
      )}
      {analytics && <p className="text-sm text-slate-500">{analytics.notifications.note} Overdue follow-ups: {analytics.overdueFollowUps}.</p>}
      <Card className="p-5">
        <h2 className="font-serif text-2xl">Reminders</h2>
        <ul className="mt-3 space-y-2 text-sm">
          {(notificationsQuery.data?.notifications ?? []).length === 0 && <li className="text-slate-500">No reminders have been processed yet.</li>}
          {notificationsQuery.data?.notifications.map((item) => (
            <li key={item.id} className="flex flex-wrap justify-between gap-2">
              <span>{item.patient?.fullName ?? 'Patient'} · {item.channel} · {item.template}</span>
              <span className="text-slate-500">{item.status}{item.error ? ` · ${item.error}` : ''}</span>
            </li>
          ))}
        </ul>
      </Card>
      {isAdmin && (
        <a className="inline-block text-sm text-teal underline" href="/api/analytics/export.csv">
          Download today’s queue CSV
        </a>
      )}

      {isAdmin && (
        <Card className="p-5">
          <h2 className="font-serif text-2xl">Clinic</h2>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              await api('/api/clinic', { method: 'PATCH', body: JSON.stringify(clinicForm) });
              await refresh();
            }}
          >
            <Field label="Name"><TextInput value={clinicForm.name} onChange={(event) => setClinicForm({ ...clinicForm, name: event.target.value })} /></Field>
            <Field label="Phone"><TextInput value={clinicForm.phone} onChange={(event) => setClinicForm({ ...clinicForm, phone: event.target.value })} /></Field>
            <Field label="Address"><TextInput value={clinicForm.address} onChange={(event) => setClinicForm({ ...clinicForm, address: event.target.value })} /></Field>
            <Field label="Email"><TextInput value={clinicForm.email} onChange={(event) => setClinicForm({ ...clinicForm, email: event.target.value })} /></Field>
            <Field label="Registration"><TextInput value={clinicForm.registrationNo} onChange={(event) => setClinicForm({ ...clinicForm, registrationNo: event.target.value })} /></Field>
            <div className="flex items-end"><Button>Save clinic</Button></div>
          </form>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="font-serif text-2xl">Measurement alerts</h2>
        <p className="text-sm text-slate-500">These flags mark a value outside the clinic’s range. They are not a diagnosis.</p>
        <ul className="mt-3 space-y-2">
          {rules.filter((rule) => rule.isActive).map((rule) => (
            <li key={rule.id} className="grid items-center gap-2 rounded-xl border border-line bg-white p-3 sm:grid-cols-[1fr_90px_110px_90px]">
              <span className="text-sm">{rule.label}</span>
              <span className="text-xs uppercase text-slate-500">{rule.operator}</span>
              <TextInput
                type="number"
                value={rule.threshold}
                onChange={(event) => setRules(rules.map((item) => (item.id === rule.id ? { ...item, threshold: Number(event.target.value) } : item)))}
              />
              <span className="text-xs">{rule.severity}</span>
            </li>
          ))}
        </ul>
        <Button
          className="mt-3"
          variant="secondary"
          onClick={async () => {
            const saved = await api<{ rules: Rule[] }>('/api/alert-rules', { method: 'PUT', body: JSON.stringify({ rules }) });
            setRules(saved.rules);
          }}
        >
          Save alert rules
        </Button>
      </Card>

      {isAdmin && (
        <Card className="p-5">
          <h2 className="font-serif text-2xl">Staff</h2>
          <form
            className="mt-3 grid gap-3 sm:grid-cols-2"
            onSubmit={async (event) => {
              event.preventDefault();
              await api('/api/users', { method: 'POST', body: JSON.stringify(account) });
              const fresh = await api<{ users: Staff[] }>('/api/users');
              setStaff(fresh.users);
              setAccount({ ...account, name: '', email: '' });
            }}
          >
            <Field label="Name"><TextInput value={account.name} onChange={(event) => setAccount({ ...account, name: event.target.value })} required /></Field>
            <Field label="Email"><TextInput type="email" value={account.email} onChange={(event) => setAccount({ ...account, email: event.target.value })} required /></Field>
            <Field label="Temporary password"><TextInput value={account.password} onChange={(event) => setAccount({ ...account, password: event.target.value })} required /></Field>
            <Field label="Role">
              <Select value={account.role} onChange={(event) => setAccount({ ...account, role: event.target.value })}>
                <option value="RECEPTIONIST">Receptionist</option>
                <option value="DOCTOR">Doctor</option>
                <option value="LAB">Laboratory</option>
                <option value="ADMIN">Administrator</option>
              </Select>
            </Field>
            <Field label="Specialty"><TextInput value={account.specialty} onChange={(event) => setAccount({ ...account, specialty: event.target.value })} /></Field>
            <div className="flex items-end"><Button>Add staff</Button></div>
          </form>
          <ul className="mt-4 divide-y divide-line">
            {staff.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span>
                  <span className="font-medium">{member.name}</span>
                  <span className="text-slate-500"> · {member.role.toLowerCase()} · {member.email} {member.isActive ? '' : '· inactive'}</span>
                </span>
                {member.id !== user?.id && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      await api(`/api/users/${member.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !member.isActive }) });
                      const fresh = await api<{ users: Staff[] }>('/api/users');
                      setStaff(fresh.users);
                    }}
                  >
                    {member.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isAdmin && (
        <Card className="p-5">
          <h2 className="font-serif text-2xl">Audit</h2>
          <ul className="mt-3 max-h-80 space-y-1 overflow-auto text-sm">
            {logs.map((log) => (
              <li key={log.id} className="flex justify-between gap-3 border-b border-line py-1">
                <span>{log.action} · {log.entityType}</span>
                <span className="text-slate-500">{formatWhen(log.createdAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
