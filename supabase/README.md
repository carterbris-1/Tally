# Supabase schema

`schema.sql` creates one table per synced collection, each with row-level security scoped
to `auth.uid()`.

## Running it

Paste the whole of `schema.sql` into the Supabase SQL editor and run it:

- once when you first turn on sync, and
- **again whenever its table list changes**, such as when a new collection is added.

It is idempotent: `create table if not exists`, `create index if not exists`, and every
policy is dropped before it is recreated. Re-running it touches nothing that already exists
and adds only what is missing. No data is at risk either way, because the client holds the
full dataset in IndexedDB and pushes it up once the table exists.

The table list in `schema.sql` must match `TABLES` in `src/db/sync.ts`, plus the reserved
`settings` table, which is not synced yet.

## Why re-running matters: the `daily_reads` incident

Sync once failed with `could not find the table (public.daily_reads)`. Short version:
the daily-read feature added a new collection, `schema.sql` was updated to match, and the
file was never re-run against the live database. The client asked Supabase
for a table that only existed in the repo.

### The asymmetry that makes this easy to miss

Tally stores everything twice — IndexedDB locally, Supabase remotely — and only one of
those migrates itself.

| | How a new collection arrives | When |
|---|---|---|
| IndexedDB | `DB_VERSION` bump, `onupgradeneeded` creates missing stores | automatic, on next load |
| Supabase | somebody pastes `schema.sql` into the SQL editor | never, until a human does it |

So a new collection works perfectly the moment you reload the app. Nothing is wrong, and
nothing warns you. The gap only surfaces the next time sync runs and Postgres is asked for
a table that was added to the file but not to the database — which can be days later, with
no obvious connection to the change that caused it.

That is exactly what happened here. `daily_reads` was added to `src/core/types.ts`,
`src/db/idb.ts`, `src/db/sync.ts` and `supabase/schema.sql` together, in one commit, with
the client half taking effect on its own. The remote half sat in a file.

The fix was to run the whole of `schema.sql` again, as described above.

### Avoiding it next time

`PLAYBOOK.md` already carries the right instruction under "adding a collection":

> `supabase/schema.sql` — add the table name to the `array[...]` in the loop, and re-run
> the whole file. It is idempotent.

The trap is that the header of `schema.sql` used to read *"Run this once in the Supabase
SQL editor"*, which reads as a one-time setup step rather than something to repeat. It now
says to re-run it whenever the table list changes.

Treat "the table list in `schema.sql` changed" as meaning "the database is out of date
until I run it", in the same way a `DB_VERSION` bump means the local store is.
