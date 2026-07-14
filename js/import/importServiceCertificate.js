/* Service Certificate (.xlsx) importer. Two source file layouts are in use:
     - Service Certificate_*.xlsx: one interleaved "원장(New)" sheet holding FB&Rooms/Pulse8/SPA
       together, with a sheet-title like "Hotel Service Certificate Status - FB & Rooms" that
       (when present) assigns the WHOLE sheet to one category (see inferSheetWideCategory).
     - SPA & PULSE8 SVC Certificate_*.xlsx: separate "SPA" and "PULSE8" ledger sheets, each
       titled "Hotel Spa/Pulse8 Service Certificate Status", alongside "Issued "/"Used "/
       "Misc Rev" sheets that are monthly report SNAPSHOTS of rows already present in the main
       ledger sheet — importing those too would double-count, so only the known ledger sheet
       names below are ever scanned; anything else in the workbook is ignored.
   Any of these sheet names may be present in a given workbook — every one that is gets
   imported and the results merged. Category inference: sheet-title rule first (unambiguous
   for real ledger sheets), falling back to the free-text keyword rules below only for the
   interleaved legacy format where no whole-sheet title match was found. */
window.CertApp = window.CertApp || {};
CertApp.importServiceCertificate = (function () {
  var mapper = CertApp.importMapper;
  var LEDGER_SHEET_NAMES = ['원장(New)', 'SPA', 'PULSE8'];

  var KEYWORD_RULES = [
    { pattern: /spa/i, category: CertApp.CATEGORY.SC_SPA },
    { pattern: /pulse\s*8|zest|fitness|gym/i, category: CertApp.CATEGORY.SC_PULSE8 }
    // anything else falls through to SC_FB_ROOMS below
  ];

  // Current source files are one ledger sheet per certificate family — the sheet carries a
  // title like "Hotel Service Certificate Status - FB & Rooms" in one of its first few rows.
  // When that title is present and unambiguous, trust it for every row instead of guessing
  // per-row from Certificate Detail text: that keyword heuristic was built for the OLDER
  // interleaved-sheet format and produces false positives now that a plain room package name
  // can coincidentally contain a keyword (e.g. "Zest for 1pax" is an FB & Rooms package, not
  // the Pulse8 fitness club, even though "zest" matches the Pulse8 keyword rule below).
  var TITLE_CATEGORY_RULES = [
    { pattern: /pulse\s*8/i, category: CertApp.CATEGORY.SC_PULSE8 },
    { pattern: /spa/i, category: CertApp.CATEGORY.SC_SPA },
    { pattern: /fb\s*&?\s*rooms?/i, category: CertApp.CATEGORY.SC_FB_ROOMS }
  ];

  function inferSheetWideCategory(rows) {
    for (var r = 0; r < Math.min(rows.length, 5); r++) {
      var row = rows[r] || [];
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (typeof cell !== 'string') continue;
        for (var i = 0; i < TITLE_CATEGORY_RULES.length; i++) {
          if (TITLE_CATEGORY_RULES[i].pattern.test(cell)) return TITLE_CATEGORY_RULES[i].category;
        }
      }
    }
    return null;
  }

  function inferCategory(certificateDetail) {
    if (!certificateDetail) return { category: CertApp.CATEGORY.SC_FB_ROOMS, needsReview: true };
    for (var i = 0; i < KEYWORD_RULES.length; i++) {
      if (KEYWORD_RULES[i].pattern.test(certificateDetail)) {
        return { category: KEYWORD_RULES[i].category, needsReview: false };
      }
    }
    return { category: CertApp.CATEGORY.SC_FB_ROOMS, needsReview: false };
  }

  function findHeaderRowIndex(rows, warnings) {
    var required = ['certificateNo', 'amountA', 'issuedDate'];
    for (var r = 0; r < Math.min(rows.length, 10); r++) {
      var idx = mapper.buildHeaderIndex(rows[r] || [], null);
      var hasAll = required.every(function (f) { return idx.hasOwnProperty(f); });
      if (hasAll) return r;
    }
    if (warnings) warnings.push('Could not locate header row in first 10 rows; defaulting to row index 4.');
    return 4;
  }

  function extractSheetRecords(worksheet, sheetName, fileName, warnings) {
    var rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    var headerRowIdx = findHeaderRowIndex(rows, warnings);
    var headerIndex = mapper.buildHeaderIndex(rows[headerRowIdx], warnings);
    var sheetCategory = inferSheetWideCategory(rows);
    var records = [];

    for (var r = headerRowIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row) continue;
      var ctx = fileName + ' / ' + sheetName + ' row ' + (r + 1);
      var mapped = mapper.mapRow(row, headerIndex, warnings, ctx);
      // Skip placeholder/empty template rows and trailing summary/total rows (a real
      // Certificate No. is always alphanumeric, e.g. "SC012345" — never a bare count/sum
      // that landed in that column position because a "TOTAL" row misaligns columns).
      if (!mapper.isPlausibleCertificateNo(mapped.certificateNo)) {
        if (mapped.amountA) {
          warnings.push('Skipped non-certificate row (likely a trailing summary/total row) with Amount ' + mapped.amountA + ' at ' + ctx);
        }
        continue;
      }

      var inferred = sheetCategory ? { category: sheetCategory, needsReview: false } : inferCategory(mapped.certificateDetail);
      mapped.category = inferred.category;
      mapped.needsReview = inferred.needsReview;
      mapped.sourceRowRef = { file: fileName, sheet: sheetName, rowNumber: r + 1 };
      records.push(mapped);
    }
    return records;
  }

  // Returns { records: [...], warnings: [...] }
  function importWorkbook(workbook, fileName) {
    var warnings = [];
    var records = [];
    var foundAny = false;
    LEDGER_SHEET_NAMES.forEach(function (sheetName) {
      var ws = workbook.Sheets[sheetName];
      if (!ws) return;
      foundAny = true;
      records = records.concat(extractSheetRecords(ws, sheetName, fileName, warnings));
    });
    if (!foundAny) {
      warnings.push('No known Service Certificate ledger sheet (' + LEDGER_SHEET_NAMES.join(', ') + ') found in ' + fileName + ' — nothing imported.');
    }
    return { records: records, warnings: warnings };
  }

  return {
    importWorkbook: importWorkbook, LEDGER_SHEET_NAMES: LEDGER_SHEET_NAMES,
    KEYWORD_RULES: KEYWORD_RULES, TITLE_CATEGORY_RULES: TITLE_CATEGORY_RULES, inferSheetWideCategory: inferSheetWideCategory
  };
})();
