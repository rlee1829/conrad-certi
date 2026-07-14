/* CertApp bootstrap */
window.CertApp = window.CertApp || {};
CertApp.cache = { certificates: [], miscRevenue: [] };

CertApp.boot = function () {
  return CertApp.db.open().then(function () {
    return CertApp.db.getAll('certificates');
  }).then(function (rows) {
    CertApp.cache.certificates = rows;
    return CertApp.db.getAll('miscRevenueEntries');
  }).then(function (rows) {
    CertApp.cache.miscRevenue = rows;
  });
};

CertApp.wireNav = function () {
  document.querySelectorAll('.nav-item').forEach(function (item) {
    item.addEventListener('click', function () {
      CertApp.router.go(item.dataset.view);
    });
  });
};

var REGISTERED_VIEW_NAMES = ['overview', 'certlist', 'expiry', 'miscrevenue', 'auditlog', 'importexport'];

CertApp.registerViews = function () {
  CertApp.router.register('overview', CertApp.viewOverview);
  CertApp.router.register('certlist', CertApp.viewCertificateList);
  CertApp.router.register('expiry', CertApp.viewExpiryQueue);
  CertApp.router.register('miscrevenue', CertApp.viewMiscRevenue);
  CertApp.router.register('auditlog', CertApp.viewAuditLog);
  CertApp.router.register('importexport', CertApp.viewImportExport);
};

function startApp() {
  CertApp.ui.renderOperatorChip();
  if (!CertApp.operator.get()) CertApp.ui.promptOperator();
  // A "사용자 전환" button in the sidebar footer lets anyone re-enter their name (no password).
  CertApp.ui.renderSwitchUserLink();
  // Shared-password mode (disabled): a "로그아웃" link that clears the login session.
  if (CertApp.loginEnabled && CertApp.loginEnabled()) CertApp.ui.renderLogoutLink();
  CertApp.registerViews();
  CertApp.wireNav();
  CertApp.boot().then(function () {
    // Return to whichever tab the user was last on (a real browser reload otherwise always
    // dropped back to Overview/Import), falling back to the original data-driven default
    // only on a genuinely fresh session with no recorded tab yet.
    var lastView = CertApp.router.getLastView();
    var startView = (lastView && REGISTERED_VIEW_NAMES.indexOf(lastView) !== -1)
      ? lastView
      : (CertApp.cache.certificates.length > 0 ? 'overview' : 'importexport');
    CertApp.router.go(startView);

    // Cloud (Supabase) mode: mirror other PCs' changes into this session in real time. Changes
    // arrive already merged into CertApp.cache (see db-cloud.subscribe); a short debounce
    // coalesces bursts into a single re-render of the current view.
    if (CertApp.cloudEnabled && CertApp.cloudEnabled() && CertApp.dbCloud && CertApp.dbCloud.subscribe) {
      var refreshTimer = null;
      CertApp.dbCloud.subscribe(function () {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(function () { CertApp.router.refresh(); }, 300);
      });
    }
  }).catch(function (err) {
    console.error('[CertApp] boot failed', err);
    CertApp.ui.toast(CertApp.i18n.t('boot.fail') + err.message, 'error');
  });
}

document.addEventListener('DOMContentLoaded', function () {
  CertApp.i18n.applyStatic();
  // Gate the app behind the shared-password login when enabled; otherwise start immediately.
  if (CertApp.loginEnabled && CertApp.loginEnabled()) {
    CertApp.auth.currentSession().then(function (session) {
      if (session) startApp(); else CertApp.auth.showLoginScreen(startApp);
    }).catch(function () { CertApp.auth.showLoginScreen(startApp); });
  } else {
    startApp();
  }
});
