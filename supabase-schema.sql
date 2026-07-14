-- ============================================================================
-- Certificate Ledger — Supabase schema
-- Run this once in your Supabase project:  SQL Editor → New query → paste → Run
-- ============================================================================
-- Each app "store" is one table: a primary key + a JSONB column holding the
-- record exactly as the app uses it (the app filters/aggregates client-side, so
-- no per-field columns are needed).

create table if not exists certificates (
  id uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists misc_revenue_entries (
  id uuid primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists import_batches (
  id uuid primary key,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists meta (
  key  text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---- Real-time: broadcast row changes to every connected PC --------------------
alter publication supabase_realtime add table certificates;
alter publication supabase_realtime add table misc_revenue_entries;
alter publication supabase_realtime add table audit_log;
alter publication supabase_realtime add table import_batches;

-- ---- Access ------------------------------------------------------------------
-- This internal tool currently uses the public "anon" key with NO login, so the
-- anon role is granted full access below.
--   ⚠ BEFORE going live with real financial data, add authentication (a shared
--     login or Supabase Auth) and replace these permissive policies. Ask and I
--     will wire that up.
alter table certificates          enable row level security;
alter table misc_revenue_entries  enable row level security;
alter table audit_log             enable row level security;
alter table import_batches        enable row level security;
alter table meta                  enable row level security;

create policy anon_all_certificates on certificates         for all to anon using (true) with check (true);
create policy anon_all_misc         on misc_revenue_entries for all to anon using (true) with check (true);
create policy anon_all_audit        on audit_log            for all to anon using (true) with check (true);
create policy anon_all_batches      on import_batches       for all to anon using (true) with check (true);
create policy anon_all_meta         on meta                 for all to anon using (true) with check (true);
