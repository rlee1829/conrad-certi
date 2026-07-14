/* Header normalization + alias mapping shared by both importers */
window.CertApp = window.CertApp || {};
CertApp.importMapper = (function () {

  function normalizeHeader(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[\r\n\s]+/g, '').toLowerCase();
  }

  // normalized-header -> CertificateRecord field name
  var HEADER_ALIASES = {
    'no.': 'sourceNo',
    'issueddate': 'issuedDate',
    'expirydate': 'expiryDate',
    'status': 'status',
    'certificateno': 'certificateNo',
    'd/c': 'dc',
    'amount(a)': 'amountA',
    'paymenttype': 'paymentType',
    'certificatedetail': 'certificateDetail',
    'useddate': 'usedDate',
    'outletpostingamount(b)': 'outletPostingAmountB',
    'miscrevpostingdate': 'miscRevPostingDate',
    'arpostingamount(c)': 'arPostingAmountC',
    'variance(a)-(b)-(c)': '_variance', // derived elsewhere, ignored on import
    'usedamount(b)-(c)': '_usedAmount', // derived elsewhere, ignored on import
    'billno./roomno.': 'billNo'
  };

  var DATE_FIELDS = { issuedDate: 1, expiryDate: 1, usedDate: 1, miscRevPostingDate: 1 };
  var NUMBER_FIELDS = { amountA: 1, outletPostingAmountB: 1, arPostingAmountC: 1 };

  // Excel serial date epoch fallback (1899-12-30) for the rare case a date cell
  // arrives as a raw number instead of a JS Date (cellDates:true normally prevents this).
  function excelSerialToDate(n) {
    var utcMs = Math.round((n - 25569) * 86400 * 1000);
    return new Date(utcMs);
  }

  function toIsoDate(d) {
    if (isNaN(d.getTime())) return null;
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  function parseFlexibleDate(v, warnings, ctx) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return toIsoDate(v);
    if (typeof v === 'number') return toIsoDate(excelSerialToDate(v));
    if (typeof v === 'string') {
      var trimmed = v.trim();
      if (!trimmed || trimmed === '-') return null;
      var parsed = new Date(trimmed);
      if (!isNaN(parsed.getTime())) return toIsoDate(parsed);
      if (warnings) warnings.push('Unparseable date "' + v + '"' + (ctx ? ' at ' + ctx : ''));
      return null;
    }
    return null;
  }

  function parseFlexibleNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      var cleaned = v.replace(/[,₩\s]/g, '');
      if (!cleaned || cleaned === '-') return null;
      var n = Number(cleaned);
      return isNaN(n) ? null : n;
    }
    return null;
  }

  function normalizeStatus(raw) {
    if (raw === null || raw === undefined) return '';
    var s = String(raw).trim().toUpperCase();
    return s;
  }

  // Build header index map: normalized-header -> column index, from a raw header row array
  function buildHeaderIndex(headerRow, warnings) {
    var idx = {};
    for (var c = 0; c < headerRow.length; c++) {
      var norm = normalizeHeader(headerRow[c]);
      if (!norm) continue;
      var field = HEADER_ALIASES[norm];
      if (field) {
        idx[field] = c;
      } else if (warnings) {
        warnings.push('Unmapped header column "' + headerRow[c] + '" (normalized: "' + norm + '")');
      }
    }
    return idx;
  }

  // Convert one raw data row (array) into a partial CertificateRecord using the header index.
  function mapRow(row, headerIndex, warnings, ctx) {
    var out = {};
    Object.keys(headerIndex).forEach(function (field) {
      if (field.charAt(0) === '_') return; // derived/ignored fields
      var col = headerIndex[field];
      var raw = row[col];
      if (DATE_FIELDS[field]) {
        out[field] = parseFlexibleDate(raw, warnings, ctx);
      } else if (NUMBER_FIELDS[field]) {
        out[field] = parseFlexibleNumber(raw);
      } else if (field === 'status') {
        out[field] = normalizeStatus(raw);
      } else {
        out[field] = (raw === undefined || raw === '') ? null : raw;
      }
    });
    return out;
  }

  // Trailing summary/total rows at the bottom of a ledger sheet (e.g. a "TOTAL" label plus
  // aggregate sums) often land a plain aggregate number in the Certificate No. column
  // position due to column misalignment on a non-data row — but that lands there as a raw
  // JS number (from a SUM formula), never as a string, so requiring the cell to be a
  // non-empty string is enough to reject it. Certificate numbers are usually an alphanumeric
  // code (e.g. "CG503996", "SC012345") but some ledgers (Pulse8) use a plain zero-padded
  // numeric string ("000001") with no letters at all — so letters are NOT required, only
  // that the value actually is a string (not a leaked numeric total).
  function isPlausibleCertificateNo(v) {
    return typeof v === 'string' && v.trim() !== '';
  }

  return {
    normalizeHeader: normalizeHeader,
    buildHeaderIndex: buildHeaderIndex,
    mapRow: mapRow,
    parseFlexibleDate: parseFlexibleDate,
    parseFlexibleNumber: parseFlexibleNumber,
    isPlausibleCertificateNo: isPlausibleCertificateNo,
    HEADER_ALIASES: HEADER_ALIASES
  };
})();
