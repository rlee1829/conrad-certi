/* Pure accounting helpers.

   Business rules:
   - Both Gift Certificates and Service Certificates that go unclaimed get written off the
     same way: 100% to AR Posting Amount(C), misc income — no certificate family posts
     write-off money to Outlet Posting Amount(B) (real revenue), since nothing was ever
     delivered against it (see computeWriteOffSplit). Gift Certificates are valid 5 years from
     issue with no reduction before that; Service Certificates are nominal 1-year validity, not
     recognized immediately at that mark — it just sits unprocessed (virtual EXPIRED_PENDING)
     until either:
       (a) a customer redeems it late, any time before the year-end sweep — this is a normal
           USE, just posted at a reduced 90% Outlet Posting(B) / 10% AR Posting(C) split
           (see computeLateUseSplit), because real service was still delivered but at a
           lateness penalty; or
       (b) nobody claims it and the year-end batch write-off posts the full 100% to AR
           Posting Amount(C) as misc income.
     Grace Use (Service Certificates only — see graceUseExpired in certificateWorkflow.js,
     Gift Certificates never become eligible) can reverse 90% of an already-recognized misc
     income balance back into real revenue up to 5 years from issue (computeLateUseSplit
     again), permanently keeping only the 10% penalty as misc income.
*/
window.CertApp = window.CertApp || {};
CertApp.accounting = (function () {

  function isGiftCertificate(category) {
    return category === CertApp.CATEGORY.GC_50000 || category === CertApp.CATEGORY.GC_100000;
  }

  // Year-end / administrative write-off split for a certificate that expired unclaimed —
  // always 100% to AR Posting(C), misc income, for every certificate family. Nothing was ever
  // delivered against an unclaimed certificate, so none of it is real outlet revenue.
  function computeWriteOffSplit(amountA, category) {
    return { outletPostingAmountB: 0, arPostingAmountC: amountA };
  }

  // The 90/10 split used both for (a) a late-but-pre-write-off SC use, and (b) the Grace Use
  // reversal math after an SC cert was already written off. Remainder method guarantees
  // outletPostingAmountB + arPostingAmountC === amountA exactly (no float drift).
  function computeLateUseSplit(amountA) {
    var outletPostingAmountB = Math.round(amountA * 0.9);
    var arPostingAmountC = amountA - outletPostingAmountB;
    return { outletPostingAmountB: outletPostingAmountB, arPostingAmountC: arPostingAmountC };
  }

  // Pre-expiry refund with a retained penalty (e.g. a Pulse 8 10-pack where the guest used some
  // passes and asks for the rest back before expiry). Mirror image of computeLateUseSplit: no
  // service was delivered against these, so nothing goes to real outlet revenue — only the
  // penalty is booked to AR Posting(C) as misc income, and the remainder leaves the ledger as
  // refunded cash. amountA is deliberately NOT zeroed (the old Excel hack): the face value stays
  // so the ledger still shows what was sold, and the cash paid back is the derived remainder
  // (refundAmount below). Remainder method keeps penalty + refund === amountA exactly.
  var REFUND_PENALTY_RATE = 0.1;
  function computeRefundSplit(amountA) {
    var a = amountA || 0;
    var penalty = Math.round(a * REFUND_PENALTY_RATE);
    return { outletPostingAmountB: 0, arPostingAmountC: penalty, refundAmount: a - penalty };
  }

  function varianceABC(record) {
    return (record.amountA || 0) - (record.outletPostingAmountB || 0) - (record.arPostingAmountC || 0);
  }

  // Cash actually paid back on a refund-void — derived, never stored (same rule as varianceABC /
  // usedAmountBC). It IS the record's 차이(A-B-C): the part of the face value that left as cash
  // rather than being recognized as revenue (B) or misc income (C).
  function refundAmount(record) {
    return varianceABC(record);
  }

  // Total value actually consumed when a certificate is used: real revenue (B) + misc income
  // portion (C). The original ledger template mislabeled this column "(B)-(C)" even though its
  // own formula was really B+C — export now uses the corrected "(B)+(C)" header to match.
  function usedAmountBC(record) {
    return (record.outletPostingAmountB || 0) + (record.arPostingAmountC || 0);
  }

  return {
    isGiftCertificate: isGiftCertificate,
    computeWriteOffSplit: computeWriteOffSplit,
    computeLateUseSplit: computeLateUseSplit,
    REFUND_PENALTY_RATE: REFUND_PENALTY_RATE,
    computeRefundSplit: computeRefundSplit,
    refundAmount: refundAmount,
    varianceABC: varianceABC,
    usedAmountBC: usedAmountBC
  };
})();
