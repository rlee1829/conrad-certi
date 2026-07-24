/* Data-integrity / reconciliation checker (pure). Scans every certificate against a set of
   high-confidence rules and returns the records that violate each one, so the systematic
   mis-bookings we used to hunt by hand (write-off amounts sitting in 매출 instead of 잡이익,
   refunds with no refund date, outstanding certs carrying resolution data, ...) surface with one
   click. Each rule is deliberately narrow to avoid drowning the real problems in noise —
   miscRevPostingDate being blank on old imports, for instance, is common and NOT flagged.

   run(records) -> [{ id, certificateNo, category, code, severity, currentValues }]
   severity: 'error' (breaks reconciliation / contradictory) | 'warn' (missing info, still usable).
   The human-readable label per code comes from i18n key 'ic.check.<code>' (see i18n.js). */
window.CertApp = window.CertApp || {};
CertApp.integrityCheck = (function () {
  var STATUS = CertApp.STATUS, VOID_REASON = CertApp.VOID_REASON;
  function num(v) { return v || 0; }
  function acc() { return CertApp.accounting; }

  // Each rule: { code, severity, test(rec) -> bool }. test() returns true when the record IS a
  // violation of that rule.
  var RULES = [
    { code: 'variance_nonzero', severity: 'error', test: function (r) {
      // Only a RESOLVED certificate must reconcile A = B + C + refund. An outstanding (ACTIVE)
      // cert's face value is legitimately unallocated, so variance = A there is expected, not a
      // break. Plain/misprint voids are out of circulation with no P&L, so they're excluded too;
      // a REFUND void, though, must reconcile (penalty + refunded cash = face).
      var mustReconcile = r.status === STATUS.USED || r.status === STATUS.GRACE_USED ||
        r.status === STATUS.EXPIRED_RECOGNIZED ||
        (r.status === STATUS.VOID && r.voidReason === VOID_REASON.REFUND);
      // Sub-won tolerance: some imported amounts carry float noise (e.g. 418000.00000000006),
      // which is a harmless display artifact, not a real discrepancy. All genuine amounts are
      // whole won, so anything at or above half a won is a true reconciliation break.
      return mustReconcile && Math.abs(acc().varianceABC(r)) >= 0.5;
    } },
    { code: 'recognized_revenue', severity: 'error', test: function (r) {
      // 만료 인식(잡이익 전환)은 100% 잡이익(C)이어야 함 — 매출(B)에 금액이 있으면 오분개.
      return r.status === STATUS.EXPIRED_RECOGNIZED && num(r.outletPostingAmountB) > 0;
    } },
    { code: 'refund_revenue', severity: 'error', test: function (r) {
      // 환불 처리 건에 매출(B)이 잡혀 있으면 안 됨 (서비스 미제공).
      return r.status === STATUS.VOID && r.voidReason === VOID_REASON.REFUND && num(r.outletPostingAmountB) > 0;
    } },
    { code: 'used_no_date', severity: 'error', test: function (r) {
      return (r.status === STATUS.USED || r.status === STATUS.GRACE_USED) && !r.usedDate;
    } },
    { code: 'active_dirty', severity: 'error', test: function (r) {
      // 유효(ACTIVE)인데 사용/환불/잡이익 등 해소 정보가 남아 있음.
      return r.status === STATUS.ACTIVE &&
        (!!r.usedDate || !!r.refundDate || !!r.graceUseDate || num(r.arPostingAmountC) > 0 || num(r.refundAmount) > 0);
    } },
    { code: 'refund_no_date', severity: 'warn', test: function (r) {
      return r.status === STATUS.VOID && r.voidReason === VOID_REASON.REFUND && !r.refundDate;
    } },
    { code: 'active_no_amount', severity: 'warn', test: function (r) {
      // 발행된 유효 증서인데 금액(A)이 없음 (미발행 스텁이 아니라 실제 발행일이 있는 경우만).
      return r.status === STATUS.ACTIVE && !!r.issuedDate && !(num(r.amountA) > 0);
    } }
  ];

  function fmt(v) {
    if (v === null || v === undefined || v === '') return '–';
    if (typeof v === 'number') return v.toLocaleString('ko-KR');
    return String(v);
  }
  // Compact "A=… B=… C=… D=… 차액=…" snapshot so a finding is understandable without opening the
  // record; dates are appended only when relevant to the flagged rule set.
  function snapshot(r) {
    return 'A=' + fmt(r.amountA) + ' · 매출(B)=' + fmt(r.outletPostingAmountB) +
      ' · 잡이익(C)=' + fmt(r.arPostingAmountC) + ' · 환불액(D)=' + fmt(r.refundAmount) +
      ' · 차액=' + fmt(CertApp.accounting.varianceABC(r));
  }

  function run(records) {
    records = records || CertApp.cache.certificates;
    var findings = [];
    records.forEach(function (r) {
      RULES.forEach(function (rule) {
        var ok = false;
        try { ok = rule.test(r); } catch (e) { ok = false; }
        if (ok) {
          findings.push({
            id: r.id, certificateNo: r.certificateNo, category: r.category,
            code: rule.code, severity: rule.severity, currentValues: snapshot(r)
          });
        }
      });
    });
    // errors first, then by code, then cert number — the most serious rise to the top.
    findings.sort(function (a, b) {
      if (a.severity !== b.severity) return a.severity === 'error' ? -1 : 1;
      if (a.code !== b.code) return a.code < b.code ? -1 : 1;
      return String(a.certificateNo).localeCompare(String(b.certificateNo));
    });
    return findings;
  }

  function codes() { return RULES.map(function (r) { return { code: r.code, severity: r.severity }; }); }

  return { run: run, codes: codes };
})();
