/* 데이터 정합성 점검 view — runs CertApp.integrityCheck over every certificate and lists the
   records that violate a rule, so systematic mis-bookings can be found and fixed in one place
   instead of hunted by hand. Each finding links to the Certificate Detail panel, and a "수정"
   action jumps to the Certificate List filtered to that certificate for an inline fix. */
window.CertApp = window.CertApp || {};
CertApp.viewIntegrity = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;

  var state = { code: '', severity: '' };

  function matches(f) {
    if (state.code && f.code !== state.code) return false;
    if (state.severity && f.severity !== state.severity) return false;
    return true;
  }

  function render(container) {
    state = { code: '', severity: '' };
    var wrap = ui.el('div', { class: 'view-integrity' });

    wrap.appendChild(ui.el('div', { class: 'panel muted' }, [t('ic.desc')]));

    var codeOptions = [ui.el('option', { value: '', text: t('ic.allChecks') })].concat(
      CertApp.integrityCheck.codes().map(function (c) { return ui.el('option', { value: c.code, text: t('ic.check.' + c.code) }); })
    );
    var sevOptions = [
      ui.el('option', { value: '', text: t('ic.allSeverity') }),
      ui.el('option', { value: 'error', text: t('ic.sev.error') }),
      ui.el('option', { value: 'warn', text: t('ic.sev.warn') })
    ];

    var controls = ui.el('div', { class: 'panel controls-row controls-row-tight' }, [
      ui.el('select', { onchange: function (e) { state.code = e.target.value; renderTable(); } }, codeOptions),
      ui.el('select', { onchange: function (e) { state.severity = e.target.value; renderTable(); } }, sevOptions),
      ui.refreshButton()
    ]);
    wrap.appendChild(controls);

    wrap.appendChild(ui.el('div', { class: 'summary-cards', id: 'ic-cards' }));
    wrap.appendChild(ui.el('div', { class: 'muted', id: 'ic-count', style: 'margin-bottom:8px' }));
    wrap.appendChild(ui.el('div', { class: 'panel table-scroll', id: 'ic-table-wrap' }));

    container.appendChild(wrap);
    renderTable();
  }

  function renderTable() {
    var all = CertApp.integrityCheck.run();
    var errors = all.filter(function (f) { return f.severity === 'error'; }).length;
    var warns = all.length - errors;

    var cardsEl = document.getElementById('ic-cards');
    if (cardsEl) {
      cardsEl.innerHTML = '';
      cardsEl.appendChild(card(t('ic.card.total'), ui.formatNumber(all.length) + t('common.cases'), all.length === 0 ? 'sc-ok' : ''));
      cardsEl.appendChild(card(t('ic.card.error'), ui.formatNumber(errors) + t('common.cases'), errors > 0 ? 'sc-danger' : ''));
      cardsEl.appendChild(card(t('ic.card.warn'), ui.formatNumber(warns) + t('common.cases'), warns > 0 ? 'sc-warn' : ''));
    }

    var rows = all.filter(matches);
    var countEl = document.getElementById('ic-count');
    if (countEl) countEl.textContent = t('ic.count', { n: ui.formatNumber(rows.length), total: ui.formatNumber(all.length) });

    var wrapEl = document.getElementById('ic-table-wrap');
    if (!wrapEl) return;

    if (all.length === 0) {
      wrapEl.innerHTML = '';
      wrapEl.appendChild(ui.el('div', { class: 'empty-state ic-clean', text: t('ic.clean') }));
      return;
    }

    var columns = [
      { key: 'certificateNo', label: t('cl.col.certNo'), width: 96, format: function (v, f) {
        return ui.el('button', { class: 'link-btn', text: v, title: t('cd.viewDetailTitle'), onclick: function () { CertApp.ui.openCertificateDetail(f.id); } });
      } },
      { key: 'category', label: t('cl.col.category'), width: 140, align: 'left', format: function (v) { return CertApp.CATEGORY_LABEL[v] || v; } },
      { key: 'severity', label: t('ic.col.severity'), width: 74, format: function (v) {
        return ui.el('span', { class: 'ic-sev ic-sev-' + v, text: v === 'error' ? t('ic.sev.error') : t('ic.sev.warn') });
      } },
      { key: 'code', label: t('ic.col.check'), width: 220, align: 'left', format: function (v) { return t('ic.check.' + v); } },
      { key: 'currentValues', label: t('ic.col.values'), align: 'left' },
      { key: 'fix', label: '', width: 72, format: function (v, f) {
        return ui.el('button', { class: 'btn btn-small', text: t('ic.fix'), onclick: function () {
          CertApp.viewCertificateList.showFiltered({ search: f.certificateNo });
          CertApp.router.go('certlist');
        } });
      } }
    ];
    ui.renderTable(wrapEl, columns, rows);
    if (rows.length === 0) wrapEl.appendChild(ui.el('div', { class: 'empty-state', text: t('ic.noneForFilter') }));
  }

  function card(label, value, cls) {
    return ui.el('div', { class: 'summary-card ' + (cls || '') }, [
      ui.el('div', { class: 'sc-label', text: label }),
      ui.el('div', { class: 'sc-value', text: value })
    ]);
  }

  return { render: render };
})();
