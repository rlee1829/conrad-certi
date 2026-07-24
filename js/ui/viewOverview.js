/* Overview view: period selector + per-category balance-sheet-style summary table.
   The table header is two rows: each measure (Opening/Issued/Used/Expired→Rev/Void/Ending)
   is one group label spanning its 금액(amount)/건수(qty) pair below it, so amount and count sit
   in separate cells without repeating the measure name in every column header.
   Default period is the current month-to-date (1st of this month → today). */
window.CertApp = window.CertApp || {};
CertApp.viewOverview = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;

  // 1st of the current month → today (KST local calendar dates, matching CertApp.today()).
  function currentMonthPeriod() {
    var now = new Date();
    var start = new Date(now.getFullYear(), now.getMonth(), 1);
    return { start: CertApp.formatLocalDate(start), end: CertApp.today() };
  }
  var state = currentMonthPeriod();

  // Measure groups: each renders as one top-level header cell spanning its amount+qty columns.
  // These are the mutually exclusive movements that tie out as
  //   Opening + Issued − Used − Void/Refund = Ending.
  // The old 만료→잡이익 column is deliberately NOT here: it was a breakdown OF Used, so showing it
  // alongside these invited subtracting it a second time. computeSummary still returns
  // expiredRev*, and the expiry write-off is reported properly (by period, as misc income) in
  // 마감 요약 — see viewPosting.js.
  var GROUPS = [
    { label: 'ov.grpOpening', amtKey: 'openingAmt', qtyKey: 'openingQty' },
    { label: 'ov.grpIssued', amtKey: 'issuedAmt', qtyKey: 'issuedQty' },
    { label: 'ov.grpUsed', amtKey: 'usedAmt', qtyKey: 'usedQty' },
    { label: 'ov.grpVoid', amtKey: 'voidAmt', qtyKey: 'voidQty' },
    { label: 'ov.grpEnding', amtKey: 'endingAmt', qtyKey: 'endingQty' }
  ];

  function render(container) {
    state = currentMonthPeriod();
    var wrap = ui.el('div', { class: 'view-overview' });

    var controls = ui.el('div', { class: 'panel controls-row' }, [
      ui.el('label', {}, [t('ov.periodStart') + ' ',
        ui.el('input', { type: 'date', id: 'ov-period-start', value: state.start })]),
      ui.el('label', {}, [t('ov.periodEnd') + ' ',
        ui.el('input', { type: 'date', id: 'ov-period-end', value: state.end })]),
      ui.el('button', { class: 'btn btn-primary', text: t('common.search'), onclick: function () {
        state.start = document.getElementById('ov-period-start').value;
        state.end = document.getElementById('ov-period-end').value;
        renderTable();
      } }),
      ui.refreshButton()
    ]);
    wrap.appendChild(controls);

    var cardsRow = ui.el('div', { class: 'summary-cards', id: 'ov-cards' });
    wrap.appendChild(cardsRow);

    var tableWrap = ui.el('div', { class: 'panel table-scroll', id: 'ov-table-wrap' });
    wrap.appendChild(tableWrap);
    // State the identity the columns tie out to, and point at 마감 요약 for the expiry write-off
    // (which lives inside Used here and is reported as misc income there).
    wrap.appendChild(ui.el('div', { class: 'muted', style: 'font-size:11.5px;margin:-6px 2px 12px;line-height:1.6', text: t('ov.balanceNote') }));

    container.appendChild(wrap);
    renderTable();
  }

  function renderTable() {
    var summary = CertApp.calculationEngine.computeSummary(state.start, state.end);
    var cats = Object.keys(CertApp.CATEGORY);
    var totals = { openingQty: 0, openingAmt: 0, issuedQty: 0, issuedAmt: 0, usedQty: 0, usedAmt: 0, expiredRevQty: 0, expiredRevAmt: 0, voidQty: 0, voidAmt: 0, endingQty: 0, endingAmt: 0 };

    // categoryKey drives the drill-through to the Certificate List; '' on the 합계 row means
    // "no category filter" (the whole ledger).
    var rows = cats.map(function (cat) {
      var b = summary[cat];
      Object.keys(totals).forEach(function (k) { totals[k] += b[k]; });
      return Object.assign({ category: CertApp.CATEGORY_LABEL[cat], categoryKey: cat, isTotal: false }, b);
    });
    rows.push(Object.assign({ category: t('ov.total'), categoryKey: '', isTotal: true }, totals));

    renderGroupedTable(document.getElementById('ov-table-wrap'), rows);

    var cardsEl = document.getElementById('ov-cards');
    cardsEl.innerHTML = '';
    cardsEl.appendChild(ui.el('div', { class: 'summary-card' }, [
      ui.el('div', { class: 'sc-label', text: t('ov.endingBalance') }),
      ui.el('div', { class: 'sc-value', text: ui.formatCurrency(totals.endingAmt) }),
      ui.el('div', { class: 'sc-sub', text: ui.formatNumber(totals.endingQty) + t('common.cases') })
    ]));
    cardsEl.appendChild(ui.el('div', { class: 'summary-card' }, [
      ui.el('div', { class: 'sc-label', text: t('ov.issuedPeriod') }),
      ui.el('div', { class: 'sc-value', text: ui.formatCurrency(totals.issuedAmt) }),
      ui.el('div', { class: 'sc-sub', text: ui.formatNumber(totals.issuedQty) + t('common.cases') })
    ]));
    cardsEl.appendChild(ui.el('div', { class: 'summary-card' }, [
      ui.el('div', { class: 'sc-label', text: t('ov.usedPeriod') }),
      ui.el('div', { class: 'sc-value', text: ui.formatCurrency(totals.usedAmt) }),
      ui.el('div', { class: 'sc-sub', text: ui.formatNumber(totals.usedQty) + t('common.cases') })
    ]));
    var expiryQueue = CertApp.calculationEngine.computeExpiryQueue();
    cardsEl.appendChild(ui.el('div', { class: 'summary-card sc-warn' }, [
      ui.el('div', { class: 'sc-label', text: t('ov.expiryQueue') }),
      ui.el('div', { class: 'sc-value', text: ui.formatNumber(expiryQueue.length) + t('common.cases') }),
      ui.el('div', { class: 'sc-sub', text: t('ov.accountingNeeded') })
    ]));
  }

  function renderGroupedTable(container, rows) {
    if (!container) return;
    container.innerHTML = '';

    // Row 1: 종류(rowspan 2) + one group label per measure (colspan 2). Row 2: 금액/건수 under each.
    // Header cells are all center-aligned (body cells keep their left/right alignment).
    var groupHeaderCells = [ui.el('th', { class: 'col-align-center', rowspan: '2', text: t('ov.colCategory') })];
    var subHeaderCells = [];
    GROUPS.forEach(function (g) {
      groupHeaderCells.push(ui.el('th', { class: 'col-align-center al-group-th', colspan: '2', text: t(g.label) }));
      subHeaderCells.push(ui.el('th', { class: 'col-align-center al-sub-th', text: t('ov.subAmt') }));
      subHeaderCells.push(ui.el('th', { class: 'col-align-center al-sub-th', text: t('ov.subQty') }));
    });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, groupHeaderCells), ui.el('tr', {}, subHeaderCells)]);

    var tbody = ui.el('tbody');
    rows.forEach(function (r) {
      // 종류 name drills through to the Certificate List filtered to that category (full history,
      // no period). Only the NAME is a link — the measure cells below are point-in-time figures
      // (effectiveStatusAsOf) that the list's stored-status filter can't reproduce, so linking
      // them would show counts that don't match the number clicked.
      var cells = [ui.el('td', { class: 'col-align-left' + (r.isTotal ? ' ov-total-cell' : '') }, [
        ui.el('button', {
          class: 'link-btn', text: r.category, title: t('ov.viewInList'),
          onclick: function () {
            CertApp.viewCertificateList.showFiltered({ category: r.categoryKey });
            CertApp.router.go('certlist');
          }
        })
      ])];
      GROUPS.forEach(function (g) {
        cells.push(ui.el('td', { class: 'col-align-right' + (r.isTotal ? ' ov-total-cell' : ''), text: ui.formatCurrency(r[g.amtKey]) }));
        cells.push(ui.el('td', { class: 'col-align-right' + (r.isTotal ? ' ov-total-cell' : ''), text: ui.formatNumber(r[g.qtyKey]) + t('common.cases') }));
      });
      tbody.appendChild(ui.el('tr', { class: r.isTotal ? 'ov-total-row' : '' }, cells));
    });

    container.appendChild(ui.el('table', { class: 'data-table' }, [thead, tbody]));
  }

  return { render: render };
})();
