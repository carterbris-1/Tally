# Tally — Playbook

Procedures, not concepts. `README.md` explains what the app is and why the hard parts
work the way they do; this is what you actually run when you need to change something.

---

## 1. Orientation

```
src/core/     pure functions — no React, no IndexedDB, no Supabase, ever
src/db/       idb.ts (storage) · store.ts (the only mutations) · selectors.ts · sync.ts
src/ui/       screens and components
tests/core/   the pure functions, including every DST case
tests/ui/     drives the real app in jsdom
supabase/     schema.sql — run once in the SQL editor
```

**The one rule.** `src/core/` imports nothing from `src/db/` or `src/ui/`. If a piece of
logic is hard to test, it is in the wrong directory — move it into `core/` as a function
over plain objects and the test writes itself. Everything else is glue.

**The only place data changes** is `src/db/store.ts`. Nothing else constructs an `Entry`,
stamps an `updatedAt`, or writes to IndexedDB. Keep it that way; the owner invariant and
the sync watermarks both depend on it.

---

## 2. Everyday commands

```sh
npm run dev          # http://localhost:5173
npm run test         # 98 tests, ~2s
npm run test:watch   # while working in core/
npm run typecheck    # strict, noUncheckedIndexedAccess
npm run build        # tsc -b && vite build
```

Before any commit: `npm run typecheck && npm run test`. The deploy workflow runs both
and will not publish a red build.

---

## 3. Runbooks

### Turn on sync from scratch

1. Create a free Supabase project. Copy the URL and anon key from **Settings → API**.
2. Paste `supabase/schema.sql` into the SQL editor and run it. It creates one table per
   collection with RLS scoped to `auth.uid()`.
3. **Verify RLS before trusting it.** In the SQL editor, open a new query as the `anon`
   role (or just query from a signed-out browser console) and run
   `select * from public.tasks;`. It must return **zero rows** — not an error, not data.
   If it returns rows, stop and fix the policies. The anon key is public and shipped in
   the bundle; these policies are the whole security model.
4. `cp .env.example .env.local` and fill both values. Restart `npm run dev`.
5. Settings → Sync → enter your email → click the magic link.
6. For the deployed build, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as
   repository **Variables** (not Secrets — they are public and Secrets are masked in a
   way that makes debugging worse).

### Deploy

Push to `main`. That is the whole procedure. `.github/workflows/deploy.yml` runs the
tests, builds with `GITHUB_PAGES=true` so `base` becomes `/Tally/`, and publishes.

If the deployed page loads blank with 404s on the assets, `base` and the repo name have
diverged — they must match exactly, including case. See `vite.config.ts`.

### Install on the iPhone

Open the deployed HTTPS URL in **Safari** (not Chrome), Share → Add to Home Screen.

This is not cosmetic. Safari clears script-writable storage for sites unused for seven
days; a home-screen PWA is exempt from that sweep and a bookmark is not. Also tap
**Request persistent storage** in Settings, and take a JSON export before any trip long
enough to leave the app unopened for a week.

### Change the schema

Adding a field to an existing type needs no migration — rows are stored whole and a
missing field reads as `undefined`. Give it a default where you read it.

Adding a **new collection** needs four edits, in this order:

1. `src/core/types.ts` — the interface, extending `Syncable`.
2. `src/db/idb.ts` — add the name to `STORES`, bump `DB_VERSION`, add any `INDEXES`.
   The `onupgradeneeded` handler creates missing stores and indexes and leaves existing
   ones alone, so a bump is safe on a store with real data in it.
3. `src/db/sync.ts` — add the `[collection, table]` pair to `TABLES`.
4. `supabase/schema.sql` — add the table name to the `array[...]` in the loop, and
   re-run the whole file. It is idempotent.

Then test the upgrade against real data, not an empty store: export JSON from the live
app, load it into a fresh profile, apply the new build, confirm nothing was lost.

### Add a new task kind

1. Widen `TaskKind` in `src/core/types.ts`.
2. `src/core/aggregate.ts` — teach `dailyTotals` how a day's total is computed for it.
   This is the only place that decides whether entries are split across the boundary or
   summed by stamped `dayKey`.
3. `src/core/streak.ts` — `effectiveGoal` if the kind implies a goal, the way `checkbox`
   implies `atLeast 1`.
4. `src/ui/Today.tsx` — the `action()` branch and the `meta()` branch in `TaskRow`.
5. `src/ui/TaskEditor.tsx` — the kind segmented control and any fields it needs.
6. `src/ui/format.ts` — `formatAmount`, if it is not seconds and not a plain number.

Tests first in steps 2–3; those are pure and cheap to cover.

### Debug a streak that looks wrong

Streaks are recomputed from entries every render, so the entries are always the truth.

1. Open the task detail. The heatmap tooltip shows `dayKey · status · total` per cell.
2. Reproduce it as a unit test in `tests/core/streak.test.ts` using the `day()` helper —
   a manual entry with an explicit `dayKey` and amount, which keeps the test about
   streak logic rather than timers.
3. Check the four statuses against `evaluateDay`. Most surprises are one of:
   - **`unresolved` on today** — correct. Today is excluded until the day ends.
   - **a limit task with a long streak out of nowhere** — correct. A day with no data
     cannot exceed a limit, so it counts as success back to `createdAt`.
   - **a gap that did not break the streak** — the day was unscheduled or skipped, and
     both are neutral by design.
   - **the wrong day entirely** — that is a `dayKey` bug, not a streak bug. Go to the
     next runbook.

### Debug a day-boundary or DST bug

Everything lives in `src/core/dayKey.ts` and every test builds instants through
`wallClock()` in `tests/helpers.ts`.

**Never construct a test instant by adding hours to midnight.** That is the exact bug the
module exists to prevent, and the first draft of that helper had it — adding 3.75 real
hours to midnight on a spring-forward day lands at 04:45, not 03:45. Always go through
`civilToInstant`.

The app is pinned to `America/New_York` regardless of the machine it runs on, so tests
and production agree. Useful fixtures, all in that zone:

| Date | Property |
|---|---|
| `2026-03-07` | tally day is **23 hours** (clocks jump forward inside it) |
| `2026-10-31` | tally day is **25 hours** |
| `2026-09-01` | ordinary 24-hour day |
| `2026-09-06` | a Sunday, for weekday-schedule tests |
| `2026-07-15` | EDT (UTC-4) — a fixed "EST" offset is wrong here |
| `2026-01-15` | EST (UTC-5) |

**Never hardcode a fixed offset.** `Etc/GMT+5` is `EST` all year and puts the day
boundary an hour off for eight months of it. Always an IANA zone name.

### Recover data

- **Export**: Settings → Export JSON. Do this before schema work.
- **Import**: Settings → Import JSON. Rows with the same id are replaced; it is an
  upsert, not a wipe-and-load, so importing an old export will not delete newer rows.
- **Wipe local state**: `clearAll()` in `src/db/idb.ts`, or delete the `tally` database
  in DevTools → Application → IndexedDB. If sync is signed in, the next pass pulls
  everything back — that is the intended recovery path after an eviction.

### Debug sync not converging

1. Settings → Sync shows the last result: `n sent, n received`, or the error.
2. Watermarks live in the `meta` store under `sync:lastPushedAt` / `sync:lastPulledAt`.
   To force a full re-pull, set `sync:lastPulledAt` to `1970-01-01T00:00:00.000Z` in
   DevTools and hit **Sync now**. Merges are last-write-wins, so a full re-pull is safe
   — it cannot clobber a newer local edit.
3. A row that will not come down is almost always RLS. Check `user_id` on the row
   matches the signed-in user.
4. Signing out resets both watermarks on purpose, so a second account never inherits the
   first one's position.

### Add a screen

1. Component in `src/ui/`.
2. Derived reads go in `src/db/selectors.ts`, never inline in the component.
3. Register it in `TABS` in `src/App.tsx` — the tab bar becomes a sidebar above 900px
   with no extra work.
4. Add a path through it to `tests/ui/smoke.test.tsx`. A green typecheck and a
   successful build both pass on a screen that throws on mount.

---

## 4. Test discipline

- **Anything in `src/core/` gets a unit test.** That is the whole point of the directory.
- **Anything a person clicks in the first minute gets a line in the smoke test.**
- Use `getByRole('heading', ...)` over `getByText` for titles — screen headings and tab
  labels collide otherwise.
- `aria-label` names the thing it acts on: `Start Read`, `Mark Draft done`. This is both
  the accessible label and what makes the tests unambiguous. Two buttons labelled
  `Start block` is a bug in the app, not in the test.
- Each smoke test starts from `clearAll()`, so titles stay unique within a test.

---

## 5. Release checklist

```sh
npm run typecheck && npm run test && npm run build
```

Then:

- [ ] Export JSON from the live app if the schema changed.
- [ ] Open the built app on the phone and confirm a running timer survives a force-quit.
- [ ] If sync changed: edit the same row on two devices offline, reconnect, confirm the
      later edit wins and no duplicate entries appear.
- [ ] Push to `main`, wait for the Pages deploy, hard-reload the installed PWA.

The service worker is network-first for navigations, so a deploy is picked up on the
next open. Hashed assets are cache-first and never change under the same name.

---

## 6. What is deliberately not built

Do not "fix" these by accident — each is a decision, recorded in the specs.

| Not built | Where it is decided |
|---|---|
| Drag-to-reorder | Superseded: the 15-minute grid places blocks by time |
| Repack / gap / overlap detection | `core/repack.ts` is still tested but **no longer reachable from the UI** — the grid makes gaps and overlaps structural. Delete or re-expose deliberately, not by accident |
| Planned vs. actual on blocks | Removed with the play button. `blockView` and `blockEntries` in `selectors.ts` are now unused |
| `timesPerWeek` week-level rule | `src/core/schedule.ts`, spec §4.2 |
| Stats screen, reminders, limit alerts | spec §9, v1.1 |
| Per-phase time logging UI | planning spec §2.2 — the schema already supports it |
| Phase gating | planning spec §9, decision 6 — order is intent, not a state machine |
| To-dos or plans affecting streaks | spec §11, decisions 4 and 8 |
| Widgets, Live Activities, Siri | impossible on the web; the price of no dev account |

---

## 7. Traps

1. **Never accumulate elapsed time.** A running session is `startedAt` set and `endedAt`
   null; elapsed is a subtraction at render. A counter that ticks is a counter that
   drifts, stops when the tab sleeps, and lies after a reboot.
2. **Never increment a streak.** Recompute. Same reason.
3. **Never store a planned block time as a timestamp.** `plannedStartMinute` is minutes
   since day start. A timestamp breaks the moment the day start changes or the clocks do.
4. **Never do date math on instants.** `dayKey` arithmetic is civil-date arithmetic on
   fields already localised by `Intl`. Adding 86,400,000 ms to a Date is wrong twice a
   year.
5. **Soft delete, always.** A hard delete is invisible to the other device. The only
   legitimate hard delete is purging tombstones.
6. **Do not let a second thing construct an `Entry`.** One factory in `store.ts` keeps
   `{ownerType, ownerId}` coherent; a second one is how double-counted hours start.
