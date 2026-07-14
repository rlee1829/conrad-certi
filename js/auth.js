/* Shared-password login (Supabase Auth). Everyone signs in with one shared password against a
   single Supabase account (config.sharedLogin.email); the database RLS (supabase-auth.sql) only
   allows logged-in users, so the anon key alone can't read/write. The session persists across
   reloads and auto-refreshes, so users only log in occasionally. */
window.CertApp = window.CertApp || {};
CertApp.auth = (function () {
  function sb() { return CertApp.supabaseClient(); }

  function currentSession() {
    return sb().auth.getSession().then(function (r) { return (r && r.data) ? r.data.session : null; });
  }
  function signIn(password) {
    return sb().auth.signInWithPassword({ email: CertApp.config.sharedLogin.email, password: password })
      .then(function (r) { if (r.error) throw new Error(r.error.message || 'login failed'); return r.data.session; });
  }
  function signOut() { return sb().auth.signOut(); }

  // Full-screen login gate shown before the app boots when there's no valid session.
  function showLoginScreen(onSuccess) {
    var el = CertApp.ui.el, t = CertApp.i18n.t;
    var pw = el('input', { type: 'password', class: 'login-input', placeholder: t('login.placeholder') });
    var err = el('div', { class: 'login-error' });
    var btn = el('button', { class: 'btn btn-primary login-btn', text: t('login.button') });
    function attempt() {
      var v = pw.value;
      if (!v) { pw.focus(); return; }
      err.textContent = ''; btn.disabled = true; btn.textContent = t('login.checking');
      signIn(v).then(function () {
        overlay.parentNode && overlay.parentNode.removeChild(overlay);
        onSuccess();
      }).catch(function () {
        err.textContent = t('login.wrong'); btn.disabled = false; btn.textContent = t('login.button');
        pw.value = ''; pw.focus();
      });
    }
    btn.addEventListener('click', attempt);
    pw.addEventListener('keydown', function (e) { if (e.key === 'Enter') attempt(); });

    var card = el('div', { class: 'login-card' }, [
      el('div', { class: 'login-brand', text: 'Certificate Ledger' }),
      el('div', { class: 'login-sub', text: t('login.title') }),
      pw, err, btn
    ]);
    var overlay = el('div', { class: 'login-overlay' }, [card]);
    document.body.appendChild(overlay);
    setTimeout(function () { pw.focus(); }, 50);
  }

  return { currentSession: currentSession, signIn: signIn, signOut: signOut, showLoginScreen: showLoginScreen };
})();
