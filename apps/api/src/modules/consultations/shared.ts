import { ageFromDob } from '../../utils/domain';
import { HttpError, prisma } from '../../lib';

const sexLabel: Record<string, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
  UNDISCLOSED: 'Undisclosed',
};

export function ageSex(patient: { dateOfBirth: Date | null; ageYears: number | null; sex: string }) {
  const age = patient.dateOfBirth ? ageFromDob(patient.dateOfBirth) : patient.ageYears;
  return [age != null ? `${age} yrs` : 'Age not recorded', sexLabel[patient.sex] ?? patient.sex].join(' · ');
}

export function snapshot(consultation: {
  symptoms: string | null;
  examination: string | null;
  diagnosis: string | null;
  clinicalNotes: string | null;
  treatmentPlan: string | null;
  followUpDate: Date | null;
  followUpInstructions: string | null;
  status: string;
}) {
  return {
    symptoms: consultation.symptoms,
    examination: consultation.examination,
    diagnosis: consultation.diagnosis,
    clinicalNotes: consultation.clinicalNotes,
    treatmentPlan: consultation.treatmentPlan,
    followUpDate: consultation.followUpDate ? consultation.followUpDate.toISOString().slice(0, 10) : null,
    followUpInstructions: consultation.followUpInstructions,
    status: consultation.status,
  };
}

export async function ownVisit(clinicId: string, visitId: string) {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, clinicId },
    include: {
      patient: true,
      doctor: { select: { id: true, name: true, specialty: true, registrationNo: true } },
      queue: true,
      consultation: true,
      vitals: { orderBy: { recordedAt: 'desc' }, include: { recordedBy: { select: { id: true, name: true } } } },
      prescriptions: { orderBy: { version: 'desc' }, include: { items: { orderBy: { sortOrder: 'asc' } }, doctor: { select: { id: true, name: true } } } },
      labOrders: { include: { reports: true }, orderBy: { createdAt: 'asc' } },
      documents: { orderBy: { createdAt: 'desc' }, include: { uploadedBy: { select: { id: true, name: true } } } },
      alerts: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!visit) throw new HttpError(404, 'Visit not found');
  return visit;
}

export function assertDoctorOwns(userId: string, doctorId: string | null) {
  if (doctorId && doctorId !== userId) throw new HttpError(403, 'Another doctor is assigned to this visit');
}
