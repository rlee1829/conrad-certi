/* Audit Log view: every business mutation (issue/use/void/expire-recognize/grace-use/correct/
   delete/undo/import) recorded by certificateWorkflow.js's logAudit(), grouped into one row
   per (actor + action + same minute) — real bulk operations (import, bulk-use, bulk-correct,
   etc.) already share one explicit batchId (see certificateWorkflow.js withBatch), so those
   always collapse into a single row regardless of size. Entries logged outside a batch (e.g.
   one-off inline corrections) only merge when the SAME operator did the SAME action within
   the SAME minute — distinct edits made at different times stay as their own separate rows,
   rather than every "수정" ever performed collapsing into one giant umbrella row.
   Expanding a row reveals the individual certificate-level entries in that group, each with
   its own diff summary (via auditUtil.summarizeEntry) and a link into Certificate Detail.
   Fetches fresh from IndexedDB on every render — the log isn't mirrored into an in-memory
   cache (see certificateWorkflow.js), matching the existing import-history pattern. */
window.CertApp = window.CertApp || {};
CertApp.viewAuditLog = (function () {
  var ui = CertApp.ui;
  var au = CertApp.auditUtil;
  var t = CertApp.i18n.t;
  var PAGE_SIZE = 20;

  var state = { search: '', action: '', tsStart: '', tsEnd: '', page: 1 };
  var allEntries = [];
  var expandedGroups = {};

  function render(container) {
    state = { search: '', action: '', tsStart: '', tsEnd: '', page: 1 };
    expandedGroups = {};
    var wrap = ui.el('div', { class: 'view-audit-log' });

    var actionOptions = [ui.el('option', { value: '', text: t('al.allActions') })].concat(
      Object.keys(CertApp.AUDIT_ACTION).map(function (a) { return ui.el('option', { value: a, text: t('al.action.' + a) }); })
    );

    var filterRow = ui.el('div', { class: 'panel controls-row controls-row-tight' }, [
      ui.el('input', { type: 'text', placeholder: t('al.searchCertNo'), oninput: function (e) { state.search = e.target.value; state.page = 1; renderTable(); } }),
      ui.el('select', { onchange: function (e) { state.action = e.target.value; state.page = 1; renderTable(); } }, actionOptions),
      ui.el('label', {}, [t('al.tsFrom') + ' ', ui.el('input', { type: 'date', onchange: function (e) { state.tsStart = e.target.value; state.page = 1; renderTable(); } })]),
      ui.el('span', { text: '~' }),
      ui.el('input', { type: 'date', onchange: function (e) { state.tsEnd = e.target.value; state.page = 1; renderTable(); } }),
      ui.refreshButton()
    ]);
    wrap.appendChild(filterRow);

    wrap.appendChild(ui.el('div', { class: 'muted', id: 'al-count', style: 'margin-bottom:8px' }));
    wrap.appendChild(ui.el('div', { class: 'panel table-scroll', id: 'al-table-wrap' }));
    wrap.appendChild(ui.el('div', { class: 'pager', id: 'al-pager' }));

    container.appendChild(wrap);

    CertApp.db.getAll('auditLog').then(function (entries) {
      allEntries = entries;
      renderTable();
    });
  }

  function matches(e) {
    if (state.action && e.action !== state.action) return false;
    if (state.search && (e.certificateNo || '').toLowerCase().indexOf(state.search.toLowerCase()) === -1) return false;
    var d = e.ts.slice(0, 10);
    if (state.tsStart && d < state.tsStart) return false;
    if (state.tsEnd && d > state.tsEnd) return false;
    return true;
  }

  // Real bulk operations share an explicit batchId, so they always merge no matter how long
  // they take or how many rows they touch. Entries with no batchId only merge when the same
  // actor performed the same action within the same minute (ts truncated to YYYY-MM-DDTHH:MM)
  // — a looser "same instant" match would basically never fire for genuinely separate edits,
  // and a looser window (e.g. same day) would recreate the "everything lumped together"
  // problem this replaces.
  function groupKey(e) {
    if (e.batchId) return e.batchId;
    return 'm:' + (e.actor || '–') + '|' + e.action + '|' + e.ts.slice(0, 16);
  }

  function groupEntries(entries) {
    var groups = {};
    var order = [];
    entries.forEach(function (e) {
      var key = groupKey(e);
      if (!groups[key]) { groups[key] = { key: key, action: e.action, actor: e.actor, entries: [] }; order.push(key); }
      groups[key].entries.push(e);
    });
    var list = order.map(function (key) { return groups[key]; });
    list.forEach(function (g) {
      g.entries.sort(function (a, b) { return a.ts < b.ts ? -1 : 1; });
      g.ts = g.entries[g.entries.length - 1].ts; // latest entry = when the group finished
      g.count = g.entries.length;
    });
    list.sort(function (a, b) { return a.ts < b.ts ? 1 : -1; }); // newest first
    return list;
  }

  var CERT_PREVIEW_MAX = 3;
  function certPreview(entries) {
    var nos = entries.map(function (e) { return e.certificateNo; }).filter(Boolean);
    if (nos.length <= CERT_PREVIEW_MAX) return nos.join(', ');
    return nos.slice(0, CERT_PREVIEW_MAX).join(', ') + ' ' + t('undo.andMore', { n: nos.length - CERT_PREVIEW_MAX });
  }

  function groupSummary(g) {
    if (g.count === 1) return au.summarizeEntry(g.entries[0]);
    var preview = certPreview(g.entries);
    var note = g.entries[0].note;
    return preview + (note ? ' — "' + note + '"' : '');
  }

  function renderTable() {
    var filtered = allEntries.filter(matches);
    var groups = groupEntries(filtered);
    var countEl = document.getElementById('al-count');
    if (countEl) countEl.textContent = t('al.count', { n: ui.formatNumber(groups.length), total: ui.formatNumber(allEntries.length) });

    var totalPages = Math.max(1, Math.ceil(groups.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    var startIdx = (state.page - 1) * PAGE_SIZE;
    var pageGroups = groups.slice(startIdx, startIdx + PAGE_SIZE);

    var tableWrap = document.getElementById('al-table-wrap');
    if (!tableWrap) return;
    tableWrap.innerHTML = '';
    var table = ui.el('table', { class: 'data-table' });
    var thead = ui.el('thead', {}, [ui.el('tr', {}, [
      ui.el('th', { text: '' }),
      ui.el('th', { text: t('al.col.ts') }),
      ui.el('th', { text: t('al.col.action') }),
      ui.el('th', { class: 'col-align-right', text: t('al.col.count') }),
      ui.el('th', { text: t('al.col.actor') }),
      ui.el('th', { text: t('al.col.summary') })
    ])]);
    var tbody = ui.el('tbody');

    pageGroups.forEach(function (g) {
      var expanded = !!expandedGroups[g.key];
      tbody.appendChild(ui.el('tr', {}, [
        ui.el('td', {}, [ui.el('button', {
          class: 'link-btn', text: expanded ? '▾' : '▸', title: t('al.toggleDetail'),
          onclick: function () { expandedGroups[g.key] = !expandedGroups[g.key]; renderTable(); }
        })]),
        ui.el('td', { text: g.ts.replace('T', ' ').slice(0, 19) }),
        ui.el('td', {}, [au.actionBadge(g.action)]),
        ui.el('td', { class: 'col-align-right', text: ui.formatNumber(g.count) + t('common.cases') }),
        ui.el('td', { text: g.actor || '–' }),
        ui.el('td', { text: groupSummary(g) })
      ]));

      if (expanded) {
        var detailRows = g.entries.map(function (e) {
          return ui.el('div', { class: 'al-detail-row' }, [
            ui.el('button', {
              class: 'link-btn', text: e.certificateNo, title: t('cd.viewDetailTitle'),
              onclick: function () { CertApp.ui.openCertificateDetail(e.certificateId); }
            }),
            ui.el('span', { class: 'muted', text: ' — ' + au.summarizeEntry(e) })
          ]);
        });
        tbody.appendChild(ui.el('tr', { class: 'al-detail-tr' }, [
          ui.el('td', { colspan: '6', class: 'al-detail-cell' }, [ui.el('div', { class: 'al-detail-list' }, detailRows)])
        ]));
      }
    });

    table.appendChild(thead);
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    if (groups.length === 0) tableWrap.appendChild(ui.el('div', { class: 'empty-state', text: t('eq.emptyState') }));

    renderPager(totalPages);
  }

  function renderPager(totalPages) {
    var pager = document.getElementById('al-pager');
    if (!pager) return;
    pager.innerHTML = '';

    function goToPage(p) {
      state.page = Math.max(1, Math.min(totalPages, p));
      renderTable();
    }

    pager.appendChild(ui.el('button', { class: 'btn', disabled: state.page <= 1 ? 'disabled' : null, onclick: function () { goToPage(state.page - 1); } }, [t('common.prev')]));
    var pageInput = ui.el('input', { type: 'number', min: '1', max: String(totalPages), value: state.page });
    pageInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') goToPage(parseInt(pageInput.value, 10) || 1); });
    pager.appendChild(ui.el('span', { class: 'muted', text: ' ' + t('common.page') + ' ' }));
    pager.appendChild(pageInput);
    pager.appendChild(ui.el('span', { class: 'muted', text: ' / ' + totalPages + ' ' }));
    pager.appendChild(ui.el('button', { class: 'btn', text: t('common.move'), onclick: function () { goToPage(parseInt(pageInput.value, 10) || 1); } }));
    pager.appendChild(ui.el('button', { class: 'btn', disabled: state.page >= totalPages ? 'disabled' : null, onclick: function () { goToPage(state.page + 1); } }, [t('common.next')]));
  }

  return { render: render };
})();
