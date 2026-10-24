import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '@/services/api';
import { formatMobile, patientLine } from '@/lib/format';
import type { Patient } from '@/types';
import { PatientForm } from '@/components/forms/PatientForm';
import { Card, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TextInput } from '@/components/ui';

export function PatientsPage({ creating = false }: { creating?: boolean }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(handle);
  }, [query]);

  const directory = useQuery({
    queryKey: ['patients', debounced],
    enabled: !creating,
    queryFn: () => api<{ patients: Patient[] }>(debounced ? `/api/patients?q=${encodeURIComponent(debounced)}` : '/api/patients'),
  });
  const patients = directory.data?.patients ?? [];

  if (creating) {
    return (
      <Card className="mx-auto max-w-3xl p-5">
        <h2 className="font-serif text-3xl">Register a patient</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">Search from the queue first. Create a record only when no match exists.</p>
        <PatientForm onSaved={(patient) => navigate(`/patients/${patient.id}`)} />
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between gap-3">
        <TextInput placeholder="Search name, mobile, or ID" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Link className="shrink-0 rounded-lg bg-teal px-3 py-2 text-sm font-medium text-white" to="/patients/new">
          New patient
        </Link>
      </div>
      <Card>
        {patients.length === 0 && <p className="p-5 text-sm text-slate-500">No patients to show.</p>}
        {patients.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="border-t-0">
                <TableHead>Patient</TableHead>
                <TableHead>Details</TableHead>
                <TableHead>ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {patients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell>
                    <Link className="font-medium hover:underline" to={`/patients/${patient.id}`}>{patient.fullName}</Link>
                  </TableCell>
                  <TableCell className="text-slate-500">{patientLine(patient)} · {formatMobile(patient.mobile)}</TableCell>
                  <TableCell className="text-slate-500">{patient.patientCode}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
