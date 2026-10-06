import PDFDocument from 'pdfkit';
import { getReceiptData, type ReceiptData } from './receiptService.js';
import type { DbClient } from './domainUtils.js';

function formatCurrency(num: number) {
  return `Rs. ${num.toFixed(2)}`;
}

export const generateInvoicePdfBuffer = async (saleId: string, client?: DbClient): Promise<{ buffer: Buffer; filename: string }> => {
  const data: ReceiptData = await getReceiptData(saleId, client);

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 36, // 0.5 inch margins
        info: {
          Title: `Tax Invoice - ${data.sale.invoiceNumber}`,
          Author: data.store.storeName,
          Subject: 'Tax Invoice / Retail Bill',
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          buffer,
          filename: `Invoice-${data.sale.invoiceNumber}.pdf`,
        });
      });
      doc.on('error', (err) => reject(err));

      const primaryColor = '#1e3a8a'; // Dark blue
      const secondaryColor = '#475569'; // Slate
      const borderColor = '#cbd5e1'; // Light grey border
      const headerBg = '#f1f5f9';

      // ==========================================
      // 1. STORE HEADER
      // ==========================================
      doc.fillColor(primaryColor).fontSize(16).font('Helvetica-Bold').text(data.store.storeName.toUpperCase(), 36, 36, { align: 'center' });
      if (data.store.tagline) {
        doc.fillColor(secondaryColor).fontSize(9).font('Helvetica').text(data.store.tagline, { align: 'center' });
      }
      doc.fontSize(8.5).font('Helvetica').text(data.store.address, { align: 'center' });
      doc.text(`Phone: ${data.store.phone}  |  Email: ${data.store.email}`, { align: 'center' });

      const gstinDlLine = [
        data.store.gstin ? `GSTIN: ${data.store.gstin}` : '',
        data.store.dlNumber ? `D.L. No: ${data.store.dlNumber}` : '',
        data.store.fssaiNumber ? `FSSAI: ${data.store.fssaiNumber}` : '',
      ]
        .filter(Boolean)
        .join('  |  ');

      if (gstinDlLine) {
        doc.font('Helvetica-Bold').fontSize(8.5).text(gstinDlLine, { align: 'center' });
      }

      doc.moveDown(0.5);

      // Title Banner
      doc.rect(36, doc.y, 523, 20).fill(primaryColor);
      const bannerY = doc.y + 4;
      doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold').text('TAX INVOICE / CASH MEMO', 36, bannerY, { align: 'center', width: 523 });
      doc.moveDown(1.5);

      // ==========================================
      // 2. INVOICE & CUSTOMER INFO BOX
      // ==========================================
      const boxTop = doc.y + 5;
      const boxHeight = 70;
      doc.rect(36, boxTop, 523, boxHeight).strokeColor(borderColor).stroke();

      // Divider down middle
      doc.moveTo(297, boxTop).lineTo(297, boxTop + boxHeight).strokeColor(borderColor).stroke();

      // Left Column: Customer Info
      doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('BILL TO (CUSTOMER):', 44, boxTop + 8);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(9).text(data.customer.name, 44, boxTop + 22);
      doc.font('Helvetica').fontSize(8.5).fillColor(secondaryColor);
      if (data.customer.phone) doc.text(`Phone: ${data.customer.phone}`, 44, boxTop + 35);
      if (data.customer.address) doc.text(`Address: ${data.customer.address}`, 44, boxTop + 48, { width: 240, ellipsis: true });

      // Right Column: Invoice Info
      doc.fillColor(primaryColor).fontSize(8.5).font('Helvetica-Bold').text('INVOICE DETAILS:', 305, boxTop + 8);
      doc.font('Helvetica').fontSize(8.5).fillColor('#0f172a');
      doc.text(`Invoice No: `, 305, boxTop + 22, { continued: true }).font('Helvetica-Bold').text(data.sale.invoiceNumber);
      doc.font('Helvetica').text(`Invoice Date: `, 305, boxTop + 35, { continued: true }).font('Helvetica-Bold').text(new Date(data.sale.saleDate).toLocaleString('en-IN'));
      doc.font('Helvetica').text(`Payment Mode: `, 305, boxTop + 48, { continued: true }).font('Helvetica-Bold').text(data.payment.paymentMethod);

      // ==========================================
      // 3. LINE ITEMS TABLE
      // ==========================================
      let tableY = boxTop + boxHeight + 12;

      // Table Header
      const col = {
        sr: 36,
        desc: 58,
        hsn: 210,
        batch: 250,
        exp: 300,
        qty: 345,
        rate: 375,
        disc: 415,
        gst: 450,
        total: 490,
      };

      doc.rect(36, tableY, 523, 18).fill(headerBg);
      doc.fillColor('#1e293b').fontSize(7.5).font('Helvetica-Bold');
      doc.text('Sr.', col.sr + 4, tableY + 5);
      doc.text('Item Description', col.desc, tableY + 5);
      doc.text('HSN', col.hsn, tableY + 5);
      doc.text('Batch', col.batch, tableY + 5);
      doc.text('Expiry', col.exp, tableY + 5);
      doc.text('Qty', col.qty, tableY + 5, { align: 'right', width: 25 });
      doc.text('Rate', col.rate, tableY + 5, { align: 'right', width: 35 });
      doc.text('Disc', col.disc, tableY + 5, { align: 'right', width: 30 });
      doc.text('GST%', col.gst, tableY + 5, { align: 'right', width: 35 });
      doc.text('Total (Rs)', col.total, tableY + 5, { align: 'right', width: 65 });

      tableY += 18;

      doc.font('Helvetica').fontSize(8);
      data.items.forEach((item) => {
        // Row background alternating
        const rowHeight = 18;
        if (item.srNo % 2 === 0) {
          doc.rect(36, tableY, 523, rowHeight).fill('#fafafa');
        }

        doc.fillColor('#0f172a');
        doc.text(String(item.srNo), col.sr + 4, tableY + 4);
        doc.text(item.productName, col.desc, tableY + 4, { width: 150, ellipsis: true });
        doc.text(item.hsn || '—', col.hsn, tableY + 4);
        doc.text(item.batchNumber || '—', col.batch, tableY + 4);
        doc.text(item.expiryDate || '—', col.exp, tableY + 4);
        doc.text(String(item.quantity), col.qty, tableY + 4, { align: 'right', width: 25 });
        doc.text(item.unitPrice.toFixed(2), col.rate, tableY + 4, { align: 'right', width: 35 });
        doc.text(item.discount > 0 ? item.discount.toFixed(2) : '—', col.disc, tableY + 4, { align: 'right', width: 30 });
        doc.text(`${item.gstRate}%`, col.gst, tableY + 4, { align: 'right', width: 35 });
        doc.text(item.lineTotal.toFixed(2), col.total, tableY + 4, { align: 'right', width: 65 });

        // Line bottom border
        doc.rect(36, tableY + rowHeight, 523, 0.5).fill(borderColor);
        tableY += rowHeight;
      });

      // ==========================================
      // 4. TOTALS & SUMMARY SECTION
      // ==========================================
      tableY += 8;
      const summaryLeft = 320;
      const summaryWidth = 239;

      // GST Breakdown box on Left
      doc.rect(36, tableY, 260, 95).strokeColor(borderColor).stroke();
      doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text('GST TAX BREAKDOWN', 44, tableY + 6);
      doc.font('Helvetica').fontSize(8).fillColor('#334155');
      doc.text(`Taxable Amount: Rs. ${data.totals.taxableAmount.toFixed(2)}`, 44, tableY + 22);
      doc.text(`Central GST (CGST): Rs. ${data.totals.cgstTotal.toFixed(2)}`, 44, tableY + 36);
      doc.text(`State GST (SGST): Rs. ${data.totals.sgstTotal.toFixed(2)}`, 44, tableY + 50);
      doc.font('Helvetica-Bold').text(`Total Tax Value: Rs. ${data.totals.totalGst.toFixed(2)}`, 44, tableY + 66);
      doc.font('Helvetica').fontSize(7.5).fillColor('#64748b').text('Note: Rate includes both CGST and SGST equal split', 44, tableY + 80);

      // Financial Summary on Right
      doc.rect(summaryLeft, tableY, summaryWidth, 95).strokeColor(borderColor).stroke();

      let sumY = tableY + 8;
      const printSumLine = (label: string, value: string, isBold = false, isHighlight = false) => {
        if (isHighlight) {
          doc.rect(summaryLeft + 1, sumY - 2, summaryWidth - 2, 16).fill('#eff6ff');
          doc.fillColor(primaryColor);
        } else {
          doc.fillColor('#0f172a');
        }
        doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(isHighlight ? 9.5 : 8.5);
        doc.text(label, summaryLeft + 10, sumY);
        doc.text(value, summaryLeft + 10, sumY, { align: 'right', width: summaryWidth - 20 });
        sumY += 16;
      };

      printSumLine('Items / Total Qty:', `${data.totals.itemCount} items (${data.totals.totalQuantity} units)`);
      if (data.totals.totalDiscount > 0) {
        printSumLine('Total Discount:', `-Rs. ${data.totals.totalDiscount.toFixed(2)}`);
      }
      printSumLine('Total GST Amount:', `Rs. ${data.totals.totalGst.toFixed(2)}`);
      printSumLine('Grand Total:', `Rs. ${data.totals.grandTotal.toFixed(2)}`, true, true);
      printSumLine(`Amount Paid (${data.payment.paymentMethod}):`, `Rs. ${data.payment.paidAmount.toFixed(2)}`, true);
      if (data.payment.balanceDue > 0) {
        printSumLine('Balance Due / Credit:', `Rs. ${data.payment.balanceDue.toFixed(2)}`, true);
      }

      // ==========================================
      // 5. FOOTER & TERMS
      // ==========================================
      const footerY = tableY + 110;
      doc.rect(36, footerY, 340, 60).strokeColor(borderColor).stroke();
      doc.fillColor(primaryColor).fontSize(7.5).font('Helvetica-Bold').text('TERMS & CONDITIONS:', 42, footerY + 6);
      doc.font('Helvetica').fontSize(7).fillColor('#475569').text(data.store.invoiceTerms, 42, footerY + 18, { width: 325, lineGap: 1.5 });

      // Authorized Signatory
      doc.rect(390, footerY, 169, 60).strokeColor(borderColor).stroke();
      doc.fillColor('#64748b').fontSize(7.5).font('Helvetica').text('For ' + data.store.storeName, 395, footerY + 6, { align: 'center', width: 159 });
      doc.text('Authorized Signatory', 395, footerY + 45, { align: 'center', width: 159 });

      // Bottom thank you note
      doc.fillColor(secondaryColor).fontSize(8).font('Helvetica-Oblique').text(data.store.receiptFooter, 36, footerY + 68, { align: 'center', width: 523 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
