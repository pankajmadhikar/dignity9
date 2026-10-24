export type Role = 'ADMIN' | 'DOCTOR' | 'RECEPTIONIST' | 'LAB';

export type StaffUser = {
  id: string;
  clinicId: string;
  role: Role;
  name: string;
  email: string;
  specialty: string | null;
  registrationNo: string | null;
};

export type ClinicInfo = {
  id: string;
  name: string;
  timezone: string;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  registrationNo?: string | null;
};

export type Sex = 'FEMALE' | 'MALE' | 'OTHER' | 'UNDISCLOSED';

export type Patient = {
  id: string;
  patientCode: string;
  fullName: string;
  dateOfBirth: string | null;
  ageYears: number | null;
  sex: Sex;
  mobile: string;
  address?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  allergies?: string | null;
  medicalHistory?: string | null;
  consentWhatsapp?: boolean;
  consentSms?: boolean;
};

export type Vital = {
  id: string;
  systolic: number | null;
  diastolic: number | null;
  glucose: number | null;
  glucoseType: string | null;
  weightKg: number | null;
  heightCm: number | null;
  bmi: number | null;
  temperatureC: number | null;
  spo2: number | null;
  pulse: number | null;
  source: 'STAFF' | 'PATIENT';
  notes?: string | null;
  recordedAt: string;
  recordedBy?: { id: string; name: string };
};

export type QueueEntry = {
  id: string;
  tokenNumber: number;
  status: string;
  priority: 'EMERGENCY' | 'NORMAL';
  priorityReason?: string | null;
  position: number;
  calledAt?: string | null;
  startedAt?: string | null;
  visit: {
    id: string;
    visitType: string;
    chiefComplaint: string | null;
    createdAt: string;
    patient: Patient;
    doctor: { id: string; name: string } | null;
    vitals: Vital[];
  };
};

export type RxItem = {
  medicineName: string;
  formulation?: string | null;
  strength?: string | null;
  dosage?: string | null;
  route?: string | null;
  frequency?: string | null;
  duration?: string | null;
  quantity?: string | null;
  instructions?: string | null;
};

export type Prescription = {
  id: string;
  status: 'DRAFT' | 'APPROVED';
  version: number;
  approvedAt?: string | null;
  diagnosis?: string | null;
  notes?: string | null;
  followUpDate?: string | null;
  items?: RxItem[];
};

export type Consultation = {
  id: string;
  symptoms: string | null;
  examination: string | null;
  diagnosis: string | null;
  clinicalNotes: string | null;
  treatmentPlan: string | null;
  followUpDate: string | null;
  followUpInstructions: string | null;
  status: 'DRAFT' | 'FINALIZED';
};

export type LabReport = {
  id: string;
  fileName: string;
  mimeType: string;
  laboratory?: string | null;
  notes?: string | null;
  reportedAt: string;
  reviewedAt?: string | null;
  reviewNote?: string | null;
  patientId?: string;
};

export type LabOrder = {
  id: string;
  testName: string;
  status: string;
  notes?: string | null;
  createdAt: string;
  patient?: Patient;
  doctor?: { id: string; name: string };
  reports: LabReport[];
};

export type FollowUp = {
  id: string;
  dueDate: string;
  instructions: string | null;
  status: string;
  patient?: Pick<Patient, 'id' | 'fullName' | 'patientCode' | 'mobile'>;
  doctor?: { id: string; name: string } | null;
};

export type ClinicalAlert = {
  id: string;
  metric: string;
  value: number;
  units?: string | null;
  severity: 'INFO' | 'MEDIUM' | 'HIGH';
  message: string;
  state: 'GENERATED' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: string;
  patient?: Pick<Patient, 'id' | 'fullName' | 'patientCode'>;
};
