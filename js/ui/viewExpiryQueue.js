/* Expiry Queue: ACTIVE certs whose expiry date has passed (virtual EXPIRED_PENDING).
   Multi-select write-off with a live preview, plus a year-end bulk action. Both certificate
   families write off unclaimed money 100% to misc income (see accounting.js) — the detail
   table shows a single "잡이익 전환 예정" amount per row, no revenue/misc-income split to
   distinguish since there isn't one anymore. Above the detail table, a forecast TABLE (no
   chart — table only, per feedback) shows the full timeline: already-completed write-offs,
   the current overdue queue, and a 6-month-bucketed projection of what's still ACTIVE and
   approaching its nominal expiry, with count and amount always in separate right-aligned
   cells rather than combined into one string. */
window.CertApp = window.CertApp || {};
CertApp.viewExpiryQueue = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;
  var selectedIds = {};
  var filters = { search: '', category: '', expiryStart: '', expiryEnd: '' };

  var BUCKET_MONTHS = 6;
  var BUCKET_DAYS = BUCKET_MONTHS * 30;
  var MAX_FWD_BUCKET_IDX = 4; // 5 forward buckets: 0-6, 6-12, 12-18, 18-24, 24+ months from today

  function render(container) {
    selectedIds = {};
    filters = { search: '', category: '', expiryStart: '', expiryEnd: '' };
    var wrap = ui.el('div', { class: 'view-expiry' });

    wrap.appendChild(ui.el('div', { class: 'panel muted' }, [t('eq.desc')]));

    wrap.appendChild(ui.el('div', { id: 'eq-undo-bar' }));

    wrap.appendChild(ui.el('div', { id: 'eq-bucket-wrap' }));

    var catOptions = [ui.el('option', { value: '', text: t('common.allCategory') })].concat(
      Object.keys(CertApp.CATEGORY).map(function (c) { return ui.el('option', { value: c, text: CertApp.CATEGORY_LABEL[c] }); })
    );

    var controls = ui.el('div', { class: 'panel controls-row' }, [
      ui.el('label', {}, [t('eq.asOf') + ' ', ui.el('input', { type: 'date', id: 'eq-asof', value: CertApp.today(), onchange: renderTable })]),
      ui.el('button', { class: 'btn btn-primary', id: 'eq-recognize-selected', text: t('eq.recognizeSelected') }),
      ui.el('button', { class: 'btn btn-primary', id: 'eq-recognize-all', text: t('eq.recognizeAll') }),
      ui.refreshButton()
    ]);
    wrap.appendChild(controls);

    var filterRow = ui.el('div', { class: 'panel controls-row controls-row-tight' }, [
      ui.el('input', { type: 'text', placeholder: t('eq.searchCertNo'), oninput: function (e) { filters.search = e.target.value; renderTable(); } }),
      ui.el('select', { onchange: function (e) { filters.category = e.target.value; renderTable(); } }, catOptions),
      ui.el('label', {}, [t('eq.expiryDate') + ' ', ui.el('input', { type: 'date', onchange: function (e) { filters.expiryStart = e.target.value; renderTable(); } })]),
      ui.el('span', { text: '~' }),
      ui.el('input', { type: 'date', onchange: function (e) { filters.expiryEnd = e.target.value; renderTable(); } })
    ]);
    wrap.appendChild(filterRow);

    wrap.appendChild(ui.el('div', { class: 'muted', id: 'eq-count', style: 'margin-bottom:8px' }));
    wrap.appendChild(ui.el('div', { class: 'panel table-scroll', id: 'eq-table-wrap' }));
    container.appendChild(wrap);

    document.getElementById('eq-recognize-selected').addEventListener('click', onRecognizeSelected);
    document.getElementById('eq-recognize-all').addEventListener('click', onRecognizeAll);

    refresh();
  }

  function refresh() {
    renderTable();
    ui.renderUndoBar('eq-undo-bar', refresh);
  }

  function asOf() {
    var el = document.getElementById('eq-asof');
    return (el && el.value) || CertApp.today();
  }

  function matchesFilters(item) {
    var r = item.record;
    if (filters.category && r.category !== filters.category) return false;
    if (filters.search && (r.certificateNo || '').toLowerCase().indexOf(filters.search.toLowerCase()) === -1) return false;
    if (filters.expiryStart && (!r.expiryDate || r.expiryDate < filters.expiryStart)) return false;
    if (filters.expiryEnd && (!r.expiryDate || r.expiryDate > filters.expiryEnd)) return false;
    return true;
  }

  // Write-off books 100% of the sale price to misc income (arPostingAmountC) for BOTH
  // certificate families now (see accounting.js computeWriteOffSplit, which returns B=0), so the
  // projected conversion is that misc-income amount regardless of Gift vs Service — reading
  // outletPostingAmountB for Gift here was leftover from the old GC-to-revenue rule and always
  // showed 0.
  function conversionCell(item) {
    return ui.formatCurrency(item.previewArPostingAmountC);
  }

  function daysBetween(fromIso, toIso) {
    return Math.round((new Date(toIso) - new Date(fromIso)) / 86400000);
  }

  function fwdBucketLabel(idx) {
    var startMo = idx * BUCKET_MONTHS;
    if (idx === MAX_FWD_BUCKET_IDX) return startMo + t('eq.bucket.monthsPlus');
    return startMo + '-' + (startMo + BUCKET_MONTHS) + t('eq.bucket.monthsUnit');
  }

  // Full timeline forecast — computed from ALL certificates (ignores the row-level filters
  // below, and ignores the as-of-date field too — this is a standing "big picture" summary,
  // not scoped to a single write-off run): how much has already been converted to misc
  // income, how much is sitting in the queue right now, and how much is still active and
  // approaching its nominal expiry over the next 6-month windows.
  function computeForecastGrid(asOfDate) {
    var cats = Object.keys(CertApp.CATEGORY);
    var colCount = 2 + MAX_FWD_BUCKET_IDX + 1; // completed, pending-now, + forward buckets
    var yearStart = asOfDate.slice(0, 4) + '-01-01'; // Jan 1 of the current year
    var grid = {};
    cats.forEach(function (c) {
      grid[c] = [];
      for (var i = 0; i < colCount; i++) grid[c].push({ qty: 0, amt: 0 });
    });

    CertApp.cache.certificates.forEach(function (r) {
      if (!grid[r.category]) return;
      var cell;
      if (r.status === CertApp.STATUS.EXPIRED_RECOGNIZED) {
        // "전환 완료" counts only THIS YEAR's write-offs (recognition date = usedDate) — prior
        // years' conversions are closed history and would otherwise pile up forever.
        if (!r.usedDate || r.usedDate < yearStart) return;
        cell = grid[r.category][0]; // completed (this year)
      } else if (r.status === CertApp.STATUS.ACTIVE && r.expiryDate) {
        var days = daysBetween(asOfDate, r.expiryDate);
        if (days < 0) cell = grid[r.category][1]; // overdue, awaiting recognition now
        else cell = grid[r.category][2 + Math.min(Math.floor(days / BUCKET_DAYS), MAX_FWD_BUCKET_IDX)];
      } else {
        return; // USED/VOID/GRACE_USED — not part of this forecast
      }
      cell.qty += 1; cell.amt += (r.amountA || 0);
    });
    return { grid: grid, colCount: colCount };
  }

  function forecastColLabel(idx) {
    if (idx === 0) return t('eq.bucket.completed');
    if (idx === 1) return t('eq.bucket.pending');
    return fwdBucketLabel(idx - 2);
  }

  function renderBucketBreakdown() {
    var container = document.getElementById('eq-bucket-wrap');
    if (!container) return;
    container.innerHTML = '';

    // Uses the 기준일 (as-of date) selector so the whole forecast — "완료(올해 누적)", the overdue
    // queue, and the forward 6-month windows — is computed relative to whatever date you pick.
    var asOfDate = asOf();
    var result = computeForecastGrid(asOfDate);
    var grid = result.grid, colCount = result.colCount;
    var cats = Object.keys(CertApp.CATEGORY);

    var colTotals = [];
    for (var i = 0; i < colCount; i++) colTotals.push({ qty: 0, amt: 0 });
    cats.forEach(function (c) {
      grid[c].forEach(function (cell, idx) { colTotals[idx].qty += cell.qty; colTotals[idx].amt += cell.amt; });
    });
    if (colTotals.every(function (b) { return b.qty === 0; })) return;

    // Two-row header: row 1 groups each bucket under one merged label (e.g. "전환 완료")
    // spanning its 건수/금액 pair, row 2 spells out just "건수"/"금액" beneath it — shorter
    // than repeating the full bucket name in every column header, easier to scan.
    var groupHeaderCells = [ui.el('th', { class: 'col-align-left', rowspan: '2', text: t('eq.bucket.category') })];
    var subHeaderCells = [];
    for (var b = 0; b < colCount; b++) {
      groupHeaderCells.push(ui.el('th', { class: 'col-align-right al-group-th', colspan: '2', text: forecastColLabel(b) }));
      subHeaderCells.push(ui.el('th', { class: 'col-align-right al-sub-th', text: t('eq.bucket.qtyCol') }));
      subHeaderCells.push(ui.el('th', { class: 'col-align-right al-sub-th', text: t('eq.bucket.amtCol') }));
    }
    groupHeaderCells.push(ui.el('th', { class: 'col-align-right', rowspan: '2', text: t('ov.total') }));
    var thead = ui.el('thead', {}, [ui.el('tr', {}, groupHeaderCells), ui.el('tr', {}, subHeaderCells)]);

    var tbody = ui.el('tbody');
    cats.forEach(function (c) {
      var catTotalQty = grid[c].reduce(function (s, cell) { return s + cell.qty; }, 0);
      if (catTotalQty === 0) return;
      var row = [ui.el('td', { class: 'col-align-left', text: CertApp.CATEGORY_LABEL[c] })];
      grid[c].forEach(function (cell) {
        row.push(ui.el('td', { class: 'col-align-right', text: cell.qty ? ui.formatNumber(cell.qty) + t('common.cases') : '–' }));
        row.push(ui.el('td', { class: 'col-align-right', text: cell.qty ? ui.formatCurrency(cell.amt) : '–' }));
      });
      row.push(ui.el('td', { class: 'col-align-right', style: 'font-weight:800', text: ui.formatNumber(catTotalQty) + t('common.cases') }));
      tbody.appendChild(ui.el('tr', {}, row));
    });

    // Bottom total line: sum of every category, per bucket (qty + amount) plus a grand total qty.
    var grandQty = colTotals.reduce(function (s, b) { return s + b.qty; }, 0);
    var totalRow = [ui.el('td', { class: 'col-align-left', text: t('ov.total') })];
    colTotals.forEach(function (cell) {
      totalRow.push(ui.el('td', { class: 'col-align-right', text: cell.qty ? ui.formatNumber(cell.qty) + t('common.cases') : '–' }));
      totalRow.push(ui.el('td', { class: 'col-align-right', text: cell.qty ? ui.formatCurrency(cell.amt) : '–' }));
    });
    totalRow.push(ui.el('td', { class: 'col-align-right', text: ui.formatNumber(grandQty) + t('common.cases') }));
    tbody.appendChild(ui.el('tr', { class: 'eq-total-row' }, totalRow));

    var table = ui.el('table', { class: 'data-table' }, [thead, tbody]);

    container.appendChild(ui.el('div', { class: 'panel' }, [
      ui.el('h3', {}, [
        t('eq.bucket.title') + ' ',
        ui.el('span', { class: 'muted', style: 'font-size:12px;font-weight:600', text: '(' + t('eq.asOf') + ' ' + asOfDate + ')' })
      ]),
      ui.el('div', { class: 'muted bucket-caption', text: t('eq.bucket.caption') }),
      ui.el('div', { class: 'table-scroll' }, [table])
    ]));
  }

  function renderTable() {
    selectedIds = {};
    var fullQueue = CertApp.calculationEngine.computeExpiryQueue(asOf());
    var queue = fullQueue.filter(matchesFilters);
    document.getElementById('eq-count').textContent = t('eq.count', { n: ui.formatNumber(queue.length), total: ui.formatNumber(fullQueue.length) });
    renderBucketBreakdown();

    var tableWrap = document.getElementById('eq-table-wrap');
    tableWrap.innerHTML = '';
    var table = ui.el('table', { class: 'data-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', {}, [ui.el('input', { type: 'checkbox', id: 'eq-select-all' })]),
      ui.el('th', { text: t('eq.col.certNo') }),
      ui.el('th', { class: 'col-align-left', text: t('eq.col.category') }),
      ui.el('th', { class: 'col-align-right', text: t('eq.col.salePrice') }),
      ui.el('th', { class: 'col-align-center', text: t('eq.col.issuedDate') }),
      ui.el('th', { class: 'col-align-center', text: t('eq.col.expiryDate') }),
      ui.el('th', { class: 'col-align-right', text: t('eq.col.daysOverdue') }),
      ui.el('th', { class: 'col-align-right', text: t('eq.col.conversion') }),
      ui.el('th', { class: 'col-align-center', text: t('eq.col.action') })
    ])]);
    var tbody = ui.el('tbody');
    queue.forEach(function (item) {
      var cb = ui.el('input', { type: 'checkbox', onchange: function (e) {
        if (e.target.checked) selectedIds[item.record.id] = true; else delete selectedIds[item.record.id];
      } });
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', {}, [cb]),
        ui.el('td', {}, [ui.el('button', {
          class: 'link-btn', text: item.record.certificateNo, title: t('cd.viewDetailTitle'),
          onclick: function () { CertApp.ui.openCertificateDetail(item.record.id); }
        })]),
        ui.el('td', { class: 'col-align-left', text: CertApp.CATEGORY_LABEL[item.record.category] }),
        ui.el('td', { class: 'col-align-right', text: ui.formatCurrency(item.record.amountA) }),
        ui.el('td', { class: 'col-align-center', text: item.record.issuedDate || '–' }),
        ui.el('td', { class: 'col-align-center', text: item.record.expiryDate || '–' }),
        ui.el('td', { class: 'col-align-right', text: item.daysOverdue + t('eq.daysUnit') }),
        ui.el('td', { class: 'col-align-right' }, [conversionCell(item)]),
        ui.el('td', { class: 'col-align-center' }, [ui.el('button', {
          class: 'btn btn-small', text: t('eq.extend.button'),
          onclick: function () { onExtend(item.record); }
        })])
      ]));
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    if (queue.length === 0) tableWrap.appendChild(ui.el('div', { class: 'empty-state', text: t('eq.emptyState') }));

    var selectAll = document.getElementById('eq-select-all');
    if (selectAll) {
      selectAll.addEventListener('change', function (e) {
        var checked = e.target.checked;
        tbody.querySelectorAll('input[type=checkbox]').forEach(function (cbEl, idx) {
          cbEl.checked = checked;
          if (checked) selectedIds[queue[idx].record.id] = true; else delete selectedIds[queue[idx].record.id];
        });
      });
    }
  }

  // Extend an expired-but-still-ACTIVE certificate's validity once a manager (Mate) approves —
  // shared modal (also used from the Certificate Detail panel). On success the cert leaves the
  // queue (expiryDate is now in the future) and stays ACTIVE.
  function onExtend(rec) {
    ui.openExtendModal(rec, function () { refresh(); CertApp.router.refresh(); });
  }

  function onRecognizeSelected() {
    var ids = Object.keys(selectedIds);
    if (ids.length === 0) { ui.toast(t('eq.noneSelected'), 'warn'); return; }
    var d = asOf();
    ui.openModal(t('eq.recognizeConfirm.title'), [
      ui.el('div', {}, [t('eq.recognizeConfirm.body', { n: ui.formatNumber(ids.length) })]),
      ui.el('div', { class: 'muted', style: 'margin-top:8px' }, [t('eq.recognizeConfirm.note', { date: d })])
    ], function () {
      CertApp.certificateWorkflow.bulkRecognizeExpiry(ids, d).then(function (result) {
        var errs = result.errors;
        ui.toast(result.results.length + t('eq.toast.recognizeDone') + (errs.length ? (', ' + errs.length + t('cl.toast.errorsSuffix')) : ''), errs.length ? 'warn' : 'success');
        refresh();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('eq.recognizeConfirm.confirm'));
  }

  function onRecognizeAll() {
    var d = asOf();
    var fullQueue = CertApp.calculationEngine.computeExpiryQueue(d);
    if (fullQueue.length === 0) { ui.toast(t('eq.noneWaiting'), 'info'); return; }
    ui.openModal(t('eq.recognizeAllConfirm.title'), [
      ui.el('div', {}, [t('eq.recognizeAllConfirm.body', { n: ui.formatNumber(fullQueue.length) })]),
      ui.el('div', { class: 'warn-text', style: 'margin-top:8px' }, [t('eq.recognizeConfirm.note', { date: d })])
    ], function () {
      var ids = fullQueue.map(function (item) { return item.record.id; });
      CertApp.certificateWorkflow.bulkRecognizeExpiry(ids, d).then(function (result) {
        var errs = result.errors;
        ui.toast(result.results.length + t('eq.toast.recognizeAllDone') + (errs.length ? (', ' + errs.length + t('cl.toast.errorsSuffix')) : ''), errs.length ? 'warn' : 'success');
        refresh();
        CertApp.router.refresh();
      }).catch(function (err) { ui.toast(err.message, 'error'); });
    }, t('eq.recognizeAllConfirm.confirm'));
  }

  return { render: render };
})();
