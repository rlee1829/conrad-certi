/* Reporting engine: pure functions over CertApp.cache.certificates, mirrors the
   payroll app's calculateForecast() pattern (calc separated from rendering). */
window.CertApp = window.CertApp || {};
CertApp.calculationEngine = (function () {

  function dayBefore(isoDate) {
    var d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() - 1);
    var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
    return y + '-' + m + '-' + day;
  }

  // An empty start or end is treated as unbounded on that side (period filters default to
  // cleared/"show everything" — see viewOverview.js / viewCertificateList.js).
  function inRange(dateStr, start, end) {
    if (!dateStr) return false;
    if (start && dateStr < start) return false;
    if (end && dateStr > end) return false;
    return true;
  }

  // Point-in-time reconstruction: was this certificate still "outstanding" as of asOfDate?
  // Never restates a closed period when reprinted later — see plan.md for rationale.
  function effectiveStatusAsOf(record, asOfDate) {
    if (record.voidReason === CertApp.VOID_REASON.MISPRINT) return 'EXCLUDED';
    if (!record.issuedDate || record.issuedDate > asOfDate) return 'EXCLUDED';
    var terminalDate = record.refundDate || record.usedDate || record.graceUseDate;
    if (terminalDate) return terminalDate > asOfDate ? 'ACTIVE' : record.status;
    // No terminal date recorded. Imported VOID rows never carry a void/refund date, but a
    // voided certificate is NOT part of the outstanding balance — treat it as VOID as-of any
    // date rather than letting a dateless void linger as ACTIVE forever (which double-counted
    // e.g. Pulse8 001531–001540: zero-value voids that inflated the outstanding qty by 10 while
    // the amount still reconciled). Genuinely open records stay ACTIVE.
    return record.status === CertApp.STATUS.VOID ? CertApp.STATUS.VOID : 'ACTIVE';
  }

  function emptyBucket() {
    return {
      openingQty: 0, openingAmt: 0,
      issuedQty: 0, issuedAmt: 0,
      usedQty: 0, usedAmt: 0,
      expiredRevQty: 0, expiredRevAmt: 0,
      voidQty: 0, voidAmt: 0,
      endingQty: 0, endingAmt: 0
    };
  }

  // computeSummary(periodStart, periodEnd) -> { [category]: bucket, ... }
  // periodStart/periodEnd may be '' (cleared) — an empty start means "no meaningful Opening
  // Balance" (nothing before an undefined start, so that bucket stays 0); an empty end means
  // "as of today" for Ending Balance, which is the sensible reading of an open-ended period.
  function computeSummary(periodStart, periodEnd, records) {
    records = records || CertApp.cache.certificates;
    var summary = {};
    Object.keys(CertApp.CATEGORY).forEach(function (cat) { summary[cat] = emptyBucket(); });
    var openingAsOf = periodStart ? dayBefore(periodStart) : null;
    var endingAsOf = periodEnd || CertApp.today();

    records.forEach(function (r) {
      var bucket = summary[r.category];
      if (!bucket) return;
      var amt = r.amountA || 0;

      if (openingAsOf && effectiveStatusAsOf(r, openingAsOf) === 'ACTIVE') {
        bucket.openingQty += 1; bucket.openingAmt += amt;
      }
      if (effectiveStatusAsOf(r, endingAsOf) === 'ACTIVE') {
        bucket.endingQty += 1; bucket.endingAmt += amt;
      }
      if (inRange(r.issuedDate, periodStart, periodEnd) && effectiveStatusAsOf(r, endingAsOf) !== CertApp.STATUS.VOID) {
        bucket.issuedQty += 1; bucket.issuedAmt += amt;
      }
      if (inRange(r.usedDate, periodStart, periodEnd) &&
        (r.status === CertApp.STATUS.USED || r.status === CertApp.STATUS.EXPIRED_RECOGNIZED || r.status === CertApp.STATUS.GRACE_USED)) {
        bucket.usedQty += 1; bucket.usedAmt += amt;
        if (r.status === CertApp.STATUS.EXPIRED_RECOGNIZED) {
          bucket.expiredRevQty += 1; bucket.expiredRevAmt += amt;
        }
      }
      if (inRange(r.refundDate, periodStart, periodEnd) && r.voidReason === CertApp.VOID_REASON.REFUND) {
        bucket.voidQty += 1; bucket.voidAmt += amt;
      }
    });

    return summary;
  }

  // Virtual EXPIRED_PENDING queue: ACTIVE certs whose expiryDate has passed asOfDate,
  // never physically stored — see schema.js VIRTUAL_STATUS.
  function computeExpiryQueue(asOfDate, records) {
    records = records || CertApp.cache.certificates;
    asOfDate = asOfDate || CertApp.today();
    return records
      // Require a real issue date AND a positive face value: an unissued pre-printed stub
      // (blank issue date, 0 amount, a nonsense 1900-12-30 expiry) is not a genuine pending
      // expiry and must never surface here — a safety net independent of the import-time skip
      // (see importPipeline.js isUnissuedStub) so stale data already in the DB can't pollute
      // the queue either.
      .filter(function (r) {
        return r.status === CertApp.STATUS.ACTIVE && r.issuedDate && r.amountA > 0 &&
          r.expiryDate && r.expiryDate < asOfDate;
      })
      .map(function (r) {
        var split = CertApp.accounting.computeWriteOffSplit(r.amountA || 0, r.category);
        return {
          record: r,
          daysOverdue: Math.round((new Date(asOfDate) - new Date(r.expiryDate)) / 86400000),
          previewOutletPostingAmountB: split.outletPostingAmountB,
          previewArPostingAmountC: split.arPostingAmountC
        };
      })
      .sort(function (a, b) { return a.record.expiryDate < b.record.expiryDate ? -1 : 1; });
  }

  // computePostingSummary(periodStart, periodEnd) -> GL posting lines for month-end close: the
  // P&L movements (revenue recognized, misc income by kind, cash refunded) plus issuance, each
  // placed in the period by its own accounting date. Reads misc income straight from the ledger
  // (see syncMiscRevenueLedger) so 잡이익 전환/환원/위약금 net out exactly as posted, and adds a
  // per-category breakdown of the revenue/misc/refund lines for a GL-ready table.
  function computePostingSummary(periodStart, periodEnd, records, miscRevenue) {
    records = records || CertApp.cache.certificates;
    miscRevenue = miscRevenue || CertApp.cache.miscRevenue;
    function line() { return { qty: 0, amt: 0 }; }
    var out = {
      issued: line(), revenue: line(), refundCash: line(),
      writeOff: line(), refundPenalty: line(), graceReversal: line(), gracePayout: line(),
      miscIncomeNet: 0,
      byCategory: {}
    };
    Object.keys(CertApp.CATEGORY).forEach(function (c) {
      out.byCategory[c] = { revenue: 0, miscIncome: 0, refundCash: 0 };
    });

    records.forEach(function (r) {
      var cat = out.byCategory[r.category];
      // 발행: face value entering circulation in the period (misprints never circulated).
      if (inRange(r.issuedDate, periodStart, periodEnd) && r.voidReason !== CertApp.VOID_REASON.MISPRINT) {
        out.issued.qty += 1; out.issued.amt += (r.amountA || 0);
      }
      // 매출 인식: real revenue posted to Outlet(B) when a cert is used in the period.
      if (inRange(r.usedDate, periodStart, periodEnd) &&
        (r.status === CertApp.STATUS.USED || r.status === CertApp.STATUS.GRACE_USED)) {
        var b = r.outletPostingAmountB || 0;
        out.revenue.qty += 1; out.revenue.amt += b;
        if (cat) cat.revenue += b;
      }
      // 환불 현금: cash handed back in the period (penalty refund or partly-spent balance refund).
      if (inRange(r.refundDate, periodStart, periodEnd) && (r.refundAmount || 0) > 0) {
        out.refundCash.qty += 1; out.refundCash.amt += (r.refundAmount || 0);
        if (cat) cat.refundCash += (r.refundAmount || 0);
      }
    });

    // 잡이익: taken from the ledger by entry date, so each posting (write-off / refund penalty /
    // grace payout+reversal) lands in the period it was actually booked.
    var TYPE_LINE = { WRITE_OFF: 'writeOff', REFUND_PENALTY: 'refundPenalty', GRACE_USE_REVERSAL: 'graceReversal', GRACE_USE_PAYOUT: 'gracePayout' };
    miscRevenue.forEach(function (e) {
      if (!inRange(e.entryDate, periodStart, periodEnd)) return;
      var amt = e.amount || 0;
      out.miscIncomeNet += amt;
      var key = TYPE_LINE[e.type];
      if (key) { out[key].qty += 1; out[key].amt += amt; }
      var cat = out.byCategory[e.category];
      if (cat) cat.miscIncome += amt;
    });

    return out;
  }

  return {
    effectiveStatusAsOf: effectiveStatusAsOf,
    computeSummary: computeSummary,
    computeExpiryQueue: computeExpiryQueue,
    computePostingSummary: computePostingSummary,
    dayBefore: dayBefore
  };
})();
