import { Navigate, Outlet, Route, BrowserRouter, Routes } from 'react-router-dom';
import { Shell } from '@/components/layouts/Shell';
import { useAuth } from '@/features/auth/auth-context';
import { LoginPage } from '@/features/auth/LoginPage';
import { AdminPage } from '@/features/analytics/AdminPage';
import { ConsultPage } from '@/features/consultations/ConsultPage';
import { DoctorPage } from '@/features/consultations/DoctorPage';
import { TasksPage } from '@/features/follow-ups/TasksPage';
import { LabsPage } from '@/features/laboratory/LabsPage';
import { PatientPage } from '@/features/patients/PatientPage';
import { PatientsPage } from '@/features/patients/PatientsPage';
import { PortalPage } from '@/features/portal/PortalPage';
import { RealtimeProvider } from '@/features/queue/realtime';
import { QueuePage } from '@/features/queue/QueuePage';
import type { Role } from '@/types';

function homeFor(role: Role) {
  if (role === 'DOCTOR') return '/doctor';
  if (role === 'LAB') return '/labs';
  if (role === 'ADMIN') return '/admin';
  return '/queue';
}

function AuthedShell() {
  const { user, ready } = useAuth();
  if (!ready) return <div className="p-8 text-sm text-slate-500">Opening the clinic…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return (
    <RealtimeProvider>
      <Shell>
        <Outlet />
      </Shell>
    </RealtimeProvider>
  );
}

function Allow({ roles, children }: { roles?: Role[]; children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return null;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeFor(user.role)} replace />;
  return children;
}

function Home() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/portal/:token" element={<PortalPage />} />
        <Route path="/" element={<Home />} />
        <Route element={<AuthedShell />}>
          <Route path="/doctor" element={<Allow roles={['DOCTOR']}><DoctorPage /></Allow>} />
          <Route path="/queue" element={<Allow roles={['RECEPTIONIST', 'DOCTOR', 'ADMIN']}><QueuePage /></Allow>} />
          <Route path="/patients" element={<Allow><PatientsPage /></Allow>} />
          <Route path="/patients/new" element={<Allow roles={['RECEPTIONIST', 'DOCTOR', 'ADMIN']}><PatientsPage creating /></Allow>} />
          <Route path="/patients/:id" element={<Allow><PatientPage /></Allow>} />
          <Route path="/consult/:id" element={<Allow><ConsultPage /></Allow>} />
          <Route path="/labs" element={<Allow roles={['DOCTOR', 'LAB', 'ADMIN', 'RECEPTIONIST']}><LabsPage /></Allow>} />
          <Route path="/tasks" element={<Allow roles={['DOCTOR', 'RECEPTIONIST', 'ADMIN']}><TasksPage /></Allow>} />
          <Route path="/admin" element={<Allow roles={['ADMIN', 'DOCTOR']}><AdminPage /></Allow>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
