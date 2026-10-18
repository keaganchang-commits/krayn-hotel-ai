import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import fs from 'fs';
import path from 'path';

export interface MeetingAgreementData {
  confirmationNumber: string;
  clientName: string;
  clientEmail: string;
  companyName?: string;
  meetingTitle: string;
  roomName: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  durationHours: string;
  attendees: number;
  setupStyle: string;
  avEquipment?: string[];
  cateringNotes?: string;
  specialRequests?: string;
}

/**
 * Generates an executive, luxury-branded PDF Meeting Agreement for Park Hyatt Kuala Lumpur.
 * Adheres strictly to high-end typography, balanced whitespace, and formal hotel documentation standards.
 * The raw "ORGANIZER / CLIENT INFORMATION" grey box has been completely removed.
 */
export async function generateMeetingAgreementPdf(data: MeetingAgreementData): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // Standard A4 portrait
  const { width, height } = page.getSize();

  // Luxury Editorial Palette
  const deepNavyBlack = rgb(0.08, 0.10, 0.13); // #141A21
  const charcoal = rgb(0.22, 0.25, 0.28);
  const mutedGrey = rgb(0.48, 0.52, 0.56);
  const subtleBorder = rgb(0.88, 0.89, 0.91);
  const bronzeGold = rgb(0.64, 0.51, 0.26); // #A38242 Luxury Bronze
  const tableAltBg = rgb(0.975, 0.98, 0.985);

  // Embedded Standard Fonts
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontOblique = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const fontSignature = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const fontSignatureBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBoldItalic);

  const marginX = 52;
  const contentWidth = width - marginX * 2;
  let currentY = height - 52;

  // --- 1. BRAND HEADER ---
  const logoPath = path.join(process.cwd(), 'public', 'park-hyatt-logo.png');
  let headerDrawn = false;
  if (fs.existsSync(logoPath)) {
    try {
      const logoBytes = fs.readFileSync(logoPath);
      const logoImage = await pdfDoc.embedPng(logoBytes);
      const logoWidth = 145;
      const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
      page.drawImage(logoImage, {
        x: marginX,
        y: currentY - logoHeight + 6,
        width: logoWidth,
        height: logoHeight,
      });
      headerDrawn = true;
    } catch {}
  }

  if (!headerDrawn) {
    page.drawText('PARK HYATT KUALA LUMPUR', {
      x: marginX,
      y: currentY - 8,
      size: 13,
      font: fontBold,
      color: deepNavyBlack,
    });
  }

  // Right-aligned Hotel Details
  const rightTextX = width - marginX;
  const hotelDepartment = 'EVENT SALES & EXECUTIVE OPERATIONS';
  const hotelAddress = 'Menara Merdeka Maybank, 50118 Kuala Lumpur';
  const hotelContact = 'T: +60 3 2333 1234   |   kualalumpur.park@hyatt.com';

  page.drawText(hotelDepartment, {
    x: rightTextX - fontBold.widthOfTextAtSize(hotelDepartment, 7.5),
    y: currentY + 4,
    size: 7.5,
    font: fontBold,
    color: bronzeGold,
  });
  page.drawText(hotelAddress, {
    x: rightTextX - fontRegular.widthOfTextAtSize(hotelAddress, 7.5),
    y: currentY - 8,
    size: 7.5,
    font: fontRegular,
    color: mutedGrey,
  });
  page.drawText(hotelContact, {
    x: rightTextX - fontRegular.widthOfTextAtSize(hotelContact, 7.5),
    y: currentY - 20,
    size: 7.5,
    font: fontRegular,
    color: mutedGrey,
  });

  currentY -= 52;

  // Gold Accent Top Divider
  page.drawLine({
    start: { x: marginX, y: currentY },
    end: { x: width - marginX, y: currentY },
    thickness: 0.75,
    color: bronzeGold,
  });

  currentY -= 32;

  // --- 2. DOCUMENT TITLE & KEY METADATA BAR ---
  page.drawText('MEETING VENUE CONFIRMATION AGREEMENT', {
    x: marginX,
    y: currentY,
    size: 14,
    font: fontBold,
    color: deepNavyBlack,
  });

  const issuedDate = 'October 20, 2026';
  const metaString = `Agreement No: ${data.confirmationNumber}     •     Date Issued: ${issuedDate}`;
  page.drawText(metaString, {
    x: marginX,
    y: currentY - 16,
    size: 8,
    font: fontRegular,
    color: mutedGrey,
  });

  currentY -= 38;

  // --- 3. CLEAN CLIENT & VENUE SUMMARY BAR (No bulky gray box) ---
  const summaryLeftX = marginX;
  const summaryRightX = marginX + contentWidth / 2;

  page.drawText('CLIENT & EVENT PARTICULARS', {
    x: summaryLeftX,
    y: currentY,
    size: 8,
    font: fontBold,
    color: bronzeGold,
  });

  page.drawText('RESERVED VENUE DETAILS', {
    x: summaryRightX,
    y: currentY,
    size: 8,
    font: fontBold,
    color: bronzeGold,
  });

  currentY -= 14;

  // Left particulars
  page.drawText('Primary Contact:', { x: summaryLeftX, y: currentY, size: 8, font: fontRegular, color: mutedGrey });
  page.drawText(data.clientName, { x: summaryLeftX + 78, y: currentY, size: 8.5, font: fontBold, color: deepNavyBlack });

  // Right particulars
  page.drawText('Assigned Room:', { x: summaryRightX, y: currentY, size: 8, font: fontRegular, color: mutedGrey });
  page.drawText(data.roomName, { x: summaryRightX + 80, y: currentY, size: 8.5, font: fontBold, color: deepNavyBlack });

  currentY -= 14;

  page.drawText('Email Address:', { x: summaryLeftX, y: currentY, size: 8, font: fontRegular, color: mutedGrey });
  // Clean cleanEmail if it contains angle brackets
  const cleanEmail = (data.clientEmail || '').replace(/.*<([^>]+)>.*/, '$1').trim();
  page.drawText(cleanEmail, { x: summaryLeftX + 78, y: currentY, size: 8, font: fontRegular, color: charcoal });

  page.drawText('Event Schedule:', { x: summaryRightX, y: currentY, size: 8, font: fontRegular, color: mutedGrey });
  page.drawText(`${data.eventDate} (${data.startTime} – ${data.endTime})`, {
    x: summaryRightX + 80,
    y: currentY,
    size: 8,
    font: fontRegular,
    color: charcoal,
  });

  currentY -= 24;

  // Divider line before specifications table
  page.drawLine({
    start: { x: marginX, y: currentY },
    end: { x: width - marginX, y: currentY },
    thickness: 0.5,
    color: subtleBorder,
  });

  currentY -= 20;

  // --- 4. FORMAL EVENT SPECIFICATIONS TABLE ---
  page.drawText('SCHEDULE OF SERVICES & EVENT SPECIFICATIONS', {
    x: marginX,
    y: currentY,
    size: 8.5,
    font: fontBold,
    color: deepNavyBlack,
  });

  currentY -= 12;

  const specifications = [
    ['Event Title', data.meetingTitle || 'Executive Business Meeting'],
    ['Designated Venue', data.roomName],
    ['Date of Reservation', data.eventDate],
    ['Reserved Hours', `${data.startTime} – ${data.endTime} (${data.durationHours})`],
    ['Expected Attendance', `${data.attendees} Delegates`],
    ['Room Setup Style', `${data.setupStyle} Setup`],
    ['Technology & AV', (data.avEquipment || ['Dual 4K Laser Displays', 'Wireless Video Conferencing']).join(', ')],
    ['Catering & Refreshments', data.cateringNotes || 'Complimentary Coffee & Tea Station'],
  ];

  const rowHeight = 22;
  const labelColWidth = 145;

  specifications.forEach(([label, value], idx) => {
    const isAlt = idx % 2 === 1;
    if (isAlt) {
      page.drawRectangle({
        x: marginX,
        y: currentY - rowHeight + 4,
        width: contentWidth,
        height: rowHeight,
        color: tableAltBg,
      });
    }

    // Border line beneath each row
    page.drawLine({
      start: { x: marginX, y: currentY - rowHeight + 4 },
      end: { x: width - marginX, y: currentY - rowHeight + 4 },
      thickness: 0.4,
      color: subtleBorder,
    });

    page.drawText(label, {
      x: marginX + 10,
      y: currentY - 11,
      size: 8,
      font: fontBold,
      color: charcoal,
    });

    page.drawText(value, {
      x: marginX + labelColWidth,
      y: currentY - 11,
      size: 8,
      font: fontRegular,
      color: deepNavyBlack,
    });

    currentY -= rowHeight;
  });

  currentY -= 36;

  // --- 5. FORMAL SIGNATURE & EXECUTION SECTION ---
  const signColWidth = (contentWidth - 48) / 2;

  // Left: Authorized Hotel Signatory
  page.drawText('AUTHORIZED ISSUING SIGNATORY', {
    x: marginX,
    y: currentY,
    size: 7.5,
    font: fontBold,
    color: bronzeGold,
  });

  // Authentic stylized executive signature for hotel
  const hotelSignColor = rgb(0.12, 0.22, 0.38); // Fountain pen ink blue
  page.drawText('Sarah Jenkins', {
    x: marginX,
    y: currentY - 26,
    size: 20,
    font: fontSignatureBold,
    color: hotelSignColor,
  });

  // Signature line
  page.drawLine({
    start: { x: marginX, y: currentY - 34 },
    end: { x: marginX + signColWidth, y: currentY - 34 },
    thickness: 0.6,
    color: subtleBorder,
  });

  page.drawText('Sarah Jenkins  •  Director of Event Sales', {
    x: marginX,
    y: currentY - 46,
    size: 7.5,
    font: fontBold,
    color: deepNavyBlack,
  });
  page.drawText(`Park Hyatt Kuala Lumpur  |  Date: ${issuedDate}`, {
    x: marginX,
    y: currentY - 57,
    size: 6.8,
    font: fontRegular,
    color: mutedGrey,
  });

  // Right: Client Countersignature
  const clientCardX = marginX + signColWidth + 48;

  page.drawText('CLIENT ACCEPTANCE & COUNTERSIGNATURE', {
    x: clientCardX,
    y: currentY,
    size: 7.5,
    font: fontBold,
    color: bronzeGold,
  });

  page.drawText('Sign Here: _____________________________________', {
    x: clientCardX,
    y: currentY - 26,
    size: 7.5,
    font: fontRegular,
    color: mutedGrey,
  });

  // Signature line
  page.drawLine({
    start: { x: clientCardX, y: currentY - 34 },
    end: { x: clientCardX + signColWidth, y: currentY - 34 },
    thickness: 0.6,
    color: subtleBorder,
  });

  page.drawText(`Authorized Name: ${data.clientName}`, {
    x: clientCardX,
    y: currentY - 46,
    size: 7.5,
    font: fontBold,
    color: deepNavyBlack,
  });
  page.drawText('Date of Signing:   ________________________', {
    x: clientCardX,
    y: currentY - 57,
    size: 6.8,
    font: fontRegular,
    color: mutedGrey,
  });

  // --- 7. LUXURY MINIMAL FOOTER ---
  const footerNote = 'Park Hyatt Kuala Lumpur   •   Menara Merdeka Maybank, 50118 Kuala Lumpur   •   hyatt.com';
  page.drawText(footerNote, {
    x: width / 2 - fontOblique.widthOfTextAtSize(footerNote, 7) / 2,
    y: 28,
    size: 7,
    font: fontOblique,
    color: rgb(0.55, 0.58, 0.62),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}
