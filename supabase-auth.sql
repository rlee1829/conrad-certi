-- ============================================================================
-- Certificate Ledger — lock the database to logged-in users only
-- Run this in Supabase → SQL Editor AFTER you have created the shared login user
-- (Authentication → Users → Add user, with "Auto Confirm User" ON).
-- ============================================================================
-- Replaces the open "anon" policies with "authenticated"-only policies, so the
-- anon key alone can no longer read/write — a valid login session is required.

drop policy if exists anon_all_certificates on certificates;
drop policy if exists anon_all_misc         on misc_revenue_entries;
drop policy if exists anon_all_audit         on audit_log;
drop policy if exists anon_all_batches       on import_batches;
drop policy if exists anon_all_meta          on meta;

create policy auth_all_certificates on certificates         for all to authenticated using (true) with check (true);
create policy auth_all_misc         on misc_revenue_entries for all to authenticated using (true) with check (true);
create policy auth_all_audit        on audit_log            for all to authenticated using (true) with check (true);
create policy auth_all_batches      on import_batches       for all to authenticated using (true) with check (true);
create policy auth_all_meta         on meta                 for all to authenticated using (true) with check (true);
