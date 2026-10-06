import PDFDocument from 'pdfkit';
import { getReceiptData, type ReceiptData } from './receiptService.js';
import type { DbClient } from './domainUtils.js';

function formatCurrency(num: number) {
  return `Rs. ${num.toFixed(2)}`;
}

export const generateInvoicePdfBuffer = async (saleId: string, client?: DbClient, shopId = 'default-shop-pharmora'): Promise<{ buffer: Buffer; filename: string }> => {
  const data: ReceiptData = await getReceiptData(saleId, client, shopId);

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

      const primaryColor = '#1e3a8a';
      const secondaryColor = '#475569';
      const borderColor = '#cbd5e1';
      const headerBg = '#f1f5f9';

      doc
        .fontSize(16)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(data.store.storeName.toUpperCase(), 36, 36, { align: 'left' });

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor(secondaryColor)
        .text(data.store.tagline || 'Healthcare & Wellness Pharmacy', 36, 56)
        .text(data.store.address, 36, 68, { width: 300 })
        .text(`Phone: ${data.store.phone} | Email: ${data.store.email}`, 36, 92);

      doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('TAX INVOICE', 350, 36, { align: 'right', width: 209 });

      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#000000')
        .text(`Invoice No: ${data.sale.invoiceNumber}`, 350, 56, { align: 'right', width: 209 })
        .text(`Date: ${new Date(data.sale.saleDate).toLocaleDateString('en-IN')}`, 350, 68, { align: 'right', width: 209 })
        .text(`GSTIN: ${data.store.gstin || 'N/A'}`, 350, 80, { align: 'right', width: 209 })
        .text(`D.L. No: ${data.store.dlNumber || 'N/A'}`, 350, 92, { align: 'right', width: 209 });

      doc.moveTo(36, 115).lineTo(559, 115).strokeColor(borderColor).stroke();

      const custY = 125;
      doc.rect(36, custY, 523, 50).fillAndStroke(headerBg, borderColor);

      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('Billed To (Customer Details):', 44, custY + 8);

      doc
        .font('Helvetica')
        .fillColor('#000000')
        .text(`Name: ${data.customer.name}`, 44, custY + 22)
        .text(`Phone: ${data.customer.phone || 'N/A'}`, 44, custY + 34);

      if (data.customer.address) {
        doc.text(`Address: ${data.customer.address}`, 300, custY + 22, { width: 250 });
      }
      doc.text(`Cashier: ${data.sale.cashierName}`, 300, custY + 34);

      const tableTop = 185;
      doc.rect(36, tableTop, 523, 20).fillAndStroke(primaryColor, primaryColor);

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor('#ffffff')
        .text('#', 40, tableTop + 6, { width: 20, align: 'center' })
        .text('Item Description', 65, tableTop + 6, { width: 145 })
        .text('Batch', 215, tableTop + 6, { width: 55 })
        .text('Expiry', 275, tableTop + 6, { width: 45 })
        .text('Qty', 325, tableTop + 6, { width: 30, align: 'right' })
        .text('Rate', 360, tableTop + 6, { width: 45, align: 'right' })
        .text('Disc', 410, tableTop + 6, { width: 35, align: 'right' })
        .text('GST%', 450, tableTop + 6, { width: 35, align: 'right' })
        .text('Total (Rs.)', 490, tableTop + 6, { width: 64, align: 'right' });

      let currentY = tableTop + 20;

      doc.font('Helvetica').fontSize(8).fillColor('#000000');

      data.items.forEach((item, index) => {
        const isEven = index % 2 === 0;
        if (isEven) {
          doc.rect(36, currentY, 523, 18).fill('#f8fafc');
        }

        doc
          .fillColor('#000000')
          .text(String(item.srNo), 40, currentY + 4, { width: 20, align: 'center' })
          .text(item.productName, 65, currentY + 4, { width: 145, height: 12, ellipsis: true })
          .text(item.batchNumber || '-', 215, currentY + 4, { width: 55 })
          .text(item.expiryDate || '-', 275, currentY + 4, { width: 45 })
          .text(String(item.quantity), 325, currentY + 4, { width: 30, align: 'right' })
          .text(item.unitPrice.toFixed(2), 360, currentY + 4, { width: 45, align: 'right' })
          .text(item.discount > 0 ? item.discount.toFixed(2) : '-', 410, currentY + 4, { width: 35, align: 'right' })
          .text(`${item.gstRate}%`, 450, currentY + 4, { width: 35, align: 'right' })
          .text(item.lineTotal.toFixed(2), 490, currentY + 4, { width: 64, align: 'right' });

        currentY += 18;

        if (currentY > 680) {
          doc.addPage();
          currentY = 40;
        }
      });

      doc.moveTo(36, currentY).lineTo(559, currentY).strokeColor(borderColor).stroke();

      const summaryY = Math.max(currentY + 10, 520);

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('Payment Information:', 36, summaryY)
        .font('Helvetica')
        .fillColor('#000000')
        .text(`Payment Mode: ${data.payment.paymentMethod}`, 36, summaryY + 14)
        .text(`Status: ${data.payment.isFullyPaid ? 'PAID' : 'PARTIAL / CREDIT'}`, 36, summaryY + 26)
        .text(`Total Items: ${data.totals.itemCount} (Qty: ${data.totals.totalQuantity})`, 36, summaryY + 38);

      const rightX = 350;
      const rightWidth = 209;

      doc
        .fontSize(8)
        .font('Helvetica')
        .text('Subtotal:', rightX, summaryY, { width: 100 })
        .text(formatCurrency(data.totals.subtotal), rightX + 100, summaryY, { align: 'right', width: 109 });

      let nextRowY = summaryY + 12;

      if (data.totals.totalDiscount > 0) {
        doc
          .text('Discount:', rightX, nextRowY, { width: 100 })
          .text(`-${formatCurrency(data.totals.totalDiscount)}`, rightX + 100, nextRowY, { align: 'right', width: 109 });
        nextRowY += 12;
      }

      if (data.totals.totalGst > 0) {
        doc
          .text(`CGST (${formatCurrency(data.totals.cgstTotal)}):`, rightX, nextRowY, { width: 100 })
          .text(formatCurrency(data.totals.cgstTotal), rightX + 100, nextRowY, { align: 'right', width: 109 });
        nextRowY += 12;

        doc
          .text(`SGST (${formatCurrency(data.totals.sgstTotal)}):`, rightX, nextRowY, { width: 100 })
          .text(formatCurrency(data.totals.sgstTotal), rightX + 100, nextRowY, { align: 'right', width: 109 });
        nextRowY += 12;
      }

      doc.moveTo(rightX, nextRowY).lineTo(559, nextRowY).strokeColor(borderColor).stroke();
      nextRowY += 4;

      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('Grand Total:', rightX, nextRowY, { width: 100 })
        .text(formatCurrency(data.totals.grandTotal), rightX + 100, nextRowY, { align: 'right', width: 109 });

      nextRowY += 16;
      doc
        .fontSize(8)
        .font('Helvetica')
        .fillColor('#000000')
        .text('Amount Paid:', rightX, nextRowY, { width: 100 })
        .text(formatCurrency(data.payment.paidAmount), rightX + 100, nextRowY, { align: 'right', width: 109 });

      if (data.payment.balanceDue > 0) {
        nextRowY += 12;
        doc
          .font('Helvetica-Bold')
          .fillColor('#dc2626')
          .text('Balance Due:', rightX, nextRowY, { width: 100 })
          .text(formatCurrency(data.payment.balanceDue), rightX + 100, nextRowY, { align: 'right', width: 109 });
      }

      const footerY = 720;
      doc.moveTo(36, footerY).lineTo(559, footerY).strokeColor(borderColor).stroke();

      doc
        .fontSize(7)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text('Terms & Conditions:', 36, footerY + 6)
        .font('Helvetica')
        .fillColor(secondaryColor)
        .text(data.store.invoiceTerms, 36, footerY + 16, { width: 360 });

      doc
        .fontSize(8)
        .font('Helvetica-Bold')
        .fillColor(primaryColor)
        .text(`For ${data.store.storeName}`, 420, footerY + 16, { align: 'center', width: 139 })
        .fontSize(7)
        .font('Helvetica')
        .fillColor(secondaryColor)
        .text('Authorized Signatory', 420, footerY + 50, { align: 'center', width: 139 });

      doc
        .fontSize(7)
        .font('Helvetica-Oblique')
        .fillColor('#94a3b8')
        .text(`${data.store.receiptFooter} | Powered by Pharmora POS`, 36, 792, { align: 'center', width: 523 });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
};
