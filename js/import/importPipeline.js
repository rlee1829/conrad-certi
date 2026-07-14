/* Import orchestration: file -> workbook -> raw mapped rows -> dedupe pass -> CertificateRecords + report */
window.CertApp = window.CertApp || {};
CertApp.importPipeline = (function () {

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) { resolve(e.target.result); };
      reader.onerror = function () { reject(reader.error); };
      reader.readAsArrayBuffer(file);
    });
  }

  function detectImporter(workbook) {
    var names = workbook.SheetNames;
    var svcSheets = CertApp.importServiceCertificate.LEDGER_SHEET_NAMES;
    if (svcSheets.some(function (s) { return names.indexOf(s) !== -1; })) {
      return CertApp.importServiceCertificate;
    }
    var giftSheets = Object.keys(CertApp.importGiftCertificate.SHEET_CATEGORY);
    if (giftSheets.some(function (s) { return names.indexOf(s) !== -1; })) {
      return CertApp.importGiftCertificate;
    }
    return null;
  }

  // Determine the stored status + voidReason for a raw mapped row.
  // Recognizes VOID from the Status column (Service Certificate convention), the Payment
  // Type column (observed on legacy Gift Certificate rows), or the Certificate Detail column
  // (observed on some Service Certificate rows where Status is stale "EXPIRED" text but the
  // row was actually voided, with the amount cleared and "VOID" dropped into Detail instead —
  // without this, those rows are miscounted as still-outstanding ACTIVE).
  //
  // Priority: VOID signal > EXPLICIT source Status ("USED"/"EXPIRED") > inference from what was
  // posted for blank/unknown statuses. Trusting the explicit Status is critical: a redeemed
  // gift certificate ("USED") routinely posts most of its value to Outlet Posting Amount(B)
  // AND a small remainder to AR Posting Amount(C) (a normal redemption split, not a write-off),
  // so the earlier "B and C both posted -> EXPIRED_RECOGNIZED" heuristic wrongly reclassified
  // hundreds of genuine USES as expiry write-offs and inflated the Expired->Rev column.
  //
  // Used Date is NOT required to detect closure: many older rows close a certificate via
  // a year-end bulk "revenue conversion" (Guide item 7) that posts Outlet Posting Amount(B)
  // but leaves Used Date blank, instead dropping a free-text note + embedded date into the
  // Bill No. column (e.g. "To Revenue on 20211231", "Recognise to Misc Rev on 171229").
  // finalizeRecord() below recovers a usable terminal date from that note so the point-in-time
  // balance reconstruction (effectiveStatusAsOf) correctly treats these as closed.
  // Coerce any raw cell value to an uppercase string — text columns (Status, Payment Type, Bill
  // No.) can arrive as a number/boolean/Date from SheetJS (e.g. a bare numeric check or room
  // number in Bill No.), which would blow up a direct .toUpperCase() call.
  function upper(v) { return (v === null || v === undefined ? '' : String(v)).toUpperCase(); }

  function deriveStatus(mapped) {
    var rawStatus = upper(mapped.status);
    var rawPayment = upper(mapped.paymentType);
    var rawDetail = upper(mapped.certificateDetail).trim();
    var isVoidSignal = rawStatus === 'VOID' || rawPayment === 'VOID' || rawDetail === 'VOID';
    var b = mapped.outletPostingAmountB;
    var hasOutletRevenue = b !== null && b !== undefined && b > 0; // real service delivered
    var cVal = mapped.arPostingAmountC || 0;
    var hasCposting = mapped.arPostingAmountC !== null && mapped.arPostingAmountC !== undefined && cVal !== 0;
    var bcSum = (b || 0) + cVal;
    var reconciled = mapped.amountA !== null && Math.abs(bcSum - mapped.amountA) <= 1;
    // A pure year-end write-off carries only a recognition note ("To Revenue on DATE") in Bill
    // No.; an actual redemption carries a check number (CHK…) — often alongside that same note
    // when a grace/late use is booked to revenue at year-end. The check number is the reliable
    // "a customer really used this" signal.
    var billUpper = upper(mapped.billNo);
    var recognitionNote = /TO\s*REVENUE|MISC\s*REV|RECOGNI[SZ]E|TO\s*MISC/.test(billUpper);
    var hasCheckNumber = /CHK\s*\d/.test(billUpper);

    if (isVoidSignal) {
      var voidReason = (mapped.amountA === 0) ? CertApp.VOID_REASON.REFUND : CertApp.VOID_REASON.MISPRINT;
      return { status: CertApp.STATUS.VOID, voidReason: voidReason, needsReview: false };
    }

    // Strongest redemption signal: a check number in the bill = a customer actually redeemed it.
    // It overrides an ambiguous/blank/"EXPIRED" source status AND a co-located "To Revenue"/"Misc
    // Rev" recognition note (a grace/late use is booked to revenue at year-end but is still a
    // redemption, not a write-off). finalizeRecord promotes it to GRACE_USED if it carried a
    // misc-income penalty (C > 0) and was used after expiry; otherwise it's a plain USED.
    if (hasCheckNumber && (hasOutletRevenue || mapped.usedDate)) return { status: CertApp.STATUS.USED, voidReason: null, needsReview: false };

    // Explicit source Status wins next. "USED" is a real redemption; "EXPIRED" with money already
    // posted is a completed write-off, but with nothing posted yet it's still outstanding (virtual
    // EXPIRED_PENDING).
    if (rawStatus === 'USED') return { status: CertApp.STATUS.USED, voidReason: null, needsReview: false };
    if (rawStatus === 'EXPIRED') {
      if (hasOutletRevenue || hasCposting) return { status: CertApp.STATUS.EXPIRED_RECOGNIZED, voidReason: null, needsReview: false };
      return { status: CertApp.STATUS.ACTIVE, voidReason: null, needsReview: false };
    }

    // Blank / unrecognized source status — infer from what was posted. A real redemption (outlet
    // revenue posted with an actual Used Date) is a USE; only a recognition note without any
    // redemption evidence is a genuine year-end write-off.
    if (hasOutletRevenue && mapped.usedDate) return { status: CertApp.STATUS.USED, voidReason: null, needsReview: false };
    if (recognitionNote) return { status: CertApp.STATUS.EXPIRED_RECOGNIZED, voidReason: null, needsReview: false };
    if (hasOutletRevenue) return { status: CertApp.STATUS.USED, voidReason: null, needsReview: false };
    if (hasCposting && reconciled) return { status: CertApp.STATUS.EXPIRED_RECOGNIZED, voidReason: null, needsReview: false };
    if (mapped.usedDate) {
      // Nothing posted but a Used Date was recorded anyway — treat defensively as closed.
      return { status: CertApp.STATUS.USED, voidReason: null, needsReview: true };
    }
    return { status: CertApp.STATUS.ACTIVE, voidReason: null, needsReview: false }; // still outstanding (raw EXPIRED with nothing posted shows as virtual EXPIRED_PENDING at read time)
  }

  // Recover a usable terminal date from a free-text Bill No. note when the source row
  // closed a certificate without ever populating Used Date (see deriveStatus above).
  // Tries an embedded YYYYMMDD or YYMMDD run before falling back to expiryDate.
  function extractDateFromNote(text, fallbackExpiryDate) {
    if (text) {
      text = String(text); // Bill No. may arrive as a bare number
      var m8 = text.match(/(20\d{2})(\d{2})(\d{2})/);
      if (m8 && m8[2] >= '01' && m8[2] <= '12' && m8[3] >= '01' && m8[3] <= '31') {
        return m8[1] + '-' + m8[2] + '-' + m8[3];
      }
      var m6 = text.match(/\b(\d{2})(\d{2})(\d{2})\b/);
      if (m6 && m6[2] >= '01' && m6[2] <= '12' && m6[3] >= '01' && m6[3] <= '31') {
        var century = (parseInt(m6[1], 10) <= 50) ? '20' : '19';
        return century + m6[1] + '-' + m6[2] + '-' + m6[3];
      }
    }
    return fallbackExpiryDate || null;
  }

  function addYears(isoDate, years) {
    var d = new Date(isoDate);
    d.setFullYear(d.getFullYear() + years);
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  // GC is valid 5 years from issue; SC nominally 1 year (late use up to 5y still possible
  // at a reduced value — see accounting.js).
  function defaultExpiryDate(issuedDate, category) {
    return addYears(issuedDate, CertApp.accounting.isGiftCertificate(category) ? 5 : 1);
  }

  function hasVoidSignal(mapped) {
    var st = (mapped.status || '').toUpperCase();
    var pay = (mapped.paymentType || '').toUpperCase();
    var det = (mapped.certificateDetail || '').trim().toUpperCase();
    return st === 'VOID' || pay === 'VOID' || det === 'VOID';
  }

  // An unissued pre-printed certificate stub: it carries a certificate number but has NO issue
  // date, NO amount, NO usage, NO posting, and NO void signal. The source ledgers keep these
  // blank rows as placeholders for the next numbers to be sold (e.g. Pulse8 004001–004057),
  // often with a nonsense 1900-12-30 expiry and a stale "USED" status. Importing them would
  // inflate counts and — because that 1900 expiry is long past — surface them as bogus
  // "expired" entries under an ACTIVE filter and in the Expiry Queue. Rows that DO carry a void
  // signal are kept: a voided/misprinted certificate is a real event even with cleared amounts.
  function isUnissuedStub(mapped) {
    var hasAmount = mapped.amountA !== null && mapped.amountA !== undefined && mapped.amountA !== 0;
    if (mapped.issuedDate || hasAmount || mapped.usedDate) return false;
    if (mapped.outletPostingAmountB || mapped.arPostingAmountC) return false;
    if (hasVoidSignal(mapped)) return false;
    return true;
  }

  // Group raw rows by category+certificateNo and collapse clean +/- reversal pairs.
  // Ambiguous groups (>2 rows, or 2 rows that don't net to zero) are passed through
  // untouched with needsReview=true rather than guessed.
  function dedupeReversalPairs(rawRecords, warnings) {
    var groups = {};
    rawRecords.forEach(function (r) {
      var key = r.category + '::' + (r.certificateNo || ('NOCERTNO_' + Math.random()));
      (groups[key] = groups[key] || []).push(r);
    });

    var out = [];
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      if (group.length === 1) {
        out.push(group[0]);
        return;
      }
      if (group.length === 2) {
        var sum = (group[0].amountA || 0) + (group[1].amountA || 0);
        if (Math.abs(sum) <= 1) {
          var primary = group[0].amountA >= group[1].amountA ? group[0] : group[1];
          var secondary = primary === group[0] ? group[1] : group[0];
          primary.status = CertApp.STATUS.VOID;
          primary.voidReason = CertApp.VOID_REASON.IMPORTED_REVERSAL;
          primary._reversalPairedWith = secondary.sourceRowRef;
          out.push(primary);
          return;
        }
      }
      // >2 rows, or a 2-row group that doesn't net to zero: import all, flag for review
      warnings.push('Certificate No "' + (group[0].certificateNo || '(blank)') + '" [' + group[0].category +
        '] has ' + group.length + ' rows that could not be auto-reconciled — flagged for manual review.');
      group.forEach(function (r) { r.needsReview = true; out.push(r); });
    });
    return out;
  }

  function finalizeRecord(mapped) {
    var derived = deriveStatus(mapped);
    var now = CertApp.nowIso();
    if (!mapped.expiryDate && mapped.issuedDate) {
      mapped.expiryDate = defaultExpiryDate(mapped.issuedDate, mapped.category);
    }
    // A closed status with no Used Date means the source closed it via a bulk revenue-
    // conversion note (see deriveStatus) — recover a terminal date so point-in-time balance
    // reconstruction doesn't mistake it for still-outstanding.
    var closedStatuses = [CertApp.STATUS.USED, CertApp.STATUS.EXPIRED_RECOGNIZED, CertApp.STATUS.GRACE_USED];
    var effectiveUsedDate = mapped.usedDate ||
      (closedStatuses.indexOf(derived.status) !== -1 ? extractDateFromNote(mapped.billNo, mapped.expiryDate) : null);

    // Grace-use sub-classification (timing based, not an exact 90/10 amount): a redemption that
    // (a) carries an AR Posting misc-income penalty (C > 0) and (b) was redeemed AFTER the
    // certificate's expiry date was used within the post-expiry grace window — so promote USED to
    // GRACE_USED. The penalty is "up to 10%", not necessarily exactly 10%, so the timing is the
    // reliable signal, not the amount.
    var status = derived.status;
    var graceUseDate = null;
    if (status === CertApp.STATUS.USED && (mapped.arPostingAmountC || 0) > 0 &&
      effectiveUsedDate && mapped.expiryDate && effectiveUsedDate > mapped.expiryDate) {
      status = CertApp.STATUS.GRACE_USED;
      graceUseDate = effectiveUsedDate;
    }

    return {
      id: CertApp.uuid(),
      category: mapped.category,
      certificateNo: mapped.certificateNo || null,
      issuedDate: mapped.issuedDate || null,
      expiryDate: mapped.expiryDate || null,
      status: status,
      dc: mapped.dc || null,
      amountA: mapped.amountA !== undefined ? mapped.amountA : null,
      paymentType: mapped.paymentType || null,
      certificateDetail: mapped.certificateDetail || null,
      usedDate: effectiveUsedDate || null,
      outletPostingAmountB: mapped.outletPostingAmountB !== undefined ? mapped.outletPostingAmountB : null,
      miscRevPostingDate: mapped.miscRevPostingDate || null,
      arPostingAmountC: mapped.arPostingAmountC !== undefined ? mapped.arPostingAmountC : null,
      // Normalize Bill No. to a string (some source rows carry a bare numeric check/room number)
      // so every downstream string operation (search, reclassify's .toUpperCase()) is safe.
      billNo: (mapped.billNo === null || mapped.billNo === undefined || mapped.billNo === '') ? null : String(mapped.billNo),
      sellerOperaId: null,
      voidReason: mapped.voidReason || derived.voidReason || null,
      refundDate: null,
      graceUseDate: graceUseDate,
      needsReview: !!mapped.needsReview || !!derived.needsReview,
      sourceRowRef: mapped.sourceRowRef || null,
      createdAt: now,
      updatedAt: now
    };
  }

  // Main entry point: File -> { records, report }
  function importFile(file) {
    var warnings = [];
    return readFileAsArrayBuffer(file).then(function (arrayBuffer) {
      var workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });
      var importer = detectImporter(workbook);
      if (!importer) {
        throw new Error('Unrecognized workbook — no known ledger sheet found (expected "원장(New)", "SPA", "PULSE8", "50,000(원장)", or "100,000(원장)").');
      }
      var result = importer.importWorkbook(workbook, file.name);
      warnings = warnings.concat(result.warnings);

      var realRecords = result.records.filter(function (r) { return !isUnissuedStub(r); });
      var skippedStubs = result.records.length - realRecords.length;
      if (skippedStubs > 0) {
        warnings.push('Skipped ' + skippedStubs + ' unissued placeholder certificate row(s) (blank issue date & amount, no void signal).');
      }

      var deduped = dedupeReversalPairs(realRecords, warnings);
      var records = deduped.map(finalizeRecord);
      var needsReviewCount = records.filter(function (r) { return r.needsReview; }).length;

      var report = {
        id: CertApp.uuid(),
        fileName: file.name,
        importedAt: CertApp.nowIso(),
        sheetsProcessed: workbook.SheetNames,
        rowsRead: result.records.length,
        rowsImported: records.length,
        rowsFlaggedNeedsReview: needsReviewCount,
        warnings: warnings,
        // Lets a specific import run be undone later (see certificateWorkflow.undoImportBatch)
        // without touching records from any other import.
        recordIds: records.map(function (r) { return r.id; })
      };

      return { records: records, report: report };
    });
  }

  return { importFile: importFile, deriveStatus: deriveStatus, dedupeReversalPairs: dedupeReversalPairs };
})();
