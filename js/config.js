/* ============================================================================
   Cloud sharing config
   ----------------------------------------------------------------------------
   To share data across PCs in real time, paste your Supabase project's URL and
   "anon public" key below (Supabase → Project Settings → API).

   Leave `url` blank to keep using local per-browser storage (IndexedDB) — the
   app works exactly as before, just not shared.

   NOTE: The anon key is designed to be public (safe to ship in the client); row
   access is controlled by the database policies in supabase-schema.sql.
   ============================================================================ */
window.CertApp = window.CertApp || {};
CertApp.config = {
  supabase: {
    url: 'https://egkinhaewrxbizvheymb.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVna2luaGFld3J4Yml6dmhleW1iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjQ0NzksImV4cCI6MjA5OTUwMDQ3OX0.NvMf_N8Ls9sCBACRLENUsbiYp2veuDCyEriRjQ8JGK4'
  }
};

CertApp.cloudEnabled = function () {
  var s = CertApp.config && CertApp.config.supabase;
  return !!(s && s.url && s.anonKey);
};

/* Shared-password login. When enabled, everyone signs in with ONE shared password — a single
   Supabase Auth account (email below) — and the database is locked to logged-in users via the
   RLS policies in supabase-auth.sql. Create that user in Supabase with your chosen password. */
CertApp.config.sharedLogin = {
  enabled: true,
  email: 'certledger@conradseoul.com'
};
CertApp.loginEnabled = function () {
  return CertApp.cloudEnabled() && CertApp.config.sharedLogin && CertApp.config.sharedLogin.enabled;
};

/* One shared Supabase client used by BOTH the auth flow and the data layer, so a login session
   applies to every database call. */
CertApp.supabaseClient = function () {
  if (CertApp._sb) return CertApp._sb;
  if (!window.supabase || !window.supabase.createClient) throw new Error('Supabase client not loaded.');
  var s = CertApp.config.supabase;
  CertApp._sb = window.supabase.createClient(s.url, s.anonKey);
  return CertApp._sb;
};
