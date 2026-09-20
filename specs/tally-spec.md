# Tally — Product & Technical Spec

> Working name. Personal-use habit, time, and task tracker, installable on iPhone and Mac.
> React + TypeScript PWA, local-first IndexedDB, Supabase free tier for cross-device sync.
> Planning modules (day plans, phased projects) are specced in `tally-planning-spec.md`.

## 1. What it is

A Streaks-style daily tracker where a "task" can be measured three different ways,
plus a plain to-do list for one-off things that don't repeat.

The core idea: **most trackers force everything into a checkbox.** This one lets the
measurement match the behavior. "Watch TV" is a duration you want to cap. "Eat 1500
calories" is a number you accumulate toward. "Take vitamins" is a checkbox. All three
should live on the same screen and feed the same streak.

## 2. Task kinds

### 2.1 Timer task
Start/stop button. Accumulates elapsed time toward a daily total.

- Examples: watch TV, read, deep work, guitar practice.
- Multiple sessions per day, summed.
- Sessions are stored individually so you can see *when* you did it, edit a session,
  or delete a mis-started one.
- Manual entry allowed ("add 45 min") for when you forgot to hit start.

### 2.2 Quantity task
Log a number toward a daily total. Each log is a separate entry with a timestamp.

- Examples: 1500 calories, 3L water, 10,000 steps, 20 pages.
- Configurable unit label (free text: "cal", "L", "pages", "reps").
- Quick-add buttons for common increments, configured per task (e.g. +250, +500).

### 2.3 Checkbox task
Done / not done. No number.

- Examples: made the bed, took meds, no phone in bed.

### 2.4 To-dos (separate section)
One-off items that are **not** habits and do **not** affect streaks.

- Title, optional notes, optional due date, optional priority flag.
- Can be checked off and archived.
- **Optional link to a task:** a to-do can be attached to a timer task, so checking it
  off starts the timer. Useful for "write the quarterly review" → starts *Deep Work*.
- Completed to-dos are kept for 30 days then purged (configurable).

## 3. Goals

Every recurring task has an optional goal with a **direction**:

| Direction | Meaning | Complete when | Example |
|---|---|---|---|
| `atLeast` | Target to reach | `value >= goal` | Read ≥ 30 min |
| `atMost` | Limit to stay under | `value <= goal` **at end of day** | TV ≤ 2 h |
| `none` | Just track it | Any value > 0 | Screen time |

Checkbox tasks are implicitly `atLeast 1`.

### The `atMost` problem — read this before building streaks

A limit task **cannot be marked complete during the day.** At 9am you're under 2h of
TV, but that says nothing about 11pm. Completion for `atMost` tasks resolves only when
the day closes.

Consequences to design for, not paper over:
- Today's ring for a limit task shows **"on track" / "exceeded"**, never "complete".
- The streak for a limit task is computed with today excluded unless the day has ended.
- Exceeding the limit should mark the day failed **immediately** and stop nagging —
  once you're over, you're over.
- **A day with no data is a success.** You cannot exceed a limit you never touched, and
  demanding you log "watched 0 minutes of TV" to keep a streak alive would be absurd.
  The consequence, which is easy to miss: limit streaks accrue passively, including
  retroactively to the day the task was created. A limit task made today with a
  four-month-old creation date would show a four-month streak. Streaks are therefore
  floored at the task's `createdAt` day, and nowhere earlier.

## 4. Core mechanics

### 4.1 Day boundary
Configurable "day starts at" time, default **04:00 local**. Non-negotiable for anyone
who is awake past midnight. Without it, TV watched at 12:30am lands on the wrong day
and silently breaks a streak.

- Store every timestamp as an ISO-8601 UTC string.
- Also store a denormalized `dayKey` (`"2026-09-01"`) computed at write time using the
  user's day-start offset and timezone. The timezone is a **pinned setting**, defaulting
  to `America/New_York`, not whatever device the app happens to open on — otherwise a
  trip west silently reassigns a fortnight of history.
- Aggregations index on `dayKey`, never on date-range math over timestamps. Cheaper and
  survives timezone changes.

**Timer sessions crossing the boundary** get split when computing daily totals: a
session from 03:30 to 05:00 contributes 30 min to yesterday and 60 min to today. Store
the session whole; split at read time.

Day-key derivation uses the browser's IANA timezone via `Intl.DateTimeFormat`, not a
fixed UTC offset. A fixed offset is wrong for half the year.

### 4.2 Scheduling
Per-task repeat rule:

- `daily` — every day
- `weekdays([Mon, Wed, Fri])` — specific days
- `timesPerWeek(n)` — any n days in the week, week starts on a configurable day

Unscheduled days are **neutral**: they don't complete and they don't break a streak.

### 4.3 Streaks
Current streak = consecutive *scheduled* days, walking backward from the most recent
resolved day, where the task was complete.

- Also track longest streak and total completions.
- **Skip days:** user can mark a day "skipped" (sick, travel). Skipped days are neutral,
  same as unscheduled. Cap at N per month so it doesn't become meaningless — default 2,
  configurable, and it is fine to set it to unlimited.
- Recompute on any edit to a past day. Cache `currentStreak` in memory for cheap list
  rendering, but treat the entries as the source of truth and recompute rather than
  incrementing a counter. Incrementing counters drift, and you will not notice for
  months. **The cache is never persisted or synced** — a stale streak arriving from
  another device is a bug with no upside.

## 5. Data model

Plain TypeScript interfaces. The same shapes are the IndexedDB object stores and the
Supabase tables, so there is one schema, not three.

```ts
type TaskKind      = 'timer' | 'quantity' | 'checkbox'
type GoalDirection = 'atLeast' | 'atMost' | 'none'
type Schedule =
  | { type: 'daily' }
  | { type: 'weekdays';     days: number[] }   // 0 = Sunday
  | { type: 'timesPerWeek'; n: number }

/** On every synced row. */
interface Syncable {
  id:        string          // uuid v4, generated client-side
  updatedAt: string          // ISO-8601 UTC — drives last-write-wins
  deletedAt: string | null   // soft delete, so deletions propagate
}

interface Task extends Syncable {
  title: string
  kind: TaskKind
  goalDirection: GoalDirection
  goalValue: number | null   // seconds for timer, raw number for quantity
  unitLabel: string          // "cal", "pages"; unused for timer/checkbox
  schedule: Schedule
  quickAdds: number[]
  colorHex: string
  symbolName: string
  sortOrder: number
  isArchived: boolean
  createdAt: string
}

interface Entry extends Syncable {
  ownerType: 'task' | 'block' | 'phase'
  ownerId:   string
  dayKey:    string          // "2026-09-01"
  startedAt: string | null   // timer only
  endedAt:   string | null   // timer only; null + startedAt set = running
  amount:    number          // quantity; or 1 for a checked checkbox
  note:      string
  isSkip:    boolean         // marks the day neutral; task owners only
  createdAt: string
}

interface Todo extends Syncable {
  title: string
  notes: string
  dueDate:     string | null
  isFlagged:   boolean
  completedAt: string | null
  sortOrder:   number
  linkedTaskId: string | null
  phaseId:      string | null   // planning spec
}
```

`Entry` is polymorphic over three owners. `{ownerType, ownerId}` makes the invariant
structural — an entry cannot have two owners, because it has one pair of fields. This is
the one place the web rewrite is strictly better than the SwiftData design it replaces.

### Sync constraints baked into the above

- **Client-generated UUIDs.** Two offline devices must never collide on an id.
- **`updatedAt` on every write.** Last-write-wins per row. Single user, two devices,
  rarely conflicting — a CRDT here would be engineering for a problem you don't have.
- **Soft deletes.** A hard delete on one device is invisible to the other; a row with
  `deletedAt` set propagates. Purge tombstones older than 90 days.
- **No foreign-key constraints in Postgres.** Rows can arrive out of order.
  Referential integrity is checked in app code on read.
- **Every table carries `user_id`** with a row-level-security policy on it. The Supabase
  anon key ships in a public GitHub Pages bundle; RLS is the only thing between your
  data and the internet.

## 6. Timer implementation

**Store the start timestamp. Never accumulate a running counter.**

A running session is an `Entry` with `startedAt` set and `endedAt` null. Elapsed time is
always `now - startedAt`, computed at render. This means:

- The timer survives a tab close, a browser crash, a reboot, and a phone that sleeps.
- No background execution needed — there is none on the web, so a design that needed it
  would be dead on arrival.
- The UI ticks via one shared 1-second interval driving a React state update at the
  top of the running-timer subtree, not a timer per task.

Trade-off: it trusts the wall clock, so changing the device clock corrupts a session.
For a personal app that's fine. If it ever matters, cross-check against
`performance.now()`.

**Concurrency:** multiple timers may run at once (you can be "watching TV" and "eating"
simultaneously), but one task can only have one running session. Starting a second
session on the same task ends the first. A persistent bar shows all running timers.

**Test that catches the bug I'm worried about:** start a session at 03:45, end it at
05:15, assert yesterday's total is 15 min and today's is 75 min. Then repeat it across a
DST boundary. The midnight-split logic is where this app will break first.

## 7. Screens

| Screen | Contents |
|---|---|
| **Today** | Task list grouped by section, progress ring per task, inline start/stop and quick-add. Running timers pinned to top. |
| **To-dos** | Flat list, drag to reorder, swipe to complete, overdue section at top. |
| **Task detail** | Calendar heatmap (GitHub-style), current/longest streak, editable session and entry history, per-day totals. |
| **New/Edit task** | Title, kind, goal + direction, unit, schedule, color, icon, quick-add amounts. |
| **Stats** | Weekly/monthly totals per task, completion rate, time-of-day histogram for timer tasks. |
| **Day plan** | Hour-by-hour timeline of blocks for one day, planned vs. actual, repack. See companion. |
| **Projects** | Phased work with per-phase hour estimates and weighted progress. See companion. |
| **Settings** | Day start time, week start day, skip-day allowance, sync account, export. |

**Responsive, not forked.** One component tree. Under 768px: bottom tab bar, single
column, full-height sheets. Above it: persistent left sidebar, two-column detail,
modal dialogs, keyboard shortcuts. Same views, different container — the media query is
the only branch.

## 8. Architecture

- **React 19 + TypeScript + Vite.** Installable PWA via a web app manifest and a service
  worker for offline shell caching.
- **Local-first.** Every read and write hits IndexedDB. The UI never waits on the
  network. Sync is a background reconciliation, not a request/response path.
- **No state-management library.** React context for the store, `useSyncExternalStore`
  over a thin IndexedDB repository. Redux on top of a local database is two caches
  disagreeing.
- **Pure functions for the hard parts.** Streak computation, day-key derivation, session
  splitting, weighted progress, and repack are free functions over plain objects, with
  no React, no IndexedDB, no Supabase imports. That's what you unit test with Vitest;
  everything else is glue.

```
src/
  core/     dayKey.ts  sessionSplit.ts  streak.ts  schedule.ts  progress.ts  repack.ts
  db/       schema.ts  repo.ts          sync.ts
  ui/       Today/  Todos/  Plan/  Projects/  Settings/  shared/
  App.tsx  main.tsx
tests/      core/*.test.ts
```

### Sync design

One `sync()` pass, run on load, on focus, and every 60s while the tab is visible:

1. **Push** — every local row whose `updatedAt` is newer than `lastPushedAt`, upserted
   in one batch per table.
2. **Pull** — every remote row whose `updatedAt` is newer than `lastPulledAt`, merged
   last-write-wins into IndexedDB.
3. **Watermark** — persist the server's clock, never the client's, so a device with a
   skewed clock can't skip rows.

Offline is the normal case, not an error state. A failed sync logs and retries; it never
blocks a write and never shows a modal.

## 9. Scope

### v1 — the thing you actually use
- Three task kinds + to-do section
- Start/stop timers with session history
- Goals in both directions, daily/weekday scheduling
- Streaks with skip days
- Today screen, task detail with heatmap
- Configurable day start
- Installable PWA, works fully offline
- Supabase sync across phone and Mac
- Day plans and phased projects (companion spec, its own v1)

### v1.1
- `timesPerWeek` scheduling
- Stats screen
- JSON export / import
- Limit-exceeded alerts for `atMost` tasks
- Web push reminders (per-task time) — installed PWA only, see risk 3

### Later — features worth considering
- **HealthKit-equivalent auto-fill** is not available on the web. Closest substitute is
  a Shortcuts automation on iOS posting to the Supabase REST endpoint directly.
- **App Intents / Siri** — same route: an iOS Shortcut that writes a row, so
  "Hey Siri, start reading" still works without a native app.
- **Focus filters** — hide work tasks outside work hours.
- **Task groups / sections** (Morning, Work, Evening).
- **Notes on the day** — a one-line journal entry attached to a `dayKey`.
- **Pause on a timer**, distinct from stop. Only if you find yourself wanting it; it
  complicates the session model and most people never use it.

### Explicitly out of scope
Social features, sharing, gamification points, badges, a native client, a server of your
own. Home Screen widgets, Live Activities, and Control Center controls are impossible on
the web — that is the price of skipping the developer account, and it is paid up front.

## 10. Risks and gotchas

1. **iOS evicts browser storage after 7 days of non-use.** Safari clears
   script-writable storage for sites not used in a week. A PWA **installed to the home
   screen is exempt**, and Supabase is the backstop either way — but this makes
   installing to the home screen a requirement, not a nicety, and it makes sync load-
   bearing rather than a convenience.
2. **Supabase free projects pause after 7 days of inactivity.** Daily use keeps it warm;
   a two-week holiday means an unpause click in the dashboard. Data is not lost.
3. **iOS web push needs the installed PWA and an explicit permission grant**, and it is
   less reliable than a native notification. Treat v1.1 reminders as best-effort. If
   reminders turn out to be the feature you actually need, that is the argument for the
   $99, not a thing to engineer around.
4. **DST and timezone travel** will produce off-by-one-day bugs. Cover them in tests
   before they cost you a 40-day streak.
5. **Schema migration.** IndexedDB versioned upgrades plus SQL migrations in the repo.
   Set this up while the schema is still trivial — the planning spec's task 1 is the
   first real one.
6. **The anon key is public.** GitHub Pages on a free account requires a public repo.
   RLS policies are therefore the entire security model. Verify them by querying with
   the anon key from a logged-out client before trusting them.
7. **Scope creep from the "Later" list.** Ship v1 and live on it for two weeks before
   adding anything.

## 11. Open decisions

Defaults are chosen and used throughout this doc. Overrule any of them and I'll revise.

| # | Question | Default assumed |
|---|---|---|
| 1 | Goals in both directions, or targets only? | **Both**, set per task |
| 2 | Scheduling complexity | Daily + weekdays in v1, `timesPerWeek` in v1.1 |
| 3 | Build order | Core functions + tests → data layer → Today → timers → to-dos → streaks → sync |
| 4 | Should to-dos ever count toward streaks? | **No** — keeps the two systems separate |
| 5 | Day-start default | 04:00 |
| 6 | Skip days per month | 2 |
| 7 | Platform | React PWA, evergreen Safari/Chrome; installed to home screen |
| 8 | Do day plans or project phases affect streaks? | **No** — same reasoning as #4 |
| 9 | Sync backend | Supabase free tier, magic-link auth, RLS per `user_id` |
| 10 | Hosting | GitHub Pages, public repo, HTTPS, push to deploy |
| 11 | Conflict resolution | Last-write-wins per row on `updatedAt` |
| 12 | Which timezone governs the day boundary? | **Pinned** to `America/New_York`, changeable in Settings. Always an IANA zone name, never a fixed offset |

## 12. Planning modules

`tally-planning-spec.md` specs two additions that sit alongside the tracker rather than
inside it: **day plans** (an hour-by-hour timeline of blocks for one day, tracked against
plan) and **phased projects** (ordered phases with an hour estimate each).
Both reuse `Entry` via `ownerType`, so the schema work in that doc's task 1 gates
everything in it. Its assumption ledger carries the decisions specific to them.
