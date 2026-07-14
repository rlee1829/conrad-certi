/* Import/Export view: upload source workbooks, show import history/report, export.
   Reset is scoped three ways: undo one specific import batch (safest), reset by
   certificate family (Gift vs Service), or wipe everything. */
window.CertApp = window.CertApp || {};
CertApp.viewImportExport = (function () {
  var ui = CertApp.ui;
  var t = CertApp.i18n.t;

  // Reset/export scopes mirror the three source files 1:1: Gift Certificate, Service
  // Certificate (FB & Rooms only), and SPA & PULSE8.
  var GC_CATEGORIES = [CertApp.CATEGORY.GC_50000, CertApp.CATEGORY.GC_100000];
  var SC_CATEGORIES = [CertApp.CATEGORY.SC_FB_ROOMS];
  var SPA_PULSE8_CATEGORIES = [CertApp.CATEGORY.SC_SPA, CertApp.CATEGORY.SC_PULSE8];

  function render(container) {
    var wrap = ui.el('div', { class: 'view-import' });

    wrap.appendChild(ui.el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:2px' }, [ui.refreshButton()]));

    var uploadPanel = ui.el('div', { class: 'panel' }, [
      ui.el('h3', { text: t('ie.uploadTitle') }),
      ui.el('p', { class: 'muted', text: t('ie.uploadDesc') }),
      ui.el('input', { type: 'file', id: 'ie-file', accept: '.xlsx,.xlsb' }),
      ui.el('button', { class: 'btn btn-primary', id: 'ie-import-btn', text: t('ie.importBtn') }),
      ui.el('div', { id: 'ie-report', class: 'import-report' })
    ]);
    wrap.appendChild(uploadPanel);

    var exportPanel = ui.el('div', { class: 'panel' }, [
      ui.el('h3', { text: t('ie.exportTitle') }),
      ui.el('p', { class: 'muted', text: t('ie.exportDesc') }),
      ui.el('button', { class: 'btn', onclick: function () {
        try { CertApp.exportWorkbook.exportGiftCertificate(); ui.toast(t('ie.exportGiftDone'), 'success'); }
        catch (err) { ui.toast(t('ie.exportFail') + err.message, 'error'); }
      } }, [t('ie.exportGift')]),
      ui.el('button', { class: 'btn', onclick: function () {
        try { CertApp.exportWorkbook.exportServiceCertificate(); ui.toast(t('ie.exportServiceDone'), 'success'); }
        catch (err) { ui.toast(t('ie.exportFail') + err.message, 'error'); }
      } }, [t('ie.exportService')]),
      ui.el('button', { class: 'btn', onclick: function () {
        try { CertApp.exportWorkbook.exportSpaPulse8(); ui.toast(t('ie.exportSpaPulse8Done'), 'success'); }
        catch (err) { ui.toast(t('ie.exportFail') + err.message, 'error'); }
      } }, [t('ie.exportSpaPulse8')])
    ]);
    wrap.appendChild(exportPanel);

    var historyPanel = ui.el('div', { class: 'panel', id: 'ie-history' });
    wrap.appendChild(historyPanel);

    var dupCheckPanel = ui.el('div', { class: 'panel' }, [
      ui.el('h3', { text: t('ie.dupCheck.title') }),
      ui.el('p', { class: 'muted', text: t('ie.dupCheck.desc') }),
      ui.el('button', { class: 'btn', text: t('ie.dupCheck.button'), onclick: onFlagDuplicatesClick }),
      ui.el('div', { style: 'height:1px;background:var(--border);margin:14px 0' }),
      ui.el('p', { class: 'muted', text: t('ie.reclassify.desc') }),
      ui.el('button', { class: 'btn', text: t('ie.reclassify.button'), onclick: onReclassifyClick }),
      ui.el('div', { id: 'ie-dup-undo-bar' })
    ]);
    wrap.appendChild(dupCheckPanel);

    var dangerPanel = ui.el('div', { class: 'panel', style: 'border:1px solid var(--danger)' }, [
      ui.el('h3', { style: 'color:var(--danger)', text: t('ie.dangerTitle') }),
      ui.el('p', { class: 'muted', text: t('ie.dangerDesc') }),
      ui.el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        ui.el('button', { class: 'btn', style: 'border-color:var(--danger);color:var(--danger)', text: t('ie.resetGift'),
          onclick: function () { onResetByCategory(GC_CATEGORIES, t('ie.scope.gift')); } }),
        ui.el('button', { class: 'btn', style: 'border-color:var(--danger);color:var(--danger)', text: t('ie.resetService'),
          onclick: function () { onResetByCategory(SC_CATEGORIES, t('ie.scope.service')); } }),
        ui.el('button', { class: 'btn', style: 'border-color:var(--danger);color:var(--danger)', text: t('ie.resetSpaPulse8'),
          onclick: function () { onResetByCategory(SPA_PULSE8_CATEGORIES, t('ie.scope.spaPulse8')); } }),
        ui.el('button', { class: 'btn', style: 'border-color:var(--danger);color:var(--danger);font-weight:800', text: t('ie.resetAll'),
          onclick: onResetAllClick })
      ])
    ]);
    wrap.appendChild(dangerPanel);

    container.appendChild(wrap);

    document.getElementById('ie-import-btn').addEventListener('click', onImportClick);
    renderHistory();
    ui.renderUndoBar('ie-dup-undo-bar', function () { CertApp.router.refresh(); });
  }

  function onFlagDuplicatesClick() {
    CertApp.certificateWorkflow.flagDuplicateCertificateNumbers().then(function (result) {
      if (result.count === 0) { ui.toast(t('ie.dupCheck.none'), 'info'); return; }
      ui.toast(t('ie.dupCheck.done', { n: ui.formatNumber(result.count), groups: ui.formatNumber(result.groups) }), 'success');
      CertApp.router.refresh();
    }).catch(function (err) { ui.toast(err.message, 'error'); });
  }

  function onReclassifyClick() {
    CertApp.certificateWorkflow.reclassifyMisimportedExpiries().then(function (result) {
      if (result.count === 0) { ui.toast(t('ie.reclassify.none'), 'info'); return; }
      ui.toast(t('ie.reclassify.done', { n: ui.formatNumber(result.count), used: ui.formatNumber(result.used), grace: ui.formatNumber(result.grace) }), 'success');
      CertApp.router.refresh();
    }).catch(function (err) { ui.toast(err.message, 'error'); });
  }

  function onResetByCategory(categories, label) {
    var matchCount = CertApp.cache.certificates.filter(function (r) { return categories.indexOf(r.category) !== -1; }).length;
    if (matchCount === 0) { ui.toast(t('ie.resetByCat.none', { label: label }), 'info'); return; }

    ui.openModal(t('ie.resetByCat.confirmTitle', { label: label }), [
      ui.el('div', {}, [t('ie.resetByCat.confirmBody', { label: label, n: ui.formatNumber(matchCount) })]),
      ui.el('div', { class: 'warn-text', style: 'margin-top:8px' }, [t('cl.irreversible')])
    ], function () {
      var ids = CertApp.cache.certificates.filter(function (r) { return categories.indexOf(r.category) !== -1; }).map(function (r) { return r.id; });
      CertApp.certificateWorkflow.deleteRecords(ids).then(function () {
        ui.toast(t('ie.resetByCat.done', { label: label, n: ui.formatNumber(ids.length) }), 'success');
        CertApp.router.go('importexport');
      }).catch(function (err) { ui.toast(t('ie.resetByCat.fail') + err.message, 'error'); });
    }, t('ie.confirmInit'));
  }

  function onResetAllClick() {
    ui.openModal(t('ie.resetAll.confirmTitle'), [
      ui.el('div', {}, [t('ie.resetAll.confirmBody', { n: ui.formatNumber(CertApp.cache.certificates.length) })]),
      ui.el('div', { class: 'warn-text', style: 'margin-top:8px' }, [t('cl.irreversible')])
    ], function () {
      CertApp.db.clearAll().then(function () {
        CertApp.cache.certificates = [];
        CertApp.cache.miscRevenue = [];
        ui.toast(t('ie.resetAll.done'), 'success');
        CertApp.router.go('importexport');
      }).catch(function (err) {
        ui.toast(t('ie.resetByCat.fail') + err.message, 'error');
      });
    }, t('ie.confirmInit'));
  }

  function onUndoBatch(batch) {
    ui.openModal(t('ie.undoBatch.confirmTitle'), [
      ui.el('div', {}, [t('ie.undoBatch.confirmBody', {
        file: batch.fileName, at: batch.importedAt, n: ui.formatNumber((batch.recordIds || []).length)
      })]),
      ui.el('div', { class: 'warn-text', style: 'margin-top:8px' }, [t('cl.irreversible')])
    ], function () {
      CertApp.certificateWorkflow.undoImportBatch(batch.id).then(function (count) {
        ui.toast(ui.formatNumber(count) + t('ie.undoBatch.done'), 'success');
        CertApp.router.go('importexport');
      }).catch(function (err) { ui.toast(t('ie.undoBatch.fail') + err.message, 'error'); });
    }, t('ie.undo'));
  }

  function onImportClick() {
    var fileInput = document.getElementById('ie-file');
    var reportEl = document.getElementById('ie-report');
    var file = fileInput.files[0];
    if (!file) { ui.toast(t('ie.selectFile'), 'warn'); return; }
    reportEl.textContent = t('ie.importing');

    CertApp.importPipeline.importFile(file).then(function (result) {
      return CertApp.db.putMany('certificates', result.records).then(function () {
        return CertApp.db.put('importBatches', result.report);
      }).then(function () {
        return CertApp.certificateWorkflow.logBulkImport(result.records);
      }).then(function () {
        return CertApp.db.getAll('certificates');
      }).then(function (all) {
        CertApp.cache.certificates = all;
        reportEl.innerHTML = '';
        reportEl.appendChild(renderReportSummary(result.report));
        ui.toast(result.report.rowsImported + t('ie.report.done'), 'success');
        CertApp.router.refresh();
        renderHistory();
      });
    }).catch(function (err) {
      reportEl.textContent = t('ie.importFailPrefix') + err.message;
      ui.toast(t('ie.importFail'), 'error');
      console.error(err);
    });
  }

  function renderReportSummary(report) {
    return ui.el('div', {}, [
      ui.el('div', { text: t('ie.report.file') + report.fileName }),
      ui.el('div', { text: t('ie.report.rows', { read: report.rowsRead, imported: report.rowsImported }) }),
      ui.el('div', { class: report.rowsFlaggedNeedsReview > 0 ? 'warn-text' : '', text: t('ie.report.review', { n: report.rowsFlaggedNeedsReview }) }),
      ui.el('div', { class: 'muted', text: t('ie.report.warnings', { n: report.warnings.length }) })
    ]);
  }

  function renderHistory() {
    CertApp.db.getAll('importBatches').then(function (batches) {
      // Re-fetch the panel and clear it here (not before the async call) — clearing
      // up front races when two imports fire in quick succession, since each call's
      // populate step lands after the other's clear, leaving duplicate tables behind.
      var historyPanel = document.getElementById('ie-history');
      if (!historyPanel) return;
      historyPanel.innerHTML = '';
      historyPanel.appendChild(ui.el('h3', { text: t('ie.historyTitle') }));

      batches.sort(function (a, b) { return b.importedAt < a.importedAt ? -1 : 1; });
      var columns = [
        { key: 'fileName', label: t('ie.col.fileName') },
        { key: 'importedAt', label: t('ie.col.importedAt') },
        { key: 'rowsImported', label: t('ie.col.rowsImported') },
        { key: 'rowsFlaggedNeedsReview', label: t('ie.col.needsReview') },
        { key: 'undo', label: '', format: function (v, batch) {
          return ui.el('button', { class: 'btn', text: t('ie.undo'), onclick: function () { onUndoBatch(batch); } });
        } }
      ];
      var tableWrap = ui.el('div');
      historyPanel.appendChild(tableWrap);
      ui.renderTable(tableWrap, columns, batches);
    });
  }

  return { render: render };
})();
