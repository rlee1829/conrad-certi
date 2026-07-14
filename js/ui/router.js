/* Minimal sidebar/tab router: show/hide view panels, no history/URL routing needed */
window.CertApp = window.CertApp || {};
CertApp.router = (function () {
  var views = {}; // name -> { render: fn }
  var current = null;
  var LAST_VIEW_KEY = 'certapp_last_view';

  function register(name, view) {
    views[name] = view;
  }

  function go(name) {
    if (!views[name]) return;
    current = name;
    try { localStorage.setItem(LAST_VIEW_KEY, name); } catch (e) {}
    document.querySelectorAll('.nav-item').forEach(function (n) {
      n.classList.toggle('active', n.dataset.view === name);
    });
    var container = document.getElementById('view-container');
    container.innerHTML = '';
    views[name].render(container);
  }

  // refresh() re-renders the CURRENT view in place (same tab, filters reset to that view's
  // defaults) — used both internally after mutations and by each view's own "새로고침" button.
  function refresh() {
    if (current) go(current);
  }

  function getCurrent() { return current; }

  // Last tab the user was on, persisted across a real browser reload (not just router.refresh()
  // — see app.js boot, which restores this instead of always landing on Overview).
  function getLastView() {
    try { return localStorage.getItem(LAST_VIEW_KEY); } catch (e) { return null; }
  }

  return { register: register, go: go, refresh: refresh, getCurrent: getCurrent, getLastView: getLastView };
})();
