import { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Activity, ClipboardList, FlaskConical, LayoutDashboard, LogOut, Users } from 'lucide-react';
import { api } from '@/services/api';
import { useAuth } from '@/features/auth/auth-context';
import { useRealtime } from '@/features/queue/realtime';
import type { Role } from '@/types';
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, Modal, TextInput } from '@/components/ui';
import { formatDay, todayYmd } from '@/lib/format';

const links: Array<{ to: string; label: string; icon: typeof Users; roles: Role[] }> = [
  { to: '/doctor', label: 'Today', icon: LayoutDashboard, roles: ['DOCTOR'] },
  { to: '/queue', label: 'Queue', icon: Activity, roles: ['RECEPTIONIST', 'DOCTOR', 'ADMIN'] },
  { to: '/patients', label: 'Patients', icon: Users, roles: ['RECEPTIONIST', 'DOCTOR', 'ADMIN', 'LAB'] },
  { to: '/labs', label: 'Laboratory', icon: FlaskConical, roles: ['DOCTOR', 'LAB', 'ADMIN', 'RECEPTIONIST'] },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList, roles: ['DOCTOR', 'RECEPTIONIST', 'ADMIN'] },
  { to: '/admin', label: 'Clinic', icon: LayoutDashboard, roles: ['ADMIN', 'DOCTOR'] },
];

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, clinic, logout } = useAuth();
  const { connected, online } = useRealtime();
  const location = useLocation();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const visible = links.filter((link) => user && link.roles.includes(user.role));
  const title = location.pathname.startsWith('/consult')
    ? 'Consultation'
    : location.pathname.startsWith('/patients/')
      ? 'Patient'
      : visible.find((link) => location.pathname.startsWith(link.to))?.label ?? 'Dignity';

  return (
    <div className="min-h-screen bg-paper text-ink">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-[#13242b] text-white md:flex">
        <div className="px-5 pb-4 pt-6">
          <div className="font-serif text-2xl tracking-tight">Dignity</div>
          <div className="mt-1 text-xs text-white/60">{clinic?.name ?? 'Clinic'}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {visible.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'}`
              }
            >
              {link.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 p-4 text-sm">
          <div className="font-medium">{user?.name}</div>
          <div className="text-xs uppercase tracking-wide text-white/50">{user?.role.toLowerCase()}</div>
          <DropdownMenu>
            <DropdownMenuTrigger className="mt-3 text-xs text-white/70 underline-offset-2 hover:underline">Account</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => setPasswordOpen(true)}>Change password</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void logout()}>
                <LogOut size={14} /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/90 px-4 py-3 backdrop-blur">
          <div>
            <div className="font-serif text-2xl leading-none">{title}</div>
            <div className="mt-1 text-xs text-slate-500">{formatDay(todayYmd())}{clinic?.name ? ` · ${clinic.name}` : ''}</div>
          </div>
          <div className={`rounded-full px-3 py-1 text-xs font-medium ${online && connected ? 'bg-teal-soft text-teal-dark' : 'bg-amber-100 text-amber-950'}`}>
            {online ? (connected ? 'Live queue' : 'Reconnecting') : 'Offline'}
          </div>
        </header>
        {!online && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950">
            The connection dropped. Open charts stay as you left them, and queue updates resume when the network returns.
          </div>
        )}
        <main className="px-4 py-5 pb-24 md:pb-8">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex gap-1 overflow-x-auto border-t border-line bg-card px-2 py-2 md:hidden">
        {visible.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              `shrink-0 rounded-lg px-3 py-2 text-xs font-medium ${isActive ? 'bg-teal text-white' : 'text-slate-600'}`
            }
          >
            {link.label}
          </NavLink>
        ))}
        <button className="shrink-0 rounded-lg px-3 py-2 text-xs text-slate-600" onClick={() => void logout()}>
          Sign out
        </button>
      </nav>
      {passwordOpen && <PasswordDialog onClose={() => setPasswordOpen(false)} />}
    </div>
  );
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Modal title="Change password" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          try {
            await api('/api/auth/password', { method: 'POST', body: JSON.stringify({ current, next }) });
            await logout();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not change the password');
            setBusy(false);
          }
        }}
      >
        <Field label="Current password">
          <TextInput type="password" value={current} onChange={(event) => setCurrent(event.target.value)} required />
        </Field>
        <Field label="New password">
          <TextInput type="password" value={next} minLength={8} onChange={(event) => setNext(event.target.value)} required />
        </Field>
        {error && <p className="text-sm text-rose-800">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy}>Update</Button>
        </div>
      </form>
    </Modal>
  );
}
