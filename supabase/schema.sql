-- Tally — Supabase schema.
--
-- One table per collection, each row a jsonb document keyed by the client-generated
-- uuid. Deliberately not a column-per-field mapping: the client holds the whole
-- dataset in memory and never queries by field, so columns would buy nothing and cost
-- a migration every time the app's shape changes. What the server does need to know
-- is exactly three things — who owns the row, when it changed, and whether it is
-- deleted — and those are real columns.
--
-- Run this in the Supabase SQL editor. Not once: re-run it whenever the table list
-- below changes, or sync will fail on the new collection with "could not find the
-- table". It is idempotent. See README.md in this folder.

create extension if not exists "pgcrypto";

do $$
declare t text;
begin
  -- Keep this in step with TABLES in src/db/sync.ts, plus 'settings'. That one is
  -- reserved and deliberately not synced yet: settings live in the local meta store as
  -- a single key, not as rows, and stay per-device until they are given a row shape.
  foreach t in array array['tasks', 'entries', 'todos', 'day_plans', 'blocks', 'projects', 'phases', 'daily_reads', 'settings']
  loop
    execute format($f$
      create table if not exists public.%I (
        id          uuid primary key,
        user_id     uuid not null references auth.users(id) on delete cascade,
        updated_at  timestamptz not null default now(),
        deleted_at  timestamptz,
        data        jsonb not null
      );

      -- the pull query: "everything of mine that changed since my watermark"
      create index if not exists %I on public.%I (user_id, updated_at);

      alter table public.%I enable row level security;
    $f$, t, t || '_user_updated_idx', t, t);

    -- The anon key ships inside a public GitHub Pages bundle. These policies are the
    -- entire security model, so they are written per-command rather than as one
    -- permissive "for all" rule.
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);

    execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', t || '_insert', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t || '_update', t
    );
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', t || '_delete', t);
  end loop;
end $$;

-- Verify before trusting it: signed out, this must return zero rows, not an error and
-- not data.
--   select * from public.tasks;
