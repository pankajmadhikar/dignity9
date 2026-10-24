import { z } from 'zod';

export const nullableText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : null));

export const ymdField = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid date'), z.literal(''), z.null()])
  .optional()
  .transform((value) => (value ? value : null));

export function optionalNumber(min: number, max: number, integer = false) {
  const number = (integer ? z.number().int() : z.number()).min(min, `Enter a value from ${min} to ${max}`).max(max, `Enter a value from ${min} to ${max}`);
  return z
    .union([number, z.null()])
    .optional()
    .transform((value) => (value == null ? null : value));
}

export const patientBody = z.object({
  fullName: z.string().trim().min(2, 'Enter the patient name').max(120),
  dateOfBirth: ymdField,
  ageYears: optionalNumber(0, 120, true),
  sex: z.enum(['FEMALE', 'MALE', 'OTHER', 'UNDISCLOSED']),
  mobile: z.string().trim().min(8, 'Enter a valid mobile number'),
  address: nullableText(300),
  emergencyContactName: nullableText(120),
  emergencyContactPhone: nullableText(20),
  allergies: nullableText(1000),
  medicalHistory: nullableText(4000),
  consentWhatsapp: z.boolean().optional(),
  consentSms: z.boolean().optional(),
  confirmDuplicate: z.boolean().optional(),
});

export const vitalBody = z.object({
  systolic: optionalNumber(50, 260, true),
  diastolic: optionalNumber(30, 180, true),
  glucose: optionalNumber(20, 800),
  glucoseType: nullableText(40),
  weightKg: optionalNumber(1, 400),
  heightCm: optionalNumber(30, 250),
  temperatureF: optionalNumber(90, 110),
  spo2: optionalNumber(50, 100),
  pulse: optionalNumber(20, 250, true),
  source: z.enum(['STAFF', 'PATIENT']).optional(),
  notes: nullableText(500),
});

export const prescriptionItemBody = z.object({
  medicineName: z.string().trim().min(1, 'Enter the medicine name').max(160),
  formulation: nullableText(80),
  strength: nullableText(80),
  dosage: nullableText(80),
  route: nullableText(80),
  frequency: nullableText(80),
  duration: nullableText(80),
  quantity: nullableText(80),
  instructions: nullableText(300),
});

export const consultationBody = z.object({
  chiefComplaint: nullableText(500),
  symptoms: nullableText(4000),
  examination: nullableText(4000),
  diagnosis: nullableText(1000),
  clinicalNotes: nullableText(4000),
  treatmentPlan: nullableText(4000),
  followUpDate: ymdField,
  followUpInstructions: nullableText(1000),
  prescriptionNotes: nullableText(2000),
  items: z.array(prescriptionItemBody).max(30).optional(),
  labTests: z.array(z.string().trim().min(2).max(160)).max(20).optional(),
  reason: nullableText(500),
});
