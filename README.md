# Tally

A habit, time, and task tracker that lets the measurement match the behaviour.
Most trackers force everything into a checkbox. Here a task is a **timer** you
accumulate, a **quantity** you count toward, or a **checkbox** — and all three feed the
same streak.

React + TypeScript PWA. Local-first IndexedDB, optional Supabase sync, no server of
your own. Install it to your home screen and it behaves like an app.

- `tally-spec.md` — the tracker
- `tally-planning-spec.md` — day plans and phased projects

## Running it

```sh
npm install
npm run dev        # http://localhost:5173
npm run test       # 81 tests
npm run build
```

Works fully with no Supabase project configured — it is simply local-only until you
add one.

## The parts worth knowing about

**The day starts at 04:00, not midnight.** TV watched at 12:30am belongs to the day
before, and a tracker that disagrees silently breaks streaks. Every timestamp is stored
as UTC and stamped with a `dayKey` derived through a **pinned IANA timezone** —
`America/New_York` by default, changeable in Settings — so neither DST nor travelling
with the laptop shifts your history. `src/core/dayKey.ts`.

**A running timer stores its start, never a counter.** Elapsed time is `now - startedAt`
computed at render, so a timer survives closing the tab, restarting the browser, and
rebooting the phone — no background execution needed, which is fortunate, because the
web has none. `src/core/sessionSplit.ts`.

**A limit is not a target.** `at most 2h of TV` cannot be called complete at 9am, so
today reads *on track* or *exceeded*, never *complete*, and the streak excludes today
until the day ends. Going over fails the day immediately. One consequence is easy to
miss: a day with no data is a *success* for a limit task, so limit streaks accrue
passively — floored at the task's creation date, never earlier.

**Streaks are recomputed, never incremented.** Counters drift and you do not notice for
months. `src/core/streak.ts`.

**Project progress is weighted by estimate.** A 20h phase beside a 2h one is 91% done
when the first finishes, not 50%. `src/core/progress.ts`.

Everything above is a pure function over plain objects with no React and no database
imports, which is what `tests/core/` covers — including the session that starts at 03:45
and ends at 05:15 across a DST boundary. `tests/ui/` drives the real app.

## Sync (optional)

1. Create a free Supabase project.
2. Run `supabase/schema.sql` in its SQL editor. It creates one table per collection with
   row-level security scoped to `auth.uid()`.
3. Copy `.env.example` to `.env.local` and fill in the URL and anon key.
4. Sign in from Settings with a magic link.

The anon key is public by design and ships inside the bundle — **the RLS policies are
the entire security model.** Verify them before trusting them: signed out, a
`select * from public.tasks` must return zero rows.

Sync is last-write-wins per row on `updatedAt`. One user with two devices rarely edits
the same row at the same moment, so a CRDT would be engineering for a problem that does
not exist. Deletes are tombstones, so a deletion reaches the other device.

## Deploying

Push to `main`. `.github/workflows/deploy.yml` tests, builds with `base: '/Tally/'`, and
publishes to GitHub Pages. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
repository *variables* if you want sync in the deployed build.

GitHub Pages on a free account requires a public repo.

## Install it to your home screen — this is not optional

Safari clears browser storage for sites unused for a week. **A PWA installed to the home
screen is exempt**; a bookmark is not. Open the deployed URL in Safari, Share → Add to
Home Screen. Settings also has a *Request persistent storage* button and a JSON export.

## Known gaps

- **The day plan has no timer.** It is a 15-minute grid you fill in — intention, not
  measurement. `repack`, gap and overlap detection are still tested but no longer
  reachable from the UI, because a grid makes them structural.
- **Phase reordering is via arrows, not drag.**
- **`timesPerWeek` scheduling** reports every day as an opportunity. Its week-level rule
  is v1.1, as specced.
- **No stats screen, no reminders.** Both are v1.1.
- Supabase free projects pause after a week of inactivity. Daily use keeps it warm.
