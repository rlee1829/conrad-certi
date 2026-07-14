/* Gift Certificate (.xlsb) importer: 50,000(원장) / 100,000(원장) sheets */
window.CertApp = window.CertApp || {};
CertApp.importGiftCertificate = (function () {
  var mapper = CertApp.importMapper;

  var SHEET_CATEGORY = {
    '50,000(원장)': CertApp.CATEGORY.GC_50000,
    '100,000(원장)': CertApp.CATEGORY.GC_100000
  };

  // Scan the first N rows for the header row (the one whose mapped fields include
  // the required minimum set) rather than hardcoding a row index — resilient to
  // stray title/date-filter rows above the real header.
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

  function extractSheetRecords(worksheet, category, sheetName, fileName, warnings) {
    var rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: null });
    var headerRowIdx = findHeaderRowIndex(rows, warnings);
    var headerIndex = mapper.buildHeaderIndex(rows[headerRowIdx], warnings);
    var records = [];

    for (var r = headerRowIdx + 1; r < rows.length; r++) {
      var row = rows[r];
      if (!row) continue;
      var ctx = fileName + ' / ' + sheetName + ' row ' + (r + 1);
      var mapped = mapper.mapRow(row, headerIndex, warnings, ctx);
      // Skip placeholder/empty template rows and trailing summary/total rows (a real
      // Certificate No. is always alphanumeric, e.g. "CG503996" — never a bare count/sum
      // that landed in that column position because a "TOTAL" row misaligns columns).
      if (!mapper.isPlausibleCertificateNo(mapped.certificateNo)) {
        if (mapped.amountA) {
          warnings.push('Skipped non-certificate row (likely a trailing summary/total row) with Amount ' + mapped.amountA + ' at ' + ctx);
        }
        continue;
      }

      mapped.category = category;
      mapped.certificateDetail = null; // Gift Certificates have no product description
      mapped.sourceRowRef = { file: fileName, sheet: sheetName, rowNumber: r + 1 };
      records.push(mapped);
    }
    return records;
  }

  // Returns { records: [...], warnings: [...] }
  function importWorkbook(workbook, fileName) {
    var warnings = [];
    var records = [];

    Object.keys(SHEET_CATEGORY).forEach(function (sheetName) {
      var ws = workbook.Sheets[sheetName];
      if (!ws) {
        warnings.push('Expected sheet "' + sheetName + '" not found in ' + fileName + ' — skipped.');
        return;
      }
      var category = SHEET_CATEGORY[sheetName];
      var sheetRecords = extractSheetRecords(ws, category, sheetName, fileName, warnings);
      records = records.concat(sheetRecords);
    });

    return { records: records, warnings: warnings };
  }

  return { importWorkbook: importWorkbook, SHEET_CATEGORY: SHEET_CATEGORY };
})();
