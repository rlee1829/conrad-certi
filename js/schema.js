/* CertApp schema: enums, field lists, state machine */
window.CertApp = window.CertApp || {};

CertApp.CATEGORY = {
  GC_50000: 'GC_50000',
  GC_100000: 'GC_100000',
  SC_FB_ROOMS: 'SC_FB_ROOMS',
  SC_PULSE8: 'SC_PULSE8',
  SC_SPA: 'SC_SPA'
};

CertApp.CATEGORY_LABEL = {
  GC_50000: 'Gift Certificate (50,000)',
  GC_100000: 'Gift Certificate (100,000)',
  SC_FB_ROOMS: 'Service - FB & Rooms',
  SC_PULSE8: 'Service - Pulse8',
  SC_SPA: 'Service - SPA'
};

CertApp.STATUS = {
  ACTIVE: 'ACTIVE',
  USED: 'USED',
  VOID: 'VOID',
  EXPIRED_RECOGNIZED: 'EXPIRED_RECOGNIZED',
  GRACE_USED: 'GRACE_USED'
};

// Virtual/display-only status, never stored. See calculationEngine.js
CertApp.VIRTUAL_STATUS = {
  EXPIRED_PENDING: 'EXPIRED_PENDING'
};

// Display-only relabeling for user-facing status text (badges, dropdowns, audit diffs) — the
// internal enum values above are unchanged everywhere else (STATUS/TRANSITIONS, filtering,
// storage) so this only affects what a status is CALLED on screen, not how it behaves. Used
// where only the bare status string is available (e.g. enumerating dropdown options with no
// specific record). displayStatusLabelForRecord() below is the context-aware version.
//
// EXPIRED_RECOGNIZED reads "MISC INCOME (FINAL)" uniformly, including for Gift Certificates —
// even though GC write-offs post to Outlet Posting Amount(B) rather than AR Posting Amount(C)
// (see accounting.js computeWriteOffSplit, unchanged), a GC write-off is always permanent
// (no grace-use concept for GC at all), so from a plain-language "what does this status mean"
// standpoint it's the same as a Service Certificate write-off past its 5-year window: money
// that has been fully and permanently swept out of circulation.
CertApp.STATUS_DISPLAY_LABEL = {
  EXPIRED_PENDING: 'EXPIRED',
  EXPIRED_RECOGNIZED: 'MISC INCOME',
  // Virtual filter-only values (never stored) that split the single EXPIRED_RECOGNIZED status
  // into its still-reversible vs permanently-final halves — see viewCertificateList.js matches().
  MISC_REVERSIBLE: 'MISC INCOME',
  MISC_FINAL: 'MISC (FINAL)'
};

CertApp.displayStatusLabel = function (status) {
  return CertApp.STATUS_DISPLAY_LABEL[status] || status;
};

// The imported history writes the same few payment methods a dozen different ways (CA/CASH,
// BT/BK/BANK/Bank Transfer, CC&Cash/CC & Cash/Cash+CC ...) — show them all under one canonical
// label so the ledger reads consistently. DISPLAY ONLY: the stored paymentType is never
// rewritten, so the original source value stays intact for audit (and unlocked rows still edit
// the raw value). Values that aren't notation variants — one-off PM posting numbers such as
// "PM9239" or "PM9184(Bank)" — deliberately fall through unchanged.
// Keys are the uppercased stored value; lookup also retries with all whitespace removed, so
// "CC & Cash" and "CC&Cash" both resolve from the single 'CC&CASH' entry.
CertApp.PAYMENT_DISPLAY_ALIAS = {
  CA: 'Cash', CASH: 'Cash',
  BT: 'Bank transfer', BK: 'Bank transfer', BANK: 'Bank transfer', BANKTRANSFER: 'Bank transfer',
  'CC&CASH': 'CC & Cash', 'CASH+CC': 'CC & Cash',
  'CC&BT': 'CC & Bank transfer'
};
CertApp.displayPaymentType = function (v) {
  if (v === null || v === undefined || v === '') return v;
  var raw = String(v).trim();
  var key = raw.toUpperCase();
  return CertApp.PAYMENT_DISPLAY_ALIAS[key] || CertApp.PAYMENT_DISPLAY_ALIAS[key.replace(/\s+/g, '')] || raw;
};

function addYearsIso(isoDate, years) {
  var d = new Date(isoDate);
  d.setFullYear(d.getFullYear() + years);
  var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
}

// Grace Use stays possible up to 5 years from ISSUE date (see accounting.js) — past that, a
// Service Certificate's write-off (misc income) or unprocessed overdue state is permanent.
// Meaningless for Gift Certificates, which have no grace-use concept at all.
CertApp.isPastGraceWindow = function (rec, asOfDate) {
  asOfDate = asOfDate || CertApp.today();
  if (!rec.issuedDate) return false;
  return asOfDate >= addYearsIso(rec.issuedDate, 5);
};

// Context-aware status label: for Service Certificates, distinguishes whether an
// overdue-unprocessed or already-written-off record is still within its 5-year reversibility
// window or permanently past it — collapsing that into one generic label (as
// displayStatusLabel() does) would hide whether money sitting in misc income can still be
// clawed back via Grace Use. Gift Certificates never have this distinction (100% straight to
// revenue, no misc income, no grace use), so they always fall through to the plain label.
CertApp.displayStatusLabelForRecord = function (rec, effectiveStatus) {
  var status = effectiveStatus || rec.status;
  var isGift = CertApp.accounting && CertApp.accounting.isGiftCertificate(rec.category);
  if (status === CertApp.STATUS.EXPIRED_RECOGNIZED) {
    // 만료 미사용 → 100% 잡이익(misc income)으로 마감된 상태. Gift Certificates have no grace-use
    // window so theirs is always final; Service Certificates can still be clawed back via Grace
    // Use until 5 years from issue, so within that window they read plain "MISC INCOME".
    return (isGift || CertApp.isPastGraceWindow(rec)) ? 'MISC (FINAL)' : 'MISC INCOME';
  }
  if (!isGift && status === CertApp.VIRTUAL_STATUS.EXPIRED_PENDING && CertApp.isPastGraceWindow(rec)) {
    return 'EXPIRED (FINAL)';
  }
  return CertApp.displayStatusLabel(status);
};

// Plain-language explanation of what a status MEANS for this specific record — shown as the
// tooltip on the status badge (see components.js ui.statusBadge). Context-aware like
// displayStatusLabelForRecord: the same badge means different things by 종류(category) and by
// whether the 5-year grace window has passed, which is exactly what users find confusing.
CertApp.statusHelp = function (rec, effectiveStatus) {
  if (!rec || !CertApp.i18n) return '';
  var t = CertApp.i18n.t;
  var status = effectiveStatus || rec.status;
  var isGift = CertApp.accounting && CertApp.accounting.isGiftCertificate(rec.category);
  if (status === CertApp.STATUS.VOID) {
    return t(rec.voidReason === CertApp.VOID_REASON.REFUND ? 'help.status.void_refund' : 'help.status.void_misprint');
  }
  if (status === CertApp.STATUS.EXPIRED_RECOGNIZED) {
    return t((isGift || CertApp.isPastGraceWindow(rec)) ? 'help.status.misc_final' : 'help.status.misc_reversible');
  }
  if (status === CertApp.VIRTUAL_STATUS.EXPIRED_PENDING) {
    return t((!isGift && CertApp.isPastGraceWindow(rec)) ? 'help.status.expired_final' : 'help.status.expired');
  }
  var key = { ACTIVE: 'help.status.active', USED: 'help.status.used', GRACE_USED: 'help.status.grace' }[status];
  return key ? t(key) : '';
};

CertApp.VOID_REASON = {
  MISPRINT: 'MISPRINT',
  REFUND: 'REFUND',
  IMPORTED_REVERSAL: 'IMPORTED_REVERSAL'
};

// Audit log entry kinds — see certificateWorkflow.js logAudit(). One entry per certificate
// per business event, with full before/after snapshots (not a lossy diff) so the log stays
// self-contained even if display/diff logic changes later.
CertApp.AUDIT_ACTION = {
  IMPORT: 'IMPORT',
  ISSUE: 'ISSUE',
  USE: 'USE',
  VOID: 'VOID',
  EXPIRE_RECOGNIZE: 'EXPIRE_RECOGNIZE',
  GRACE_USE: 'GRACE_USE',
  EXTEND_EXPIRY: 'EXTEND_EXPIRY',
  CORRECT: 'CORRECT',
  DELETE: 'DELETE',
  UNDO: 'UNDO'
};

// Allowed status transitions (source -> [allowed targets])
CertApp.TRANSITIONS = {
  ACTIVE: ['USED', 'VOID', 'EXPIRED_RECOGNIZED'],
  EXPIRED_RECOGNIZED: ['GRACE_USED'],
  USED: [],
  VOID: [],
  GRACE_USED: []
};

CertApp.canTransition = function (fromStatus, toStatus) {
  var allowed = CertApp.TRANSITIONS[fromStatus] || [];
  return allowed.indexOf(toStatus) !== -1;
};

// Canonical field list for a CertificateRecord (documentation + import mapping target)
CertApp.CERTIFICATE_FIELDS = [
  'id', 'category', 'certificateNo', 'issuedDate', 'expiryDate', 'status', 'dc',
  'amountA', 'paymentType', 'certificateDetail', 'usedDate', 'outletPostingAmountB',
  'miscRevPostingDate', 'arPostingAmountC', 'billNo', 'sellerOperaId',
  'voidReason', 'refundDate', 'refundAmount', 'graceUseDate', 'mateApprovalNo', 'discountReceiptNote',
  'needsReview', 'sourceRowRef', 'createdAt', 'updatedAt'
];

CertApp.uuid = function () {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0, v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

CertApp.nowIso = function () {
  return new Date().toISOString();
};

// Local calendar date (YYYY-MM-DD) for "today" — deliberately NOT toISOString().slice(0,10),
// which converts to UTC first and silently shifts back a day for timezones ahead of UTC
// (e.g. KST, UTC+9) during the 9 hours after local midnight. Use this everywhere a UI
// default or business-date comparison needs "today" in the user's local calendar.
CertApp.today = function () {
  return CertApp.formatLocalDate(new Date());
};

CertApp.formatLocalDate = function (d) {
  var y = d.getFullYear(), m = ('0' + (d.getMonth() + 1)).slice(-2), day = ('0' + d.getDate()).slice(-2);
  return y + '-' + m + '-' + day;
};
