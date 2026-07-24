/* Shared UI helpers: formatting, element creation, table renderer, toast */
window.CertApp = window.CertApp || {};
CertApp.ui = CertApp.ui || {};

CertApp.ui.formatCurrency = function (n) {
  n = n || 0;
  return CertApp.i18n.getLang() === 'en' ? '₩' + n.toLocaleString('ko-KR') : n.toLocaleString('ko-KR') + '원';
};

CertApp.ui.formatNumber = function (n) {
  return (n || 0).toLocaleString('ko-KR');
};

CertApp.ui.formatDate = function (isoDate) {
  return isoDate || '–'; // –
};

// Shared default period across Overview and Certificate List: cleared (no filter) by
// default — computeSummary treats an empty start/end as unbounded on that side (see
// calculationEngine.js). Native date inputs still open their picker on the current month
// when empty, so "today" is one click away without forcing a default range on load.
CertApp.ui.defaultPeriod = function () {
  return { start: '', end: '' };
};

CertApp.ui.el = function (tag, attrs, children) {
  var node = document.createElement(tag);
  attrs = attrs || {};
  Object.keys(attrs).forEach(function (k) {
    var v = attrs[k];
    if (v === null || v === undefined || v === false) return; // omit — e.g. disabled: cond ? 'disabled' : null
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  (children || []).forEach(function (c) {
    if (c === null || c === undefined) return;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return node;
};

CertApp.ui.toast = function (message, kind) {
  var container = document.getElementById('toast-container');
  if (!container) {
    container = CertApp.ui.el('div', { id: 'toast-container' });
    document.body.appendChild(container);
  }
  var node = CertApp.ui.el('div', { class: 'toast toast-' + (kind || 'info'), text: message });
  container.appendChild(node);
  setTimeout(function () { node.classList.add('toast-fade'); }, 2200);
  setTimeout(function () { node.remove(); }, 2600);
};

var STATUS_BADGE_CLASS = {
  ACTIVE: 'badge-active',
  EXPIRED_PENDING: 'badge-pending', // virtual, not physically stored — see calculationEngine.js
  USED: 'badge-used',
  VOID: 'badge-void',
  EXPIRED_RECOGNIZED: 'badge-recognized',
  GRACE_USED: 'badge-grace'
};

// Colored pill for a status value (real or the virtual EXPIRED_PENDING display status).
// Coloring is keyed off the raw enum value; the visible text goes through
// displayStatusLabelForRecord() (when a record is supplied) so e.g. a Service Certificate
// past its 5-year Grace Use window reads "MISC INCOME (FINAL)" instead of the generic
// "TR TO REVENUE" — falls back to the plain displayStatusLabel() when no record is given
// (e.g. enumerating a filter dropdown's options with no specific certificate in hand).
CertApp.ui.statusBadge = function (statusText, rec) {
  var cls = STATUS_BADGE_CLASS[statusText] || 'badge-default';
  var label = rec ? CertApp.displayStatusLabelForRecord(rec, statusText) : CertApp.displayStatusLabel(statusText);
  if (rec && label.indexOf('FINAL') !== -1) cls += ' badge-final';
  // Hover tooltip explaining what this status means for THIS record (see schema.statusHelp) —
  // the meaning shifts by 종류/유효기간, which is what makes the bare label confusing.
  var attrs = { class: 'status-badge ' + cls, text: label };
  var help = rec ? CertApp.statusHelp(rec, statusText) : '';
  if (help) { attrs.title = help; attrs.class += ' has-help'; }
  return CertApp.ui.el('span', attrs);
};

// Table renderer: columns = [{key, label, format?, onHeaderClick?, align?}], rows = array of
// plain objects. format() may return a plain value (rendered as text) or a DOM Node (e.g. a
// button/select), which is appended directly — this lets callers put interactive controls
// inside cells. align: 'left'|'right' overrides the table's default center alignment (see
// .data-table th/td in style.css) — leave unset for center, which is the default for
// everything that isn't specifically an amount (right) or a category/type label (left).
CertApp.ui.renderTable = function (container, columns, rows) {
  container.innerHTML = '';
  var table = CertApp.ui.el('table', { class: 'data-table' });
  // A column may add its own class via `cellClass` (applied to both th and td) — used for
  // per-column spacing/separators that the align option can't express.
  function alignClass(c) {
    var cls = c.align === 'left' ? ' col-align-left' : (c.align === 'right' ? ' col-align-right' : '');
    return c.cellClass ? (cls + ' ' + c.cellClass) : cls;
  }

  // If any column declares a pixel width, switch to a fixed layout with an explicit colgroup so
  // column widths stay identical no matter what the cell contents are (e.g. after re-sorting or
  // paging to rows with longer/shorter values).
  if (columns.some(function (c) { return c.width; })) {
    table.classList.add('table-fixed');
    table.appendChild(CertApp.ui.el('colgroup', {}, columns.map(function (c) {
      return CertApp.ui.el('col', c.width ? { style: 'width:' + c.width + 'px' } : {});
    })));
  }
  var thead = CertApp.ui.el('thead', {}, [
    CertApp.ui.el('tr', {}, columns.map(function (c) {
      // headerNode lets a column supply an interactive header (e.g. a select-all checkbox)
      // instead of plain label text.
      var th = c.headerNode
        ? CertApp.ui.el('th', { class: alignClass(c).trim() }, [c.headerNode])
        : CertApp.ui.el('th', { class: alignClass(c).trim(), text: c.label + (c.sortIndicator || '') });
      if (c.onHeaderClick) {
        th.classList.add('sortable-th');
        th.addEventListener('click', c.onHeaderClick);
      }
      return th;
    }))
  ]);
  var tbody = CertApp.ui.el('tbody');
  rows.forEach(function (row) {
    var tr = CertApp.ui.el('tr', row.needsReview ? { class: 'row-needs-review' } : {});
    columns.forEach(function (c) {
      var raw = row[c.key];
      var value = c.format ? c.format(raw, row) : (raw === null || raw === undefined ? '–' : raw);
      var td = CertApp.ui.el('td', { class: alignClass(c).trim() });
      if (value instanceof Node) td.appendChild(value);
      else td.textContent = (value === null || value === undefined) ? '–' : value;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
  if (rows.length === 0) {
    container.appendChild(CertApp.ui.el('div', { class: 'empty-state', text: CertApp.i18n.t('common.noData') }));
  }
};

// Renders a small "최근 작업: X — 되돌리기" bar into containerId if there's an undoable last
// action (see certificateWorkflow.getLastActionLabel/undoLastAction), else clears it. Call
// this after every render/refresh so the indicator tracks whatever just happened.
CertApp.ui.renderUndoBar = function (containerId, onUndone) {
  var el = document.getElementById(containerId);
  if (!el) return;
  var label = CertApp.certificateWorkflow.getLastActionLabel();
  var detail = CertApp.certificateWorkflow.getLastActionDetail();
  el.innerHTML = '';
  if (!label) return;
  var barText = detail
    ? CertApp.i18n.t('undo.recentWithDetail', { label: label, detail: detail })
    : CertApp.i18n.t('undo.recent', { label: label });
  el.appendChild(CertApp.ui.el('div', { class: 'undo-bar' }, [
    CertApp.ui.el('span', { text: barText }),
    CertApp.ui.el('button', {
      class: 'btn', text: CertApp.i18n.t('undo.button'), onclick: function () {
        CertApp.certificateWorkflow.undoLastAction().then(function (undoneLabel) {
          CertApp.ui.toast(CertApp.i18n.t('undo.done', { label: undoneLabel }), 'success');
          if (onUndone) onUndone();
        }).catch(function (err) { CertApp.ui.toast(err.message, 'error'); });
      }
    }),
    CertApp.ui.el('button', {
      class: 'btn undo-dismiss-btn', text: CertApp.i18n.t('undo.dismiss'), onclick: function () {
        CertApp.certificateWorkflow.dismissLastAction();
        if (onUndone) onUndone(); else CertApp.ui.renderUndoBar(containerId);
      }
    })
  ]));
};

// Per-tab "새로고침" button: re-renders just the current view in place (same tab, filters
// reset to that view's own defaults) via CertApp.router.refresh() — deliberately does NOT
// navigate elsewhere, unlike a real browser reload (see app.js boot, which now restores the
// last-viewed tab instead of always landing back on Overview).
CertApp.ui.refreshButton = function () {
  return CertApp.ui.el('button', { class: 'btn refresh-btn', title: CertApp.i18n.t('common.refresh'), onclick: function () { CertApp.router.refresh(); } }, [
    CertApp.ui.el('span', { class: 'refresh-btn-icon' }, [(function () {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.innerHTML = '<path d="M21 12a9 9 0 1 1-2.64-6.36"></path><path d="M21 4v6h-6"></path>';
      return svg;
    })()]),
    CertApp.i18n.t('common.refresh')
  ]);
};

// Wide info-only modal (no confirm/cancel — just a close button): used for read-heavy panels
// like Certificate Detail where forcing the confirm/cancel footer pattern would be misleading.
CertApp.ui.openPanel = function (title, bodyChildren) {
  var existing = document.getElementById('modal-backdrop');
  if (existing) existing.remove();

  var backdrop = CertApp.ui.el('div', { id: 'modal-backdrop', class: 'modal-backdrop' });
  var closeFn = function () { backdrop.remove(); };

  var box = CertApp.ui.el('div', { class: 'modal-box modal-box-wide' }, [
    CertApp.ui.el('div', { class: 'modal-header' }, [
      CertApp.ui.el('h3', { text: title }),
      CertApp.ui.el('button', { class: 'modal-close', text: '×', onclick: closeFn })
    ]),
    CertApp.ui.el('div', { class: 'modal-body' }, bodyChildren)
  ]);
  backdrop.appendChild(box);
  // Deliberately no backdrop click-to-close here: a stray click outside a read panel used to
  // dismiss it and lose the user's place. Close only via the × button.
  document.body.appendChild(backdrop);
  return closeFn;
};

// Prompts for the local operator name (see operator.js) and re-renders the sidebar chip on
// save. Used both for the initial one-time prompt on boot and the "change" click afterward.
CertApp.ui.promptOperator = function (onSaved) {
  var ui = CertApp.ui, t = CertApp.i18n.t;
  var input = ui.el('input', { type: 'text', value: CertApp.operator.getName(), placeholder: t('operator.nameLabel') });

  // Department picker: the built-in/known departments plus a "기타(직접 입력)" choice that reveals
  // a free-text box; a newly typed department is remembered for next time (operator.addDepartment).
  var OTHER = '__other__';
  var curDept = CertApp.operator.getDept();
  var depts = CertApp.operator.departments();
  var deptOptions = [ui.el('option', Object.assign({ value: '', text: '—' }, curDept === '' ? { selected: 'selected' } : {}))]
    .concat(depts.map(function (d) {
      return ui.el('option', Object.assign({ value: d, text: d }, d === curDept ? { selected: 'selected' } : {}));
    }))
    .concat([ui.el('option', { value: OTHER, text: t('operator.deptOther') })]);
  var deptSelect = ui.el('select', {}, deptOptions);
  var deptOther = ui.el('input', { type: 'text', placeholder: t('operator.deptOtherPlaceholder'), style: 'margin-top:8px' });
  deptOther.style.display = 'none';
  deptSelect.addEventListener('change', function () {
    var isOther = deptSelect.value === OTHER;
    deptOther.style.display = isOther ? '' : 'none';
    if (isOther) deptOther.focus();
  });

  var isChange = !!CertApp.operator.getName();
  ui.openModal(isChange ? t('operator.changeTitle') : t('operator.promptTitle'), [
    ui.el('div', { class: 'muted', style: 'margin-bottom:10px' }, [t('operator.promptDesc')]),
    ui.el('div', { style: 'margin-bottom:10px' }, [ui.el('label', { text: t('operator.nameLabel') }), input]),
    ui.el('div', {}, [ui.el('label', { text: t('operator.deptLabel') }), deptSelect, deptOther])
  ], function () {
    var name = input.value.trim();
    if (!name) { ui.toast(t('operator.nameRequired'), 'warn'); input.focus(); return false; }
    var dept = deptSelect.value === OTHER ? deptOther.value.trim() : deptSelect.value;
    if (deptSelect.value === OTHER && dept) CertApp.operator.addDepartment(dept);
    CertApp.operator.set(name, dept);
    ui.renderOperatorChip();
    if (onSaved) onSaved();
  }, t('common.save'));
};

// Small clickable "Operator: X" chip rendered into the sidebar footer (see index.html).
CertApp.ui.renderOperatorChip = function () {
  var el = document.getElementById('operator-chip');
  if (!el) return;
  var t = CertApp.i18n.t;
  // get() is the combined "이름 (부서)" display — same string that lands in the audit log.
  var display = CertApp.operator.get();
  el.innerHTML = '';
  el.appendChild(CertApp.ui.el('button', {
    class: 'operator-chip-btn', onclick: function () { CertApp.ui.promptOperator(); }
  }, [
    CertApp.ui.el('span', { class: 'operator-chip-label', text: t('operator.label') + ': ' }),
    CertApp.ui.el('span', { class: 'operator-chip-name', text: display || t('operator.unset') })
  ]));
};

// A "사용자 전환" button in the sidebar footer. No password — it just re-opens the name prompt
// (pre-filled with the current name) so the next person can put their own name on the audit log.
CertApp.ui.renderSwitchUserLink = function () {
  var footer = document.querySelector('.sidebar-footer');
  if (!footer || document.getElementById('switch-user-link')) return;
  footer.appendChild(CertApp.ui.el('button', {
    id: 'switch-user-link', class: 'logout-link',
    onclick: function () { CertApp.ui.promptOperator(); }
  }, [CertApp.i18n.t('operator.switch')]));
};

// Shared-password mode: a small "로그아웃" link in the sidebar footer that clears the login
// session and reloads (back to the login screen).
CertApp.ui.renderLogoutLink = function () {
  var footer = document.querySelector('.sidebar-footer');
  if (!footer || document.getElementById('logout-link')) return;
  footer.appendChild(CertApp.ui.el('button', {
    id: 'logout-link', class: 'logout-link',
    onclick: function () { CertApp.auth.signOut().then(function () { location.reload(); }); }
  }, [CertApp.i18n.t('login.logout')]));
};

// Shared "유효기간 연장" (extend validity) modal — used from both the Expiry Queue (per-row
// button) and the Certificate Detail panel (so an expired cert browsed in the Certificate List
// can be extended too). Requires a Mate Approval # + a future new expiry date; on success calls
// onDone() so the caller can refresh its own view. Eligibility (ACTIVE only, i.e. not USED /
// not yet misc-income-converted / not void) is enforced inside certificateWorkflow.extendExpiry.
CertApp.ui.openExtendModal = function (rec, onDone) {
  var ui = CertApp.ui, t = CertApp.i18n.t;
  var d = new Date(); d.setFullYear(d.getFullYear() + 1);
  var newDateInput = ui.el('input', { type: 'date', value: CertApp.formatLocalDate(d) });
  var approvalInput = ui.el('input', { type: 'text', placeholder: t('eq.extend.approvalPlaceholder') });
  ui.openModal(t('eq.extend.title', { certNo: rec.certificateNo }), [
    ui.el('div', { class: 'muted', style: 'margin-bottom:12px' }, [t('eq.extend.desc')]),
    ui.el('div', { style: 'margin-bottom:12px' }, [
      ui.el('label', {}, [t('eq.extend.currentExpiry')]),
      ui.el('div', { class: 'cd-field-value', text: rec.expiryDate || '–' })
    ]),
    ui.el('div', { style: 'margin-bottom:12px' }, [ui.el('label', {}, [t('eq.extend.newExpiry')]), newDateInput]),
    ui.el('div', {}, [ui.el('label', {}, [t('eq.extend.approvalNo')]), approvalInput])
  ], function () {
    var approvalNo = approvalInput.value.trim();
    if (!approvalNo) { ui.toast(t('eq.extend.needApproval'), 'warn'); return false; }
    CertApp.certificateWorkflow.extendExpiry(rec.id, { newExpiryDate: newDateInput.value, approvalNo: approvalNo }).then(function () {
      ui.toast('1' + t('eq.extend.done'), 'success');
      if (onDone) onDone();
    }).catch(function (err) { ui.toast(err.message, 'error'); });
  }, t('eq.extend.confirm'));
};

// Simple modal: title + body elements + confirm/cancel. onConfirm may return false to keep it open.
CertApp.ui.openModal = function (title, bodyChildren, onConfirm, confirmLabel) {
  var existing = document.getElementById('modal-backdrop');
  if (existing) existing.remove();

  var backdrop = CertApp.ui.el('div', { id: 'modal-backdrop', class: 'modal-backdrop' });
  var closeFn = function () { backdrop.remove(); };

  var box = CertApp.ui.el('div', { class: 'modal-box' }, [
    CertApp.ui.el('div', { class: 'modal-header' }, [
      CertApp.ui.el('h3', { text: title }),
      CertApp.ui.el('button', { class: 'modal-close', text: '×', onclick: closeFn })
    ]),
    CertApp.ui.el('div', { class: 'modal-body' }, bodyChildren),
    CertApp.ui.el('div', { class: 'modal-footer' }, [
      CertApp.ui.el('button', { class: 'btn', text: CertApp.i18n.t('common.cancel'), onclick: closeFn }),
      CertApp.ui.el('button', {
        class: 'btn btn-primary', text: confirmLabel || CertApp.i18n.t('common.confirm'), onclick: function () {
          var result = onConfirm();
          if (result !== false) closeFn();
        }
      })
    ])
  ]);
  backdrop.appendChild(box);
  // No backdrop click-to-close: an accidental click outside a data-entry form (e.g. 사용 처리)
  // must not discard everything typed. Close only via 취소 or the × button.
  document.body.appendChild(backdrop);
  return closeFn;
};
