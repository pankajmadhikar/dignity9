import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { Banner, Button, Field, Select, TextArea, TextInput } from '@/components/ui';
import { formatMobile, patientLine } from '@/lib/format';
import { ApiError, api } from '@/services/api';
import type { Patient, Sex } from '@/types';

const schema = z.object({
  fullName: z.string().trim().min(2, 'Enter the patient name').max(120),
  mobile: z.string().trim().min(8, 'Enter a valid mobile number'),
  sex: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']),
  dateOfBirth: z.string(),
  ageYears: z.string(),
  address: z.string(),
  emergencyContactName: z.string(),
  emergencyContactPhone: z.string(),
  allergies: z.string(),
  medicalHistory: z.string(),
  consentWhatsapp: z.boolean(),
  consentSms: z.boolean(),
});

type FormValues = z.infer<typeof schema>;
type Duplicate = Pick<Patient, 'id' | 'patientCode' | 'fullName' | 'mobile' | 'sex' | 'dateOfBirth' | 'ageYears'>;

const empty: FormValues = {
  fullName: '',
  mobile: '',
  sex: 'UNDISCLOSED',
  dateOfBirth: '',
  ageYears: '',
  address: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  allergies: '',
  medicalHistory: '',
  consentWhatsapp: false,
  consentSms: false,
};

export function PatientForm({
  initial,
  patientId,
  onSaved,
}: {
  initial?: Partial<FormValues>;
  patientId?: string;
  onSaved: (patient: Patient) => void;
}) {
  const [error, setError] = useState('');
  const [duplicates, setDuplicates] = useState<Duplicate[] | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { ...empty, ...initial },
  });
  const dateOfBirth = form.watch('dateOfBirth');

  async function save(values: FormValues, confirmDuplicate: boolean) {
    setError('');
    const payload = {
      ...values,
      dateOfBirth: values.dateOfBirth || null,
      ageYears: values.dateOfBirth ? null : values.ageYears ? Number(values.ageYears) : null,
      address: values.address || null,
      emergencyContactName: values.emergencyContactName || null,
      emergencyContactPhone: values.emergencyContactPhone || null,
      allergies: values.allergies || null,
      medicalHistory: values.medicalHistory || null,
      confirmDuplicate,
    };
    try {
      const path = patientId ? `/api/patients/${patientId}` : '/api/patients';
      const result = await api<{ patient: Patient }>(path, {
        method: patientId ? 'PATCH' : 'POST',
        body: JSON.stringify(payload),
      });
      setDuplicates(null);
      onSaved(result.patient);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const details = err.details as { duplicates?: Duplicate[] } | undefined;
        setDuplicates(details?.duplicates ?? []);
      } else {
        setError(err instanceof Error ? err.message : 'Could not save the patient');
      }
    }
  }

  return (
    <form className="space-y-4" onSubmit={form.handleSubmit((values) => save(values, false))}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name">
          <TextInput {...form.register('fullName')} />
        </Field>
        <Field label="Mobile">
          <TextInput inputMode="tel" {...form.register('mobile')} />
        </Field>
        <Field label="Sex">
          <Select {...form.register('sex')}>
            <option value="FEMALE">Female</option>
            <option value="MALE">Male</option>
            <option value="OTHER">Other</option>
            <option value="UNDISCLOSED">Prefer not to say</option>
          </Select>
        </Field>
        <Field label="Date of birth">
          <TextInput type="date" {...form.register('dateOfBirth')} />
        </Field>
        {!dateOfBirth && (
          <Field label="Age, if date of birth is unknown">
            <TextInput inputMode="numeric" {...form.register('ageYears')} />
          </Field>
        )}
      </div>
      {form.formState.errors.fullName && <p className="text-sm text-rose-800">{form.formState.errors.fullName.message}</p>}
      {form.formState.errors.mobile && <p className="text-sm text-rose-800">{form.formState.errors.mobile.message}</p>}
      <details className="rounded-xl border border-line bg-white px-3 py-2">
        <summary className="cursor-pointer text-sm font-medium">Address and emergency contact</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Address">
            <TextInput {...form.register('address')} />
          </Field>
          <Field label="Emergency contact">
            <TextInput {...form.register('emergencyContactName')} />
          </Field>
          <Field label="Emergency phone">
            <TextInput {...form.register('emergencyContactPhone')} />
          </Field>
        </div>
      </details>
      <Field label="Allergies">
        <TextInput {...form.register('allergies')} placeholder="None recorded" />
      </Field>
      <Field label="Medical history, if provided">
        <TextArea {...form.register('medicalHistory')} />
      </Field>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" {...form.register('consentWhatsapp')} />
          WhatsApp consent
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" {...form.register('consentSms')} />
          SMS consent
        </label>
      </div>
      {duplicates && (
        <Banner>
          <p>A matching patient already exists. Open that profile, or confirm this is a different person.</p>
          <ul className="mt-2 space-y-1">
            {duplicates.map((patient) => (
              <li key={patient.id}>
                <Link className="font-medium underline" to={`/patients/${patient.id}`}>
                  {patient.fullName}
                </Link>{' '}
                <span className="text-rose-800/80">
                  {patient.patientCode} · {formatMobile(patient.mobile)} · {patientLine(patient)}
                </span>
              </li>
            ))}
          </ul>
          <Button className="mt-3" type="button" variant="danger" disabled={form.formState.isSubmitting} onClick={() => void save(form.getValues(), true)}>
            Create a separate record
          </Button>
        </Banner>
      )}
      {error && <Banner>{error}</Banner>}
      <Button disabled={form.formState.isSubmitting}>{patientId ? 'Save changes' : 'Create patient'}</Button>
    </form>
  );
}

export type { Sex };
