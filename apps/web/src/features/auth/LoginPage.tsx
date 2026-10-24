import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router-dom';
import { z } from 'zod';
import { Banner, Button, Field, TextInput } from '@/components/ui';
import { useAuth } from '@/features/auth/auth-context';
import { api } from '@/services/api';

const schema = z.object({
  email: z.string().trim().email('Enter the staff email'),
  password: z.string().min(1, 'Enter the password'),
});

type LoginValues = z.infer<typeof schema>;

const pilots = [
  ['Reception', 'reception@dignity.test'],
  ['Doctor', 'doctor@dignity.test'],
  ['Lab', 'lab@dignity.test'],
  ['Admin', 'admin@dignity.test'],
];

export function LoginPage() {
  const { user, ready, refresh } = useAuth();
  const [error, setError] = useState('');
  const form = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: 'reception@dignity.test', password: 'Clinic#2026' },
  });

  if (ready && user) return <Navigate to="/" replace />;

  return (
    <div className="grid min-h-screen bg-paper md:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-[#13242b] px-12 py-12 text-white md:flex">
        <div className="font-serif text-4xl">Dignity</div>
        <div>
          <p className="max-w-md font-serif text-5xl leading-tight">The outpatient day, on one desk.</p>
          <p className="mt-4 max-w-sm text-sm leading-6 text-white/70">
            Register the patient, keep the queue in step with the doctor, and leave a prescription that can be printed and found again.
          </p>
        </div>
        <p className="text-xs text-white/40">Single clinic · Asia/Kolkata</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <form
          className="w-full max-w-sm"
          onSubmit={form.handleSubmit(async (values) => {
            setError('');
            try {
              await api('/api/auth/login', { method: 'POST', body: JSON.stringify(values) });
              await refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not sign in');
            }
          })}
        >
          <div className="font-serif text-4xl md:hidden">Dignity</div>
          <h1 className="mt-2 font-serif text-3xl">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">Use the staff account issued for this clinic.</p>
          <div className="mt-6 space-y-3">
            <Field label="Email">
              <TextInput type="email" autoComplete="username" {...form.register('email')} />
            </Field>
            {form.formState.errors.email && <p className="text-sm text-rose-800">{form.formState.errors.email.message}</p>}
            <Field label="Password">
              <TextInput type="password" autoComplete="current-password" {...form.register('password')} />
            </Field>
            {form.formState.errors.password && <p className="text-sm text-rose-800">{form.formState.errors.password.message}</p>}
            {error && <Banner>{error}</Banner>}
            <Button className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Signing in…' : 'Enter clinic'}
            </Button>
          </div>
          <div className="mt-8 rounded-2xl border border-line bg-card p-4 text-sm">
            <div className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Pilot accounts</div>
            <p className="mt-1 text-slate-500">Password for each: Clinic#2026</p>
            <ul className="mt-3 space-y-1">
              {pilots.map(([role, account]) => (
                <li key={account} className="flex justify-between gap-3">
                  <span>{role}</span>
                  <button type="button" className="text-teal underline-offset-2 hover:underline" onClick={() => form.setValue('email', account)}>
                    {account}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </form>
      </section>
    </div>
  );
}
