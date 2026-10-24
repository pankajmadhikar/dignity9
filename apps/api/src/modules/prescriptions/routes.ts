import { Router } from 'express';
import { ageFromDob, formatMobile } from '../../utils/domain';
import { audit, clientIp, HttpError, prisma } from '../../lib';
import { authed, requireAuth, requireRole, wrap } from '../../middleware/auth';
import { streamPrescription } from './pdf';

const sexLabel: Record<string, string> = {
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
  UNDISCLOSED: 'Undisclosed',
};

function ageSex(patient: { dateOfBirth: Date | null; ageYears: number | null; sex: string }) {
  const age = patient.dateOfBirth ? ageFromDob(patient.dateOfBirth) : patient.ageYears;
  return [age != null ? `${age} yrs` : 'Age not recorded', sexLabel[patient.sex] ?? patient.sex].join(' · ');
}

const router = Router();
router.use(requireAuth);

router.get(
  '/prescriptions/:id/pdf',
  requireRole('DOCTOR', 'ADMIN', 'RECEPTIONIST'),
  wrap(async (req, res) => {
    const user = authed(req);
    const prescription = await prisma.prescription.findFirst({
      where: { id: req.params.id, visit: { clinicId: user.clinicId } },
      include: {
        items: { orderBy: { sortOrder: 'asc' } },
        doctor: true,
        visit: { include: { patient: true, labOrders: true, clinic: true } },
      },
    });
    if (!prescription) throw new HttpError(404, 'Prescription not found');
    if (prescription.status !== 'APPROVED') throw new HttpError(400, 'Approve the prescription before printing');
    const clinic = prescription.visit.clinic;
    const patient = prescription.visit.patient;
    const when = new Intl.DateTimeFormat('en-IN', {
      timeZone: clinic.timezone,
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(prescription.visit.createdAt);
    streamPrescription(res, {
      clinicName: clinic.name,
      clinicAddress: clinic.address,
      clinicPhone: clinic.phone,
      clinicEmail: clinic.email,
      doctorName: prescription.doctor.name,
      specialty: prescription.doctor.specialty,
      registrationNo: prescription.doctor.registrationNo,
      patientName: patient.fullName,
      patientCode: patient.patientCode,
      ageSex: ageSex(patient),
      mobile: formatMobile(patient.mobile),
      visitDate: `${when} · v${prescription.version}`,
      diagnosis: prescription.diagnosis,
      notes: prescription.notes,
      followUpDate: prescription.followUpDate ? prescription.followUpDate.toISOString().slice(0, 10) : null,
      followUpInstructions: null,
      tests: prescription.visit.labOrders.map((order) => order.testName),
      items: prescription.items,
    });
    await audit(prisma, {
      clinicId: user.clinicId,
      userId: user.id,
      action: 'prescription.print',
      entityType: 'Prescription',
      entityId: prescription.id,
      ip: clientIp(req),
    });
  }),
);


export default router;
