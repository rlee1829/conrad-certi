/* Local "who is using this" identity for the audit log. There is no server/auth in this app
   (opened via file://, no network requests) so a browser cannot see a real client IP, and even
   if it could, an IP doesn't distinguish two people on the same office network. This is a
   self-reported name + department instead — not cryptographically verified, but it's the honest,
   practical equivalent for a shared local tool, and it's what actually shows up in the audit
   trail (e.g. "이지은 (Finance)"). */
window.CertApp = window.CertApp || {};
CertApp.operator = (function () {
  var NAME_KEY = 'certapp_operator';
  var DEPT_KEY = 'certapp_operator_dept';
  var DEPTS_KEY = 'certapp_departments';
  // Built-in departments; more can be added at the name prompt and are remembered per browser.
  var DEFAULT_DEPTS = ['FO', 'FB', 'Finance', 'RSVN'];

  function ls(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function save(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function getName() { return (ls(NAME_KEY) || '').trim(); }
  function getDept() { return (ls(DEPT_KEY) || '').trim(); }

  // Combined display used as the audit-log actor AND the boot "is anyone set?" check —
  // "이지은 (Finance)", or just the name when no department, or '' when no name at all.
  function get() {
    var n = getName(), d = getDept();
    if (!n) return '';
    return d ? (n + ' (' + d + ')') : n;
  }

  // dept omitted (undefined) leaves the stored department untouched; pass '' to clear it.
  function set(name, dept) {
    save(NAME_KEY, (name || '').trim());
    if (dept !== undefined) save(DEPT_KEY, (dept || '').trim());
  }

  // The four built-ins plus any custom departments added via the prompt, deduped and
  // order-preserving (defaults first, then customs in the order they were added).
  function departments() {
    var custom = [];
    try { custom = JSON.parse(ls(DEPTS_KEY)) || []; } catch (e) {}
    var out = DEFAULT_DEPTS.slice();
    custom.forEach(function (d) { if (out.indexOf(d) === -1) out.push(d); });
    return out;
  }

  function addDepartment(dept) {
    dept = (dept || '').trim();
    if (!dept || DEFAULT_DEPTS.indexOf(dept) !== -1) return;
    var custom = [];
    try { custom = JSON.parse(ls(DEPTS_KEY)) || []; } catch (e) {}
    if (custom.indexOf(dept) === -1) { custom.push(dept); save(DEPTS_KEY, JSON.stringify(custom)); }
  }

  return {
    get: get, set: set, getName: getName, getDept: getDept,
    departments: departments, addDepartment: addDepartment
  };
})();
