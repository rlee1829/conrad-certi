/* Local "who is using this" identity for the audit log. There is no server/auth in this app
   (opened via file://, no network requests) so a browser cannot see a real client IP, and even
   if it could, an IP doesn't distinguish two people on the same office network. This is a
   self-reported name instead — not cryptographically verified, but it's the honest, practical
   equivalent for a shared local tool, and it's what actually shows up in the audit trail. */
window.CertApp = window.CertApp || {};
CertApp.operator = (function () {
  var KEY = 'certapp_operator';

  function get() {
    try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; }
  }

  function set(name) {
    try { localStorage.setItem(KEY, (name || '').trim()); } catch (e) {}
  }

  return { get: get, set: set };
})();
