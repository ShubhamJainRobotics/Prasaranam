import PDFDocument from 'pdfkit';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import type { HandoverDetail } from '@relay/contracts';
import type { ExportMetadata } from './markdown.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate the bundled fonts
const regularFontPath = path.resolve(__dirname, '../../assets/fonts/NotoSans-Regular.ttf');
const boldFontPath = path.resolve(__dirname, '../../assets/fonts/NotoSans-Bold.ttf');

function toLabelCase(str: string): string {
  if (!str) return '';
  return str
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export function renderHandoverPdf(
  handover: HandoverDetail,
  metadata: ExportMetadata
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        bufferPages: true,
        autoFirstPage: true,
      });

      const buffers: Buffer[] = [];
      doc.on('data', (chunk) => buffers.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(buffers)));
      doc.on('error', (err) => reject(err));

      // Register bundled Unicode fonts if they exist, fallback to Helvetica if somehow missing
      if (fs.existsSync(regularFontPath) && fs.existsSync(boldFontPath)) {
        doc.registerFont('NotoSans', regularFontPath);
        doc.registerFont('NotoSans-Bold', boldFontPath);
        doc.font('NotoSans');
      }

      const regularFont = fs.existsSync(regularFontPath) ? 'NotoSans' : 'Helvetica';
      const boldFont = fs.existsSync(boldFontPath) ? 'NotoSans-Bold' : 'Helvetica-Bold';

      const title = handover.title || handover.configuration.title;
      const version = handover.version;
      const status = toLabelCase(handover.status);
      const recipient = handover.recipientName || 'Incoming Team Member';
      const approver = handover.approvedBy || 'Authorised Reviewer';
      const approvedAt = handover.approvedAt
        ? new Date(handover.approvedAt).toUTCString()
        : 'Not Recorded';
      const exportedAt = new Date(metadata.exportedAt).toUTCString();

      // ─── Header ─────────────────────────────────────────────────────────────
      doc.font(boldFont).fontSize(20).fillColor('#111827').text(title);
      doc.moveDown(0.5);

      doc.font(regularFont).fontSize(10).fillColor('#4b5563');
      doc.text(`Version: v${version}`);
      doc.text(`Status: ${status}`);
      doc.text(`Recipient: ${recipient}`);
      doc.text(`Approver: ${approver}`);
      doc.text(`Approved At: ${approvedAt}`);
      doc.text(`Exported At: ${exportedAt}`);
      if (handover.configuration.priorityFocus) {
        doc.text(`Priority Focus: ${handover.configuration.priorityFocus}`);
      }

      doc.moveDown(1);
      doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1);

      // ─── Filter Non-rejected Items ──────────────────────────────────────────
      const nonRejectedItems = (handover.items || []).filter((i) => i.reviewState !== 'rejected');
      const sectionKeys = handover.configuration.includedSections || [];
      const itemsBySection = new Map<string, typeof nonRejectedItems>();
      for (const sk of sectionKeys) {
        itemsBySection.set(sk, []);
      }
      for (const item of nonRejectedItems) {
        const list = itemsBySection.get(item.section) || [];
        list.push(item);
        itemsBySection.set(item.section, list);
      }

      // ─── Table of Contents ──────────────────────────────────────────────────
      doc.font(boldFont).fontSize(14).fillColor('#111827').text('Contents');
      doc.moveDown(0.5);

      let secIdx = 1;
      for (const secKey of sectionKeys) {
        const secItems = itemsBySection.get(secKey) || [];
        doc
          .font(regularFont)
          .fontSize(10)
          .fillColor('#374151')
          .text(`${secIdx}. ${toLabelCase(secKey)} (${secItems.length} items)`);
        secIdx++;
      }

      doc.moveDown(1);
      doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(1.5);

      // ─── Sections & Items ───────────────────────────────────────────────────
      secIdx = 1;
      for (const secKey of sectionKeys) {
        const secItems = itemsBySection.get(secKey) || [];

        // Check page overflow for section header
        if (doc.y > 680) {
          doc.addPage();
        }

        doc
          .font(boldFont)
          .fontSize(14)
          .fillColor('#111827')
          .text(`${secIdx}. ${toLabelCase(secKey)}`);
        doc.moveDown(0.5);

        if (secItems.length === 0) {
          doc
            .font(regularFont)
            .fontSize(10)
            .fillColor('#6b7280')
            .text('No items recorded in this section.');
          doc.moveDown(1);
          secIdx++;
          continue;
        }

        let itemNum = 1;
        for (const item of secItems) {
          if (doc.y > 680) {
            doc.addPage();
          }

          const kindLabel = toLabelCase(item.itemKind);
          const evidenceLabel = toLabelCase(item.evidenceState);

          doc
            .font(boldFont)
            .fontSize(11)
            .fillColor('#1f2937')
            .text(`${secIdx}.${itemNum} [${kindLabel} | ${evidenceLabel}]`);
          doc.moveDown(0.2);

          doc.font(regularFont).fontSize(10).fillColor('#111827').text(item.text, {
            lineGap: 2,
          });
          doc.moveDown(0.3);

          if (item.originalText && item.editedBy) {
            doc
              .font(regularFont)
              .fontSize(9)
              .fillColor('#9ca3af')
              .text('Edited by reviewer; wording not machine-verified.');
            doc.moveDown(0.2);
          }

          if (item.citations && item.citations.length > 0) {
            doc.font(boldFont).fontSize(9).fillColor('#4b5563').text('Evidence:');
            for (const cit of item.citations) {
              const src = cit.sourceTitle || 'Project Source';
              const ref = cit.quote ? `Quote: "${cit.quote}"` : 'Quote not recorded';
              doc
                .font(regularFont)
                .fontSize(9)
                .fillColor('#4b5563')
                .text(`• ${src} — ${ref}`, { indent: 10, lineGap: 1 });
            }
          }

          doc.moveDown(0.8);
          itemNum++;
        }

        doc.moveDown(1);
        secIdx++;
      }

      // ─── End Note ───────────────────────────────────────────────────────────
      if (doc.y > 700) {
        doc.addPage();
      }
      doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(50, doc.y).lineTo(545, doc.y).stroke();
      doc.moveDown(0.5);
      doc
        .font(regularFont)
        .fontSize(9)
        .fillColor('#6b7280')
        .text(
          `Generated by Prasaranam Knowledge Handover Platform on ${exportedAt}. Document contains only authorised project knowledge verified for the named recipient.`,
          { align: 'center' }
        );

      // ─── Add page numbers to all pages ──────────────────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc
          .font(regularFont)
          .fontSize(8)
          .fillColor('#9ca3af')
          .text(
            `Page ${i + 1} of ${range.count} • Prasaranam Knowledge Handover Platform`,
            50,
            780,
            {
              align: 'center',
              width: 495,
            }
          );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}
