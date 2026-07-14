/* Misc Income (잡이익) Ledger — a standalone screen with its own sidebar menu (like the Expiry
   Queue), moved out of the Certificate List. Lists every movement in/out of the misc income
   account:
     - WRITE_OFF: an expired certificate recognized to misc income (100% of its sale price)
     - GRACE_USE_PAYOUT / GRACE_USE_REVERSAL: 90% later released back to real revenue when a
       customer redeems an expired certificate via Grace Use
   The Status column shows whether each write-off is still reversible (Service Cert within 5
   years of issue) or final. Reads straight from CertApp.cache.miscRevenue. */
window.CertApp = window.CertApp || {};
CertApp.viewMiscRevenue = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;

  var state = { category: '', type: '' };

  var MISC_REV_TYPE_LABEL = {
    WRITE_OFF: 'cl.miscRev.type.writeOff',
    GRACE_USE_PAYOUT: 'cl.miscRev.type.gracePayout',
    GRACE_USE_REVERSAL: 'cl.miscRev.type.graceReversal'
  };

  // A WRITE_OFF booking can still be clawed back via Grace Use while its certificate is within
  // 5 years of issue (see schema.js isPastGraceWindow); past that it's permanent. Grace Use
  // entries are themselves an already-completed reversal.
  function miscRevStatusCell(entry) {
    if (entry.type === 'GRACE_USE_PAYOUT' || entry.type === 'GRACE_USE_REVERSAL') {
      return ui.el('span', { class: 'status-badge badge-grace', text: t('cl.miscRev.status.done') });
    }
    var rec = CertApp.cache.certificates.find(function (r) { return r.id === entry.certificateId; });
    var pastWindow = rec && CertApp.isPastGraceWindow(rec);
    return ui.el('span', {
      class: 'status-badge ' + (pastWindow ? 'badge-void badge-final' : 'badge-pending'),
      text: pastWindow ? t('cl.miscRev.status.final') : t('cl.miscRev.status.reversible')
    });
  }

  function matches(e) {
    if (state.category && e.category !== state.category) return false;
    if (state.type && e.type !== state.type) return false;
    return true;
  }

  function render(container) {
    state = { category: '', type: '' };
    var wrap = ui.el('div', { class: 'view-misc-revenue' });

    wrap.appendChild(ui.el('div', { class: 'panel muted' }, [t('cl.miscRev.desc')]));

    var catOptions = [ui.el('option', { value: '', text: t('common.allCategory') })].concat(
      Object.keys(CertApp.CATEGORY).map(function (c) { return ui.el('option', { value: c, text: CertApp.CATEGORY_LABEL[c] }); })
    );
    var typeOptions = [ui.el('option', { value: '', text: t('mr.allTypes') })].concat(
      Object.keys(MISC_REV_TYPE_LABEL).map(function (ty) { return ui.el('option', { value: ty, text: t(MISC_REV_TYPE_LABEL[ty]) }); })
    );

    var controls = ui.el('div', { class: 'panel controls-row controls-row-tight' }, [
      ui.el('select', { onchange: function (e) { state.category = e.target.value; renderTable(); } }, catOptions),
      ui.el('select', { onchange: function (e) { state.type = e.target.value; renderTable(); } }, typeOptions),
      ui.refreshButton()
    ]);
    wrap.appendChild(controls);

    wrap.appendChild(ui.el('div', { class: 'summary-cards', id: 'mr-cards' }));
    wrap.appendChild(ui.el('div', { class: 'muted', id: 'mr-count', style: 'margin-bottom:8px' }));
    wrap.appendChild(ui.el('div', { class: 'panel table-scroll', id: 'mr-table-wrap' }));

    container.appendChild(wrap);
    renderTable();
  }

  function renderTable() {
    var entries = CertApp.cache.miscRevenue.filter(matches).slice()
      .sort(function (a, b) { return b.entryDate < a.entryDate ? -1 : 1; });

    var countEl = document.getElementById('mr-count');
    if (countEl) countEl.textContent = t('mr.count', { n: ui.formatNumber(entries.length), total: ui.formatNumber(CertApp.cache.miscRevenue.length) });

    // Net misc income sitting in the account for the current filter: write-offs add, grace-use
    // reversals (negative amounts) subtract — see certificateWorkflow.js graceUseExpired.
    var net = entries.reduce(function (s, e) { return s + (e.amount || 0); }, 0);
    var cardsEl = document.getElementById('mr-cards');
    if (cardsEl) {
      cardsEl.innerHTML = '';
      cardsEl.appendChild(ui.el('div', { class: 'summary-card' }, [
        ui.el('div', { class: 'sc-label', text: t('mr.netBalance') }),
        ui.el('div', { class: 'sc-value', text: ui.formatCurrency(net) }),
        ui.el('div', { class: 'sc-sub', text: ui.formatNumber(entries.length) + t('common.cases') })
      ]));
    }

    var columns = [
      { key: 'entryDate', label: t('cl.miscRev.col.date') },
      { key: 'certificateNo', label: t('cl.miscRev.col.certNo'), format: function (v, e) {
        return ui.el('button', { class: 'link-btn', text: v, title: t('cd.viewDetailTitle'), onclick: function () { CertApp.ui.openCertificateDetail(e.certificateId); } });
      } },
      { key: 'category', label: t('cl.miscRev.col.category'), align: 'left', format: function (v) { return CertApp.CATEGORY_LABEL[v] || v; } },
      { key: 'type', label: t('cl.miscRev.col.type'), format: function (v) { return MISC_REV_TYPE_LABEL[v] ? t(MISC_REV_TYPE_LABEL[v]) : v; } },
      { key: 'status', label: t('cl.miscRev.col.status'), format: function (v, e) { return miscRevStatusCell(e); } },
      { key: 'amount', label: t('cl.miscRev.col.amount'), align: 'right', format: function (v) { return ui.formatCurrency(v); } },
      { key: 'note', label: t('cl.miscRev.col.note') }
    ];
    var wrapEl = document.getElementById('mr-table-wrap');
    if (!wrapEl) return;
    ui.renderTable(wrapEl, columns, entries);
    if (entries.length === 0) wrapEl.appendChild(ui.el('div', { class: 'empty-state', text: t('mr.empty') }));
  }

  return { render: render };
})();
