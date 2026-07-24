/* 마감 요약 view — a GL posting summary for a period (default: current month). Turns the month's
   certificate activity into the P&L lines an accountant posts: revenue recognized (B), misc
   income by kind (write-off / refund penalty / grace reversal — read from the ledger so they net
   as booked), cash refunded (D), plus gross issuance. A per-category breakdown and an Excel
   export make it a ready-to-hand close deliverable. */
window.CertApp = window.CertApp || {};
CertApp.viewPosting = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;

  function currentMonthPeriod() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: CertApp.formatLocalDate(start), end: CertApp.today() };
  }
  var state = currentMonthPeriod();

  // Posting lines in the order they read on a close sheet; `sign` flags a contra line.
  var LINES = [
    { key: 'issued', label: 'ps.line.issued' },
    { key: 'revenue', label: 'ps.line.revenue' },
    { key: 'writeOff', label: 'ps.line.writeOff' },
    { key: 'refundPenalty', label: 'ps.line.refundPenalty' },
    { key: 'graceReversal', label: 'ps.line.graceReversal' },
    { key: 'refundCash', label: 'ps.line.refundCash' }
  ];

  function render(container) {
    state = currentMonthPeriod();
    var wrap = ui.el('div', { class: 'view-posting' });
    wrap.appendChild(ui.el('div', { class: 'panel muted' }, [t('ps.desc')]));

    var startInput = ui.el('input', { type: 'date', value: state.start });
    var endInput = ui.el('input', { type: 'date', value: state.end });
    var controls = ui.el('div', { class: 'panel controls-row' }, [
      ui.el('label', {}, [t('ov.periodStart') + ' ', startInput]),
      ui.el('label', {}, [t('ov.periodEnd') + ' ', endInput]),
      ui.el('button', { class: 'btn btn-primary', text: t('common.search'), onclick: function () {
        state.start = startInput.value; state.end = endInput.value; renderTables();
      } }),
      ui.el('button', { class: 'btn', text: t('ps.export'), onclick: onExport })
    ]);
    wrap.appendChild(controls);

    wrap.appendChild(ui.el('h3', { id: 'ps-period-title', style: 'margin:6px 2px 8px' }));
    wrap.appendChild(ui.el('div', { class: 'panel table-scroll', id: 'ps-main-wrap' }));
    wrap.appendChild(ui.el('div', { class: 'muted', style: 'margin:10px 2px 6px;font-weight:700', text: t('ps.byCategory') }));
    wrap.appendChild(ui.el('div', { class: 'panel table-scroll', id: 'ps-cat-wrap' }));

    container.appendChild(wrap);
    renderTables();
  }

  function summary() { return CertApp.calculationEngine.computePostingSummary(state.start, state.end); }

  function renderTables() {
    var s = summary();
    var title = document.getElementById('ps-period-title');
    if (title) title.textContent = t('ps.periodTitle', { start: state.start || '–', end: state.end || '–' });

    // Main posting table: 항목 | 건수 | 금액.
    var mainCols = [
      { key: 'label', label: t('ps.col.item'), align: 'left' },
      { key: 'qty', label: t('ps.col.qty'), align: 'right', format: function (v) { return ui.formatNumber(v) + t('common.cases'); } },
      { key: 'amt', label: t('ps.col.amount'), align: 'right', format: function (v) { return ui.formatCurrency(v); } }
    ];
    var mainRows = LINES.map(function (l) { return { label: t(l.label), qty: s[l.key].qty, amt: s[l.key].amt }; });
    // 잡이익 순증감 as a highlighted subtotal.
    mainRows.push({ label: t('ps.line.miscNet'), qty: '', amt: s.miscIncomeNet, isTotal: true });
    var mainWrap = document.getElementById('ps-main-wrap');
    if (mainWrap) {
      ui.renderTable(mainWrap, mainCols.map(function (c) {
        if (c.key === 'qty') return Object.assign({}, c, { format: function (v) { return v === '' ? '' : ui.formatNumber(v) + t('common.cases'); } });
        return c;
      }), mainRows);
    }

    // Per-category breakdown: 종류 | 매출(B) | 잡이익 | 환불현금.
    var catCols = [
      { key: 'category', label: t('ov.colCategory'), align: 'left' },
      { key: 'revenue', label: t('ps.line.revenue'), align: 'right', format: function (v) { return ui.formatCurrency(v); } },
      { key: 'miscIncome', label: t('cl.col.arC'), align: 'right', format: function (v) { return ui.formatCurrency(v); } },
      { key: 'refundCash', label: t('cd.field.refundAmount'), align: 'right', format: function (v) { return ui.formatCurrency(v); } }
    ];
    var totals = { revenue: 0, miscIncome: 0, refundCash: 0 };
    var catRows = Object.keys(CertApp.CATEGORY).map(function (c) {
      var b = s.byCategory[c];
      totals.revenue += b.revenue; totals.miscIncome += b.miscIncome; totals.refundCash += b.refundCash;
      return { category: CertApp.CATEGORY_LABEL[c], revenue: b.revenue, miscIncome: b.miscIncome, refundCash: b.refundCash };
    });
    catRows.push({ category: t('ov.total'), revenue: totals.revenue, miscIncome: totals.miscIncome, refundCash: totals.refundCash, isTotal: true });
    var catWrap = document.getElementById('ps-cat-wrap');
    if (catWrap) ui.renderTable(catWrap, catCols, catRows);
  }

  // Excel export: two sheets (posting summary + per-category), matching the on-screen tables.
  function onExport() {
    var s = summary();
    var main = [[t('ps.periodTitle', { start: state.start, end: state.end })], [], [t('ps.col.item'), t('ps.col.qty'), t('ps.col.amount')]];
    LINES.forEach(function (l) { main.push([t(l.label), s[l.key].qty, s[l.key].amt]); });
    main.push([t('ps.line.miscNet'), '', s.miscIncomeNet]);

    var cat = [[t('ov.colCategory'), t('ps.line.revenue'), t('cl.col.arC'), t('cd.field.refundAmount')]];
    Object.keys(CertApp.CATEGORY).forEach(function (c) {
      var b = s.byCategory[c];
      cat.push([CertApp.CATEGORY_LABEL[c], b.revenue, b.miscIncome, b.refundCash]);
    });

    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(main), t('ps.sheet.summary'));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cat), t('ps.sheet.category'));
    XLSX.writeFile(wb, t('ps.fileName', { start: state.start, end: state.end }) + '.xlsx');
  }

  return { render: render };
})();
