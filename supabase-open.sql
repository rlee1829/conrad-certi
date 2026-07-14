-- ============================================================================
-- Certificate Ledger — reopen the database to the anon key (NO login required)
-- Run this in Supabase → SQL Editor when you turn the shared-password login OFF
-- (config.js: sharedLogin.enabled = false).
-- ============================================================================
-- This is the inverse of supabase-auth.sql: it removes the "authenticated-only"
-- policies and restores open "anon" access, so the app works with just the anon
-- key embedded in the client (no sign-in). Safe to run regardless of the current
-- state — it drops either policy set if present, then recreates the anon set.
--
-- NOTE: with these policies, anyone who has the site URL can read/write the data
-- (there is no password). Use only because this data is not sensitive.

drop policy if exists auth_all_certificates on certificates;
drop policy if exists auth_all_misc         on misc_revenue_entries;
drop policy if exists auth_all_audit         on audit_log;
drop policy if exists auth_all_batches       on import_batches;
drop policy if exists auth_all_meta          on meta;

drop policy if exists anon_all_certificates on certificates;
drop policy if exists anon_all_misc         on misc_revenue_entries;
drop policy if exists anon_all_audit         on audit_log;
drop policy if exists anon_all_batches       on import_batches;
drop policy if exists anon_all_meta          on meta;

create policy anon_all_certificates on certificates         for all to anon using (true) with check (true);
create policy anon_all_misc         on misc_revenue_entries for all to anon using (true) with check (true);
create policy anon_all_audit        on audit_log            for all to anon using (true) with check (true);
create policy anon_all_batches      on import_batches       for all to anon using (true) with check (true);
create policy anon_all_meta         on meta                 for all to anon using (true) with check (true);
