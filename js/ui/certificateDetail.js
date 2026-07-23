/* Certificate Detail panel: full field snapshot + audit history timeline for one certificate,
   opened from a certificate number link in Certificate List / Audit Log / Expiry Queue.
   Reads straight from IndexedDB's auditLog store (not cached in memory — see
   certificateWorkflow.js logAudit) so it always reflects everything ever recorded, including
   for certificates that have since been deleted (reconstructed from the last snapshot). */
window.CertApp = window.CertApp || {};
CertApp.ui = CertApp.ui || {};

CertApp.ui.openCertificateDetail = function (certificateId) {
  var ui = CertApp.ui;
  var au = CertApp.auditUtil;
  var t = CertApp.i18n.t;

  CertApp.db.getAll('auditLog').then(function (allEntries) {
    var entries = allEntries
      .filter(function (e) { return e.certificateId === certificateId; })
      .sort(function (a, b) { return a.ts < b.ts ? 1 : -1; }); // newest first

    var rec = CertApp.cache.certificates.find(function (r) { return r.id === certificateId; });
    var isDeleted = !rec;
    if (!rec) {
      // Reconstruct the last known state from the log so a deleted certificate can still be reviewed.
      var lastWithState = entries.find(function (e) { return e.after || e.before; });
      rec = lastWithState ? (lastWithState.after || lastWithState.before) : null;
    }
    if (!rec) {
      ui.toast(t('common.noData'), 'warn');
      return;
    }

    var miscEntries = CertApp.cache.miscRevenue.filter(function (e) { return e.certificateId === certificateId; });

    renderPanel(rec, entries, miscEntries, isDeleted);
  });

  function fieldCell(labelKey, value) {
    return ui.el('div', {}, [
      ui.el('div', { class: 'cd-field-label', text: t(labelKey) }),
      ui.el('div', { class: 'cd-field-value', text: value === null || value === undefined || value === '' ? '–' : String(value) })
    ]);
  }

  function renderPanel(rec, entries, miscEntries, isDeleted) {
    var body = [];

    if (isDeleted) {
      body.push(ui.el('div', { class: 'cd-notice', text: t('cd.deletedNotice') }));
    }

    body.push(ui.el('div', { class: 'cert-detail-header' }, [
      ui.el('span', { class: 'cd-certno', text: rec.certificateNo }),
      ui.statusBadge(rec.status, rec),
      ui.el('span', { class: 'muted', text: CertApp.CATEGORY_LABEL[rec.category] || rec.category })
    ]));

    // "유효기간 연장" action — available whenever the certificate is still ACTIVE, which
    // includes EXPIRED (past expiry but not yet converted to misc income). Deliberately NOT
    // shown for USED / VOID / EXPIRED_RECOGNIZED (already-closed) records; extendExpiry also
    // guards this. Lets an expired cert browsed from the Certificate List be extended here,
    // not just from the Expiry Queue.
    if (!isDeleted && rec.status === CertApp.STATUS.ACTIVE) {
      body.push(ui.el('div', { class: 'cd-actions' }, [
        ui.el('button', {
          class: 'btn btn-primary btn-small', text: t('eq.extend.button'),
          onclick: function () {
            ui.openExtendModal(rec, function () {
              ui.openCertificateDetail(certificateId); // reopen with the new expiry date
              CertApp.router.refresh();
            });
          }
        })
      ]));
    }

    body.push(ui.el('div', { class: 'cert-detail-grid' }, [
      fieldCell('cl.col.amountA', ui.formatCurrency(rec.amountA)),
      fieldCell('cl.col.paymentType', CertApp.displayPaymentType(rec.paymentType)),
      fieldCell('cl.col.issuedDate', rec.issuedDate),
      fieldCell('cl.col.expiryDate', rec.expiryDate),
      fieldCell('cl.col.usedDate', rec.usedDate),
      fieldCell('cl.col.outletB', ui.formatCurrency(rec.outletPostingAmountB)),
      fieldCell('cl.col.arC', ui.formatCurrency(rec.arPostingAmountC)),
      fieldCell('cd.field.voidReason', rec.voidReason),
      fieldCell('cd.field.refundDate', rec.refundDate),
      // Cash actually paid back = face value minus the retained penalty. Derived (it's the
      // record's A-B-C), so it's only meaningful once the certificate is a REFUND void.
      fieldCell('cd.field.refundAmount', rec.voidReason === CertApp.VOID_REASON.REFUND
        ? ui.formatCurrency(CertApp.accounting.refundAmount(rec)) : null),
      fieldCell('cd.field.graceUseDate', rec.graceUseDate),
      fieldCell('cd.field.mateApprovalNo', rec.mateApprovalNo),
      fieldCell('cl.col.billNo', rec.billNo),
      fieldCell('cl.col.discountReceipt', rec.discountReceiptNote),
      fieldCell('cl.col.detail', rec.certificateDetail)
    ]));

    if (miscEntries.length) {
      body.push(ui.el('h3', { text: t('cd.miscRevTitle'), style: 'margin-bottom:8px' }));
      var mrTableWrap = ui.el('div', { style: 'margin-bottom:20px' });
      ui.renderTable(mrTableWrap, [
        { key: 'entryDate', label: t('cl.miscRev.col.date') },
        { key: 'type', label: t('cl.miscRev.col.type') },
        { key: 'amount', label: t('cl.miscRev.col.amount'), format: function (v) { return ui.formatCurrency(v); } },
        { key: 'note', label: t('cl.miscRev.col.note') }
      ], miscEntries);
      body.push(mrTableWrap);
    }

    body.push(ui.el('h3', { text: t('cd.historyTitle'), style: 'margin-bottom:10px' }));
    if (entries.length === 0) {
      body.push(ui.el('div', { class: 'muted', text: t('cd.noHistory') }));
    } else {
      body.push(ui.el('div', { class: 'history-timeline' }, entries.map(function (entry) {
        return ui.el('div', { class: 'history-entry' }, [
          ui.el('div', { class: 'history-entry-head' }, [
            au.actionBadge(entry.action),
            ui.el('span', { class: 'history-entry-ts', text: entry.ts.replace('T', ' ').slice(0, 19) }),
            entry.actor ? ui.el('span', { class: 'history-entry-actor', text: entry.actor }) : null
          ]),
          au.renderDiffBlock(entry)
        ]);
      })));
    }

    ui.openPanel(t('cd.title', { certNo: rec.certificateNo }), body);
  }
};
