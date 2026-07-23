/* Shared helpers for rendering audit log entries — used by both the Audit Log view (short,
   one-line summaries in a table) and the Certificate Detail panel (full field-by-field diff
   timeline). Kept separate from certificateWorkflow.js since this is display logic, not
   business logic — the workflow layer only ever writes {before, after} snapshots. */
window.CertApp = window.CertApp || {};
CertApp.auditUtil = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;

  var FIELD_LABEL_KEY = {
    certificateNo: 'cl.col.certNo', category: 'cl.col.category', status: 'cl.col.status',
    amountA: 'cl.col.amountA', paymentType: 'cl.col.paymentType', issuedDate: 'cl.col.issuedDate',
    expiryDate: 'cl.col.expiryDate', usedDate: 'cl.col.usedDate', outletPostingAmountB: 'cl.col.outletB',
    arPostingAmountC: 'cl.col.arC', certificateDetail: 'cl.col.detail', billNo: 'cl.col.billNo',
    voidReason: 'cd.field.voidReason', refundDate: 'cd.field.refundDate', graceUseDate: 'cd.field.graceUseDate',
    mateApprovalNo: 'cd.field.mateApprovalNo', discountReceiptNote: 'cl.col.discountReceipt'
  };
  var DIFF_FIELDS = Object.keys(FIELD_LABEL_KEY);

  function fieldLabel(field) {
    var key = FIELD_LABEL_KEY[field];
    return key ? t(key) : field;
  }

  function fmtVal(field, v) {
    if (v === null || v === undefined || v === '') return '–';
    if (field === 'amountA' || field === 'outletPostingAmountB' || field === 'arPostingAmountC') return ui.formatCurrency(v);
    if (field === 'category') return CertApp.CATEGORY_LABEL[v] || v;
    if (field === 'status') return CertApp.displayStatusLabel(v);
    if (field === 'paymentType') return String(CertApp.displayPaymentType(v));
    return String(v);
  }

  // diffFields(before, after) -> [{field, before, after}] — only fields that actually changed.
  function diffFields(before, after) {
    var out = [];
    DIFF_FIELDS.forEach(function (f) {
      var bv = before ? before[f] : undefined;
      var av = after ? after[f] : undefined;
      if (JSON.stringify(bv) !== JSON.stringify(av)) out.push({ field: f, before: bv, after: av });
    });
    return out;
  }

  function actionBadge(action) {
    return ui.el('span', { class: 'action-badge action-badge-' + action, text: t('al.action.' + action) || action });
  }

  // One-line text summary for a table row — "Created", "Deleted", or "field: a → b, field2: c → d".
  // A free-text note (see certificateWorkflow.js logAudit) is appended in quotes when present.
  function summarizeEntry(entry) {
    var base;
    if (entry.action === CertApp.AUDIT_ACTION.ISSUE || entry.action === CertApp.AUDIT_ACTION.IMPORT) base = t('al.diff.created');
    else if (entry.action === CertApp.AUDIT_ACTION.DELETE) base = t('al.diff.deleted');
    else {
      var diffs = diffFields(entry.before, entry.after);
      base = diffs.length === 0 ? t('al.diff.noChange')
        : diffs.map(function (d) { return fieldLabel(d.field) + ': ' + fmtVal(d.field, d.before) + ' → ' + fmtVal(d.field, d.after); }).join(', ');
    }
    return entry.note ? (base + ' — "' + entry.note + '"') : base;
  }

  // Full diff block (DOM) for the Certificate Detail timeline — one line per changed field,
  // plus the free-text note (if any) as its own line.
  function renderDiffBlock(entry) {
    var body;
    if (entry.action === CertApp.AUDIT_ACTION.ISSUE || entry.action === CertApp.AUDIT_ACTION.IMPORT) {
      body = ui.el('div', { class: 'history-diff', text: t('al.diff.created') });
    } else if (entry.action === CertApp.AUDIT_ACTION.DELETE) {
      body = ui.el('div', { class: 'history-diff', text: t('al.diff.deleted') });
    } else {
      var diffs = diffFields(entry.before, entry.after);
      body = diffs.length === 0
        ? ui.el('div', { class: 'history-diff muted', text: t('al.diff.noChange') })
        : ui.el('div', { class: 'history-diff' }, diffs.map(function (d) {
          return ui.el('div', { class: 'history-diff-chip' }, [
            ui.el('b', { text: fieldLabel(d.field) + ': ' }),
            fmtVal(d.field, d.before) + ' → ' + fmtVal(d.field, d.after)
          ]);
        }));
    }
    if (!entry.note) return body;
    return ui.el('div', {}, [body, ui.el('div', { class: 'history-note', text: t('al.noteLabel') + entry.note })]);
  }

  return {
    fieldLabel: fieldLabel,
    fmtVal: fmtVal,
    diffFields: diffFields,
    actionBadge: actionBadge,
    summarizeEntry: summarizeEntry,
    renderDiffBlock: renderDiffBlock
  };
})();
