/* Rebuilds Gift/Service Certificate workbooks from current in-memory state via SheetJS,
   matching the original templates' A1:O4 title/summary area and column layout as closely as
   this library allows.

   Hard limit worth knowing: the vendored SheetJS build (Community Edition) cannot WRITE cell
   styles — confirmed by writing a styled cell and reading it back with the style silently
   dropped. Fonts, fills, borders, and conditional formatting from the original template
   cannot be reproduced; that requires the paid SheetJS Pro build. What IS reproduced here:
   the exact label/value layout of the header area, column order and headers, column widths,
   and rows numbered in certificate-number order — everything that's structure/content rather
   than visual styling. The free build also cannot WRITE .xlsb, so Gift Certificate exports as
   .xlsx too (Excel opens either interchangeably). */
window.CertApp = window.CertApp || {};
CertApp.exportWorkbook = (function () {
  var acc = CertApp.accounting;

  var LEDGER_HEADER_BASE = [
    'No.', 'Issued Date', 'Expiry Date', 'Status', 'Certificate No', 'D/C', 'Amount (A)', 'Payment Type'
  ];
  var LEDGER_HEADER_TAIL = [
    'Used Date', 'Outlet Posting Amount (B)', 'Misc Rev Posting Date', 'AR Posting Amount (C)',
    'Variance (A)-(B)-(C)', 'Used Amount (B)+(C)', 'Bill No. / Room No.'
  ];
  var HEADER_WIDTH = LEDGER_HEADER_BASE.length + LEDGER_HEADER_TAIL.length; // + 1 more if Certificate Detail included

  function sortByCertNo(records) {
    return records.slice().sort(function (a, b) {
      var an = a.certificateNo || '', bn = b.certificateNo || '';
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
  }

  function ledgerRow(rec, no, includeCertDetail) {
    var row = LEDGER_HEADER_BASE.map(function () { return null; });
    row[0] = no;
    row[1] = dateCell(rec.issuedDate);
    row[2] = dateCell(rec.expiryDate);
    row[3] = CertApp.displayStatusLabel(rec.status);
    row[4] = rec.certificateNo;
    row[5] = rec.dc;
    row[6] = rec.amountA;
    row[7] = rec.paymentType;
    var tail = [
      dateCell(rec.usedDate), rec.outletPostingAmountB, dateCell(rec.miscRevPostingDate), rec.arPostingAmountC,
      acc.varianceABC(rec), acc.usedAmountBC(rec), rec.billNo
    ];
    if (includeCertDetail) row.push(rec.certificateDetail);
    return row.concat(tail);
  }

  // headerRows: array of up to 4 row-arrays (the A1:O4-equivalent title/summary area) to
  // prepend above the column header row — see serviceHeaderRows/giftHeaderRows below.
  function ledgerSheet(records, includeCertDetail, headerRows) {
    var header = includeCertDetail
      ? LEDGER_HEADER_BASE.concat(['Certificate Detail'], LEDGER_HEADER_TAIL)
      : LEDGER_HEADER_BASE.concat(LEDGER_HEADER_TAIL);
    var aoa = (headerRows || []).slice();
    aoa.push(header);
    // Rows are always numbered in certificate-number order, regardless of current sort/filter
    // state in the live app — this is a fixed ledger export, not a snapshot of a UI view.
    sortByCertNo(records).forEach(function (rec, idx) { aoa.push(ledgerRow(rec, idx + 1, includeCertDetail)); });
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = columnWidths(includeCertDetail);
    return ws;
  }

  function columnWidths(includeCertDetail) {
    var widths = [6, 11, 11, 14, 13, 6, 11, 10]; // No./Issued/Expiry/Status/CertNo/D-C/Amount/Payment
    if (includeCertDetail) widths.push(26); // Certificate Detail
    widths = widths.concat([11, 14, 14, 12, 12, 14, 18]); // Used/OutletB/MiscRevDate/ArC/Variance/UsedAmt/BillNo
    return widths.map(function (w) { return { wch: w }; });
  }

  function dateCell(iso) {
    return iso ? new Date(iso + 'T00:00:00') : null;
  }

  function periodTotals(periodStart, periodEnd, categories) {
    var summary = CertApp.calculationEngine.computeSummary(periodStart, periodEnd);
    var totals = { openingQty: 0, openingAmt: 0, issuedQty: 0, issuedAmt: 0, usedQty: 0, usedAmt: 0, expiredRevQty: 0, expiredRevAmt: 0, voidQty: 0, voidAmt: 0, endingQty: 0, endingAmt: 0 };
    categories.forEach(function (cat) {
      var b = summary[cat];
      Object.keys(totals).forEach(function (k) { totals[k] += b[k]; });
    });
    return totals;
  }

  function blankRow(width) { return new Array(width).fill(null); }

  // Reproduces the Service Certificate ledger's A1:O4 layout: title (A1), a blank row, a
  // "USED DATE From/To <amount> ... Ending Balance: <amt> <amt> Opening Balance" row, and an
  // "ISSUED DATE From/To <amount>" row underneath (column positions match the source file).
  function serviceHeaderRows(periodStart, periodEnd, totals) {
    var r1 = blankRow(HEADER_WIDTH + 1); r1[0] = 'Hotel Service Certificate Status';
    var r2 = blankRow(HEADER_WIDTH + 1);
    var r3 = blankRow(HEADER_WIDTH + 1);
    r3[5] = 'USED DATE'; r3[6] = 'From'; r3[7] = dateCell(periodStart); r3[8] = 'To'; r3[9] = dateCell(periodEnd);
    r3[10] = totals.usedAmt;
    r3[12] = 'Ending Balance:'; r3[13] = totals.endingAmt; r3[14] = totals.openingAmt; r3[15] = 'Opening Balance';
    var r4 = blankRow(HEADER_WIDTH + 1);
    r4[1] = dateCell(CertApp.today());
    r4[5] = 'ISSUED DATE'; r4[6] = 'From'; r4[7] = dateCell(periodStart); r4[8] = 'To'; r4[9] = dateCell(periodEnd);
    r4[10] = totals.issuedAmt;
    return [r1, r2, r3, r4];
  }

  // Reproduces the separate SPA / PULSE8 ledger sheets' title/summary area (source file
   // "SPA & PULSE8 SVC Certificate_*.xlsx"): title (A1), a "USED DATE FROM" row, and an
   // "ISSUED DATE ... Ending Balance / Opening Balance" row, matching that file's column
   // positions (which differ slightly from the interleaved 원장(New) layout above). The title
   // text is chosen so re-importing the exported file categorises the whole sheet correctly
   // via importServiceCertificate.inferSheetWideCategory (e.g. "...Spa..." -> SC_SPA).
  function spaPulse8HeaderRows(title, periodStart, periodEnd, totals) {
    var W = HEADER_WIDTH + 3; // wide enough for the Certificate-Detail column shift + balance labels
    var r1 = blankRow(W); r1[0] = title;
    var r2 = blankRow(W);
    r2[4] = 'USED DATE FROM'; r2[5] = 'From'; r2[6] = dateCell(periodStart); r2[7] = 'To'; r2[8] = dateCell(periodEnd);
    r2[9] = totals.usedAmt;
    var r3 = blankRow(W);
    r3[4] = 'ISSUED DATE'; r3[5] = 'From'; r3[6] = dateCell(periodStart); r3[7] = 'To'; r3[8] = dateCell(periodEnd);
    r3[9] = totals.issuedAmt;
    r3[13] = 'Ending Balance:'; r3[14] = totals.endingAmt; r3[15] = totals.openingAmt; r3[16] = 'Opening Balance';
    var r4 = blankRow(W); r4[1] = dateCell(CertApp.today());
    return [r1, r2, r3, r4];
  }

  // Misc Revenue ledger sheet, restricted to the given categories so each export only carries
  // its own family's write-off / grace-use entries (a Service export shouldn't leak SPA rows).
  function miscRevenueSheet(categories) {
    var catSet = {};
    categories.forEach(function (c) { catSet[c] = true; });
    var mrHeader = ['Entry Date', 'Certificate No', 'Category', 'Type', 'Amount', 'Note'];
    var mrRows = CertApp.cache.miscRevenue.filter(function (e) { return catSet[e.category]; }).slice().sort(function (a, b) {
      var an = a.certificateNo || '', bn = b.certificateNo || '';
      return an < bn ? -1 : (an > bn ? 1 : 0);
    });
    var mrAoa = [mrHeader].concat(mrRows.map(function (e) {
      return [dateCell(e.entryDate), e.certificateNo, CertApp.CATEGORY_LABEL[e.category], e.type, e.amount, e.note];
    }));
    return XLSX.utils.aoa_to_sheet(mrAoa);
  }

  // Reproduces the Gift Certificate ledger's A1:O4 layout: title (A1), "USED DATE" row,
  // "PAID-OUT DATE" row (void/refund payouts for the period, plus Ending/Opening Balance),
  // and "ISSUED DATE" row — one column left of the Service layout's Ending/Opening position,
  // matching the source file exactly.
  function giftHeaderRows(title, periodStart, periodEnd, totals) {
    var r1 = blankRow(HEADER_WIDTH); r1[0] = title;
    var r2 = blankRow(HEADER_WIDTH);
    r2[5] = 'USED DATE'; r2[6] = 'From'; r2[7] = dateCell(periodStart); r2[8] = 'To'; r2[9] = dateCell(periodEnd);
    r2[10] = totals.usedAmt;
    var r3 = blankRow(HEADER_WIDTH);
    r3[5] = 'PAID-OUT DATE'; r3[6] = 'From'; r3[7] = dateCell(periodStart); r3[8] = 'To'; r3[9] = dateCell(periodEnd);
    r3[10] = totals.voidAmt;
    r3[11] = 'Ending Balance:'; r3[12] = totals.endingAmt; r3[13] = totals.openingAmt; r3[14] = 'Opening Balance';
    var r4 = blankRow(HEADER_WIDTH);
    r4[1] = dateCell(CertApp.today());
    r4[5] = 'ISSUED DATE'; r4[6] = 'From'; r4[7] = dateCell(periodStart); r4[8] = 'To'; r4[9] = dateCell(periodEnd);
    r4[10] = totals.issuedAmt;
    return [r1, r2, r3, r4];
  }

  function summarySheet(periodStart, periodEnd, categories) {
    var summary = CertApp.calculationEngine.computeSummary(periodStart, periodEnd);
    var header = ['Type', 'Opening Amount', 'Opening Qty', 'Issued Amount', 'Issued Qty',
      'Used Amount', 'Used Qty', 'Expired->Rev Amount', 'Expired->Rev Qty',
      'Void/Refund Amount', 'Void/Refund Qty', 'Ending Amount', 'Ending Qty'];
    var aoa = [['Period: ' + periodStart + ' to ' + periodEnd], header];
    var totals = { openingQty: 0, openingAmt: 0, issuedQty: 0, issuedAmt: 0, usedQty: 0, usedAmt: 0, expiredRevQty: 0, expiredRevAmt: 0, voidQty: 0, voidAmt: 0, endingQty: 0, endingAmt: 0 };
    categories.forEach(function (cat) {
      var b = summary[cat];
      Object.keys(totals).forEach(function (k) { totals[k] += b[k]; });
      aoa.push([CertApp.CATEGORY_LABEL[cat], b.openingAmt, b.openingQty, b.issuedAmt, b.issuedQty,
        b.usedAmt, b.usedQty, b.expiredRevAmt, b.expiredRevQty, b.voidAmt, b.voidQty, b.endingAmt, b.endingQty]);
    });
    aoa.push(['Total', totals.openingAmt, totals.openingQty, totals.issuedAmt, totals.issuedQty,
      totals.usedAmt, totals.usedQty, totals.expiredRevAmt, totals.expiredRevQty, totals.voidAmt, totals.voidQty, totals.endingAmt, totals.endingQty]);
    return XLSX.utils.aoa_to_sheet(aoa);
  }

  function currentMonthRange() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    var end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: CertApp.formatLocalDate(start), end: CertApp.formatLocalDate(end) };
  }

  function exportGiftCertificate() {
    var all = CertApp.cache.certificates;
    var gc50 = all.filter(function (r) { return r.category === CertApp.CATEGORY.GC_50000; });
    var gc100 = all.filter(function (r) { return r.category === CertApp.CATEGORY.GC_100000; });
    var period = currentMonthRange();
    var totals50 = periodTotals(period.start, period.end, [CertApp.CATEGORY.GC_50000]);
    var totals100 = periodTotals(period.start, period.end, [CertApp.CATEGORY.GC_100000]);

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ledgerSheet(gc50, false, giftHeaderRows('<KRW 50,000> Hotel Gift Certificate Status', period.start, period.end, totals50)), '50,000(원장)');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(gc100, false, giftHeaderRows('<KRW 100,000> Hotel Gift Certificate Status', period.start, period.end, totals100)), '100,000(원장)');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(gc50.concat(gc100).filter(function (r) { return r.issuedDate >= period.start && r.issuedDate <= period.end; }), false), 'Issued');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(gc50.concat(gc100).filter(function (r) { return r.usedDate && r.usedDate >= period.start && r.usedDate <= period.end; }), false), 'Used');
    XLSX.utils.book_append_sheet(wb, summarySheet(period.start, period.end, [CertApp.CATEGORY.GC_50000, CertApp.CATEGORY.GC_100000]), 'Summary');

    XLSX.writeFile(wb, 'Gift Certificate export ' + period.start + '.xlsx');
  }

  // Service Certificate export = FB & Rooms only, matching its source file
  // "Service Certificate_*.xlsx" (whose 원장(New) sheet is FB & Rooms exclusively). SPA and
  // Pulse8 live in their own source file and get their own export below.
  function exportServiceCertificate() {
    var all = CertApp.cache.certificates;
    var cat = CertApp.CATEGORY.SC_FB_ROOMS;
    var sc = all.filter(function (r) { return r.category === cat; });
    var period = currentMonthRange();
    var totals = periodTotals(period.start, period.end, [cat]);

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ledgerSheet(sc, true, serviceHeaderRows(period.start, period.end, totals)), '원장(New)');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(sc.filter(function (r) { return r.issuedDate >= period.start && r.issuedDate <= period.end; }), true), 'Issued');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(sc.filter(function (r) { return r.usedDate && r.usedDate >= period.start && r.usedDate <= period.end; }), true), 'Used');
    XLSX.utils.book_append_sheet(wb, miscRevenueSheet([cat]), 'Misc revenue');
    XLSX.utils.book_append_sheet(wb, summarySheet(period.start, period.end, [cat]), 'Summary');

    XLSX.writeFile(wb, 'Service Certificate export ' + period.start + '.xlsx');
  }

  // SPA & PULSE8 export, mirroring the source file "SPA & PULSE8 SVC Certificate_*.xlsx":
  // separate SPA and PULSE8 ledger sheets (each titled so a round-trip re-import categorises
  // the whole sheet), a combined Issued/Used snapshot for the period, a Misc Rev ledger, and
  // a Summary covering both families. Kept distinct from the FB & Rooms Service export so each
  // of the two service source files maps 1:1 to its own export.
  function exportSpaPulse8() {
    var all = CertApp.cache.certificates;
    var spa = all.filter(function (r) { return r.category === CertApp.CATEGORY.SC_SPA; });
    var pulse8 = all.filter(function (r) { return r.category === CertApp.CATEGORY.SC_PULSE8; });
    var both = spa.concat(pulse8);
    var cats = [CertApp.CATEGORY.SC_SPA, CertApp.CATEGORY.SC_PULSE8];
    var period = currentMonthRange();
    var spaTotals = periodTotals(period.start, period.end, [CertApp.CATEGORY.SC_SPA]);
    var pulse8Totals = periodTotals(period.start, period.end, [CertApp.CATEGORY.SC_PULSE8]);

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, summarySheet(period.start, period.end, cats), 'Summary');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(spa, true, spaPulse8HeaderRows('Hotel Spa Service Certificate Status', period.start, period.end, spaTotals)), 'SPA');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(pulse8, true, spaPulse8HeaderRows('Hotel Pulse8 Service Certificate Status', period.start, period.end, pulse8Totals)), 'PULSE8');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(both.filter(function (r) { return r.issuedDate >= period.start && r.issuedDate <= period.end; }), true), 'Issued');
    XLSX.utils.book_append_sheet(wb, ledgerSheet(both.filter(function (r) { return r.usedDate && r.usedDate >= period.start && r.usedDate <= period.end; }), true), 'Used');
    XLSX.utils.book_append_sheet(wb, miscRevenueSheet(cats), 'Misc Rev');

    XLSX.writeFile(wb, 'SPA & PULSE8 SVC Certificate export ' + period.start + '.xlsx');
  }

  return {
    exportGiftCertificate: exportGiftCertificate,
    exportServiceCertificate: exportServiceCertificate,
    exportSpaPulse8: exportSpaPulse8
  };
})();
