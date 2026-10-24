import type { Response } from 'express';
import PDFDocument from 'pdfkit';

type Item = {
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

export type PrescriptionPdf = {
  clinicName: string;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  clinicEmail?: string | null;
  doctorName: string;
  specialty?: string | null;
  registrationNo?: string | null;
  patientName: string;
  patientCode: string;
  ageSex: string;
  mobile: string;
  visitDate: string;
  diagnosis?: string | null;
  notes?: string | null;
  followUpDate?: string | null;
  followUpInstructions?: string | null;
  tests: string[];
  items: Item[];
};

export function streamPrescription(res: Response, data: PrescriptionPdf) {
  const doc = new PDFDocument({ size: 'A4', margin: 48 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="prescription-${data.patientCode}.pdf"`);
  doc.pipe(res);

  doc.save();
  doc.rect(0, 0, doc.page.width, 96).fill('#0c6b66');
  doc.restore();
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text(data.clinicName, 48, 26, { width: 340 });
  doc.font('Helvetica').fontSize(9);
  doc.text(data.clinicAddress || 'Outpatient department', 48, 54, { width: 340 });
  doc.text([data.clinicPhone, data.clinicEmail].filter(Boolean).join('   ·   '), 48, 70, { width: 340 });
  doc.font('Helvetica-Bold').fontSize(12).text(data.doctorName, 390, 28, { width: 160, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor('#e7f4f2');
  if (data.specialty) doc.text(data.specialty, 390, 48, { width: 160, align: 'right' });
  if (data.registrationNo) doc.text(`Reg. ${data.registrationNo}`, 390, 64, { width: 160, align: 'right' });

  let y = 118;
  doc.fillColor('#1a2332').font('Helvetica-Bold').fontSize(13).text(data.patientName, 48, y);
  doc.font('Helvetica').fontSize(10).fillColor('#526072').text(`${data.patientCode}    ${data.ageSex}    ${data.mobile}`, 48, y + 18);
  doc.text(data.visitDate, 360, y + 4, { width: 187, align: 'right' });
  y += 46;
  doc.moveTo(48, y).lineTo(547, y).strokeColor('#e4dccf').stroke();
  y += 16;

  if (data.diagnosis) {
    doc.fillColor('#7a8694').fontSize(8).font('Helvetica-Bold').text('DIAGNOSIS', 48, y);
    doc.fillColor('#1a2332').font('Helvetica').fontSize(11).text(data.diagnosis, 48, y + 12, { width: 499 });
    y = doc.y + 14;
  }

  doc.fillColor('#0c6b66').font('Helvetica-Bold').fontSize(18).text('Rx', 48, y);
  y += 26;

  if (!data.items.length) {
    doc.fillColor('#1a2332').font('Helvetica').fontSize(11).text('No medicines prescribed.', 48, y);
    y += 22;
  }

  data.items.forEach((item, index) => {
    if (y > 700) {
      doc.addPage();
      y = 48;
    }
    const title = [item.medicineName, item.strength, item.formulation].filter(Boolean).join(' · ');
    doc.fillColor('#1a2332').font('Helvetica-Bold').fontSize(11).text(`${index + 1}.  ${title}`, 48, y, { width: 499 });
    y = doc.y + 3;
    const detail = [
      item.dosage,
      item.frequency,
      item.duration,
      item.route ? `Route: ${item.route}` : null,
      item.quantity ? `Qty: ${item.quantity}` : null,
    ]
      .filter(Boolean)
      .join('    ·    ');
    doc.font('Helvetica').fontSize(10).fillColor('#243140').text(detail || 'As directed', 66, y, { width: 470 });
    y = doc.y + 2;
    if (item.instructions) {
      doc.fontSize(9).fillColor('#526072').text(item.instructions, 66, y, { width: 470 });
      y = doc.y + 2;
    }
    y += 10;
  });

  if (data.notes) {
    doc.fillColor('#7a8694').font('Helvetica-Bold').fontSize(8).text('INSTRUCTIONS', 48, y);
    doc.fillColor('#1a2332').font('Helvetica').fontSize(10).text(data.notes, 48, y + 12, { width: 499 });
    y = doc.y + 14;
  }

  if (data.followUpDate) {
    doc.fillColor('#1a2332').font('Helvetica-Bold').fontSize(10).text(`Follow-up: ${data.followUpDate}`, 48, y);
    y = doc.y + 4;
    if (data.followUpInstructions) {
      doc.font('Helvetica').fontSize(10).text(data.followUpInstructions, 48, y, { width: 499 });
      y = doc.y + 8;
    }
  }

  if (data.tests.length) {
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#1a2332').text(`Tests advised: ${data.tests.join(', ')}`, 48, y, { width: 499 });
    y = doc.y + 12;
  }

  if (y > 700) {
    doc.addPage();
    y = 640;
  }
  y = Math.max(y + 28, 690);
  doc.moveTo(370, y).lineTo(540, y).strokeColor('#1a2332').stroke();
  doc.font('Helvetica').fontSize(9).fillColor('#526072').text(data.doctorName, 360, y + 6, { width: 180, align: 'right' });
  doc.text('Approved in Dignity Clinic', 360, y + 20, { width: 180, align: 'right' });
  doc.fontSize(8).fillColor('#8b95a1').text(
    'This document is for the named patient and treating clinic. Configured measurement alerts support review and are not a diagnosis.',
    48,
    770,
    { width: 500, align: 'left' },
  );
  doc.end();
}
