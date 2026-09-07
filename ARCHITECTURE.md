# Tally — Complete Reference

Every file and every function in the repo, what it does, and why it is written that
way. `README.md` is the introduction, `PLAYBOOK.md` is the runbooks, this is the map.

Roughly 4,800 lines of TypeScript across 38 source and test files.

---

## Table of contents

1. [Repo map](#1-repo-map)
2. [The dependency rule](#2-the-dependency-rule)
3. [Data model](#3-data-model)
4. [`src/core/` — pure logic](#4-srccore--pure-logic)
5. [`src/db/` — storage, state, sync](#5-srcdb--storage-state-sync)
6. [`src/ui/` — screens and components](#6-srcui--screens-and-components)
7. [Tests](#7-tests)
8. [Config and infrastructure](#8-config-and-infrastructure)
9. [Walkthroughs](#9-walkthroughs)

---

## 1. Repo map

| Path | Lines | What it is |
|---|---:|---|
| **Docs** | | |
| `tally-spec.md` | 356 | Product spec for the tracker |
| `tally-planning-spec.md` | 259 | Product spec for day plans and projects |
| `README.md` | — | Introduction, setup, the concepts worth knowing |
| `PLAYBOOK.md` | 241 | Runbooks: deploy, debug, migrate, release |
| `ARCHITECTURE.md` | — | This file |
| **Pure logic** — no framework imports | | |
| `src/core/types.ts` | 114 | Every domain type and `DEFAULT_SETTINGS` |
| `src/core/dayKey.ts` | 200 | The 04:00 day boundary, timezones, DST |
| `src/core/sessionSplit.ts` | 61 | Splitting timer sessions across midnight |
| `src/core/aggregate.ts` | 67 | Per-day totals from entries |
| `src/core/schedule.ts` | 37 | Is a task expected today? |
| `src/core/streak.ts` | 138 | Day status and streak computation |
| `src/core/progress.ts` | 36 | Estimate-weighted project progress |
| `src/core/repack.ts` | 95 | Day-plan block layout |
| **Data layer** | | |
| `src/db/idb.ts` | 117 | IndexedDB wrapper and schema versioning |
| `src/db/store.ts` | 487 | The only place data is mutated |
| `src/db/selectors.ts` | 164 | Derived reads over a snapshot |
| `src/db/supabase.ts` | 20 | Lazily-created client, or `null` |
| `src/db/sync.ts` | 191 | Push/pull, last-write-wins, auth |
| **UI** | | |
| `src/App.tsx` | 68 | Tab shell, routing, global sheets |
| `src/main.tsx` | 32 | Boot: load, start sync, render, register SW |
| `src/ui/hooks.ts` | 11 | `useSnapshot`, `useStore`, `useNow` |
| `src/ui/ticker.ts` | 35 | One shared 1-second tick |
| `src/ui/format.ts` | 71 | Duration, amount and date formatting |
| `src/ui/Today.tsx` | 189 | Today screen |
| `src/ui/TaskDetail.tsx` | 237 | Heatmap, streaks, history |
| `src/ui/TaskEditor.tsx` | 193 | New/edit task sheet |
| `src/ui/Todos.tsx` | 192 | To-do list |
| `src/ui/Plan.tsx` | 318 | Day plan timeline |
| `src/ui/Projects.tsx` | 309 | Projects list, detail, phases |
| `src/ui/SettingsView.tsx` | 206 | Settings, export/import, orphans |
| `src/ui/SyncPanel.tsx` | 89 | Sign-in and sync status |
| `src/ui/RunningBar.tsx` | 35 | Pinned running timers |
| `src/ui/shared/Ring.tsx` | 48 | SVG progress ring |
| `src/ui/shared/Sheet.tsx` | 26 | Modal sheet |
| `src/styles.css` | ~330 | The entire stylesheet |
| **Tests** | | |
| `tests/helpers.ts` | — | `wallClock`, `NY`, `hhmm` |
| `tests/core/*.test.ts` | — | 69 tests over pure functions |
| `tests/ui/smoke.test.tsx` | — | 12 tests driving the real app |
| **Infrastructure** | | |
| `supabase/schema.sql` | — | Tables and RLS policies |
| `.github/workflows/deploy.yml` | — | Test, build, publish to Pages |
| `public/sw.js` | — | Offline shell service worker |
| `public/manifest.webmanifest` | — | PWA manifest |
| `public/icon-*.png` | — | Generated app icons |

---

## 2. The dependency rule

```
core/  ←  db/  ←  ui/
```

Arrows point at what a layer may import. `core/` imports nothing from the others —
no React, no IndexedDB, no Supabase. That constraint is what makes 62 of the 71 tests
possible without a browser, a database, or a mock.

The practical test: if you find yourself wanting to mock something to test a piece of
logic, that logic belongs in `core/` as a function over plain objects.

---

## 3. Data model

### The shared base

```ts
interface Syncable {
  id: string                // uuid v4, generated on the client
  updatedAt: string         // ISO-8601 UTC — drives last-write-wins
  deletedAt: string | null  // soft delete, so deletions propagate
}
```

Every stored type extends this. Three rules follow from it:

- **Client-generated ids.** Two offline devices must never collide.
- **`updatedAt` on every write.** `stamp()` in `store.ts` does this; nothing else should.
- **Soft deletes.** A hard delete is invisible to the other device. The only legitimate
  hard delete is purging tombstones.

### `Task`

| Field | Type | Notes |
|---|---|---|
| `title` | `string` | |
| `kind` | `'timer' \| 'quantity' \| 'checkbox'` | Decides how a day's total is computed |
| `goalDirection` | `'atLeast' \| 'atMost' \| 'none'` | See §4 `evaluateDay` |
| `goalValue` | `number \| null` | **Seconds** for timer, raw number for quantity |
| `unitLabel` | `string` | `"cal"`, `"pages"`. Unused for timer/checkbox |
| `schedule` | `Schedule` | Discriminated union, stored inline |
| `quickAdds` | `number[]` | The `+250` / `+500` buttons |
| `colorHex` | `string` | Ring and accent colour |
| `symbolName` | `string` | Reserved; not currently rendered |
| `sortOrder` | `number` | Ascending |
| `isArchived` | `boolean` | Hidden from Today, restorable in Settings |
| `createdAt` | `string` | **Floors streak computation** — see §4 |

### `Entry` — the polymorphic one

| Field | Type | Notes |
|---|---|---|
| `ownerType` | `'task' \| 'block' \| 'phase'` | With `ownerId`, forms the owner pair |
| `ownerId` | `string` | |
| `dayKey` | `"YYYY-MM-DD"` | Stamped at write time |
| `startedAt` | `string \| null` | Timer only |
| `endedAt` | `string \| null` | `null` while `startedAt` is set = **running** |
| `amount` | `number` | Quantity, `1` for a checked checkbox, or **seconds** for a manual timer entry |
| `note` | `string` | |
| `isSkip` | `boolean` | Marks the day neutral. Task owners only |
| `createdAt` | `string` | |

One `Entry` type serves tasks, blocks and phases. That is deliberate: session splitting
and the running-timer rule are the two places this app is most likely to break, and
duplicating them per owner would mean duplicating the bug. `{ownerType, ownerId}` makes
"exactly one owner" structural rather than a rule someone has to remember.

`isSkip` is meaningless for block and phase entries. That is the cost, and it is small.

### `Todo`

`title`, `notes`, `dueDate`, `isFlagged`, `completedAt`, `sortOrder`, `linkedTaskId`
(checking it off starts that timer), `phaseId` (attaches it to a project phase).

To-dos never affect streaks. Streaks measure recurring behaviour; a to-do is a one-off
by definition.

### `DayPlan` / `Block`

`DayPlan`: `dayKey` (one plan per day, enforced in app code), `note`, `createdAt`.

`Block`: `planId`, `title`, **`plannedStartMinute`**, `plannedMinutes`, `note`,
`colorHex`, `completedAt`, `sortOrder`.

`plannedStartMinute` is **minutes since the day start, never a timestamp.** A DST
transition, a flight, or changing the day start from 04:00 to 05:00 must not corrupt a
saved plan. Rendering resolves the offset against that day's actual start.

### `Project` / `Phase`

`Project`: `title`, `notes`, `targetDate`, `colorHex`, `isArchived`, `createdAt`.

`Phase`: `projectId`, `title`, `notes`, `estimatedHours`, `completedAt`, `sortOrder`.

Children hold parent ids. There are no stored back-references, so nothing can drift out
of sync.

### `Settings`

| Field | Default | Notes |
|---|---|---|
| `dayStartMinute` | `240` | 04:00 local |
| `weekStartDay` | `1` | Monday |
| `skipDaysPerMonth` | `2` | `null` = unlimited |
| `timeZone` | `'America/New_York'` | **Pinned, not read from the device.** Always an IANA zone name, never a fixed offset — see §4 |
| `todoRetentionDays` | `30` | |

Settings live in the `meta` object store under the key `settings`, not in a collection.

---

## 4. `src/core/` — pure logic

### `types.ts`

Declarations only, plus one value:

- `DEFAULT_SETTINGS` — day start 04:00, week starting Monday, 2 skip days, 30-day to-do
  retention, and **`timeZone: 'America/New_York'`**.

  The timezone is *pinned*, not read from the device. A tracker whose day boundary
  follows you across timezones shifts your history every time you travel; one that stays
  home does not. It is also always a **zone name, never a fixed offset**: `EST` is UTC-5
  year-round, so hardcoding it would put every day key an hour out from March to
  November. `America/New_York` carries its own DST rules, which is exactly what the
  23-hour and 25-hour day tests depend on.

### `dayKey.ts` — the day boundary

A tally day runs from `dayStartMinute` local time to the same time the next calendar
day. Everything here is **civil-date arithmetic on fields already localised by `Intl`**.
That is what makes it survive DST and travel: it never adds 24 hours to an instant and
hopes.

**Types**

- `CivilDate` — `{ year, month (1-12), day }`
- `CivilTime extends CivilDate` — adds `hour`, `minute`, `second`
- `DayConfig` — `{ dayStartMinute, timeZone }`, threaded through everything

**Private**

- `formatters: Map<string, Intl.DateTimeFormat>` — one formatter per timezone.
  Constructing these is expensive, so they are cached for the process lifetime.
- `formatterFor(timeZone)` — cache accessor. Uses `hourCycle: 'h23'`.
- `tzOffsetMs(ts, timeZone)` — milliseconds to add to UTC to get local wall clock at
  that instant. Floors to whole seconds first, because `Intl` has second granularity and
  a sub-second remainder would corrupt the offset.
- `pad(n, width)` — zero padding.

**Exported**

| Function | Returns | What it does |
|---|---|---|
| `zonedParts(instant, tz)` | `CivilTime` | Wall-clock fields for an instant. Applies `% 24` to the hour because some ICU builds report `24` for midnight under `h23`. |
| `civilToInstant(c, tz)` | `Date` | The instant at which a wall clock occurs. **Two-pass**, because the offset depends on the answer: guess with the civil numbers read as UTC, then re-solve with the offset that guess produced. |
| `addCivilDays(d, n)` | `CivilDate` | Date arithmetic with no timezone involved, so there is no DST to get wrong. |
| `formatDayKey(d)` | `"YYYY-MM-DD"` | |
| `parseDayKey(key)` | `CivilDate` | Throws on a malformed key. |
| `dayKeyFor(instant, cfg)` | `string` | **The central function.** Localises the instant, then subtracts a calendar day if the local time-of-day is before `dayStartMinute`. |
| `dayStartInstant(dayKey, cfg)` | `Date` | When a tally day begins. |
| `dayEndInstant(dayKey, cfg)` | `Date` | Identical to the next day's start — computed independently, which is why DST works. |
| `dayLengthMs(dayKey, cfg)` | `number` | Real elapsed length. **23h or 25h across a transition.** |
| `isDayEnded(dayKey, cfg, now)` | `boolean` | Gates `atMost` completion and `atLeast` failure. |
| `addDayKey(key, n)` | `string` | |
| `weekdayOf(dayKey)` | `0-6` | 0 = Sunday, via `Date.UTC`, so it cannot drift. |
| `eachDayKey(from, to)` | `string[]` | Inclusive, ascending. Returns `[]` on an inverted range rather than looping forever. |
| `compareDayKeys(a, b)` | `-1 \| 0 \| 1` | Lexicographic, which is correct for zero-padded ISO dates. |
| `instantForDayMinute(dayKey, minute, cfg)` | `Date` | Resolves a block's planned start. **By wall clock, not elapsed time** — minute 360 is 10:00 on a 23-hour day too, so the day's tail compresses instead of every block shifting an hour. |
| `formatDayMinute(minute, cfg)` | `"HH:MM"` | Rendering helper. |

**Documented edge cases.** Ambiguous local times (the hour repeated when clocks go back)
resolve to the **first** occurrence. Times that do not exist (the hour skipped going
forward) resolve to the instant just **after** the gap. Both are choices, not accidents.

### `sessionSplit.ts`

- `DaySlice` — `{ dayKey, seconds }`
- `asMs(v)` *(private)* — accepts `Date | number | string`.
- **`splitSession(startedAt, endedAt, cfg): DaySlice[]`** — walks from the start,
  clipping at each day's end instant. A session from 03:30 to 05:00 with a 04:00 day
  start yields 30 minutes yesterday and 60 today. Returns `[]` for a zero-length or
  inverted session, and breaks out rather than hanging if a malformed config produces a
  non-advancing boundary.
- **`sessionSeconds(startedAt, endedAt, now): number`** — elapsed time, **derived by
  subtraction, never accumulated**. A running session passes `endedAt = null` and gets
  measured against `now`. This is what makes a timer survive a closed tab, a crashed
  browser, and a reboot.
- `isRunning(startedAt, endedAt): boolean` — `startedAt` set and `endedAt` null.

### `aggregate.ts`

- `live(e)` *(private)* — not tombstoned.
- `entriesForOwner(entries, ownerType, ownerId)` — the owner-pair filter. Everything
  that reads entries goes through this.
- **`dailyTotals(entries, kind, cfg, now): Map<dayKey, number>`** — the fork in the road:
  - `kind === 'timer'` with a `startedAt` → split across the boundary
  - `kind === 'timer'` without one → a manual entry; `amount` carries **seconds** and
    counts against its stamped `dayKey`
  - otherwise → sum `amount` by stamped `dayKey`

  Skips and tombstones are excluded. A running session counts up to `now`.
- `totalForDay(...)` — one day out of the above.
- `skippedDays(entries): Set<string>` — days marked skipped.
- `orphanedEntries(entries, knownIds)` — entries whose owner is gone. Surfaced in
  Settings, never deleted silently: a dropped hour you can see beats a double-counted
  one you cannot.

### `schedule.ts`

- **`isScheduled(schedule, dayKey): boolean`** — `daily` → true; `weekdays` → membership;
  `timesPerWeek` → **true for every day**, because "n days anywhere in the week" is a
  week-level rule, not a day-level one. Its real evaluation is v1.1.
- `describeSchedule(schedule): string` — `"Every day"`, `"Mon, Wed, Fri"`, `"3× per week"`.

### `streak.ts`

- `DayStatus` = `'complete' | 'incomplete' | 'neutral' | 'unresolved'`
- `EffectiveGoal` — `{ direction, value }`
- **`effectiveGoal(kind, direction, value)`** — a checkbox is implicitly `atLeast 1`; a
  task with no goal value falls back to `none`.
- **`evaluateDay({ goal, total, isSkip, scheduled, dayEnded }): DayStatus`** — the whole
  rule set in one function:

  | Condition | Result |
  |---|---|
  | skipped or unscheduled | `neutral` |
  | `atLeast`, `total >= goal` | `complete` (immediately, mid-day) |
  | `atLeast`, short, day ended | `incomplete` |
  | `atLeast`, short, day running | `unresolved` |
  | `atMost`, `total > goal` | `incomplete` — **immediately; over is over** |
  | `atMost`, under, day ended | `complete` |
  | `atMost`, under, day running | `unresolved` — **never "complete" mid-day** |
  | `none`, `total > 0` | `complete` |

- `StreakResult` — `{ current, longest, totalCompletions, statuses: Map<dayKey, DayStatus> }`
- **`computeStreaks(task, entries, cfg, now): StreakResult`** — walks from the earliest
  of `createdAt` and any entry day, forward to today for `longest` and
  `totalCompletions`, then backward from today for `current`. Backwards, `neutral` and
  `unresolved` days pass through without counting or breaking; `incomplete` stops the
  walk. Statuses are memoised inside the call so each day is evaluated once.

  **Two consequences worth internalising:**

  1. `unresolved` can only be today or later, so skipping it backwards is exactly what
     "today is excluded until the day ends" means in code.
  2. For an `atMost` task, a day with **no data is a success** — you cannot exceed a
     limit you never touched. Limit streaks therefore accrue passively. The floor at
     `createdAt` is the only thing stopping a limit task from claiming a streak that
     predates its own existence.

- `limitStatusToday(total, goal)` — `'onTrack' | 'exceeded'`. Never `'complete'`.
- `skipsUsedInMonth(entries, dayKey)` — counts by the `"YYYY-MM"` prefix, so the
  allowance is per calendar month, not a rolling window.

### `progress.ts`

- **`weightedProgress(phases): number`** — completed estimated hours ÷ total estimated
  hours. A 20h phase beside a 2h one is **91%** when the first finishes, not 50%;
  count-weighted bars lie exactly when the work is lumpiest. All-zero estimates fall
  back to count-weighting rather than dividing by zero. Negative estimates are clamped
  to 0 so they cannot subtract progress.
- `currentPhase(phases)` — first incomplete in sort order. **Display only** — phases can
  be completed in any order, and this is not a gate.

### `repack.ts`

- `MINUTES_PER_DAY = 1440`, `BLOCK_GRANULARITY = 15`
- `inSortOrder(blocks)` — stable sort by `sortOrder`, then `id`.
- `plannedEndMinute(b)` — start + duration.
- **`repack(blocks, fromId): T[]`** — chains every block *after* `fromId` onto the one
  before it. It **never reorders, never changes durations, and never touches blocks at
  or before `fromId`.** Returns only the blocks whose start actually moved, which is
  what makes a one-step undo possible.
- `isPlannedWithinDay(b)` — rejects a planned start past 1440 or below 0. **Planned
  overflow is rejected; actual time is never clamped** — a block worked past the
  boundary is split by the same function that splits task timers.
- `findOverlaps(blocks): Overlap[]` — overlaps are legal and get a warning stripe. This
  is a plan, not a calendar engine with conflict resolution.
- `findGaps(blocks)` — unplanned time, rendered between blocks.
- `variance(actualSeconds, plannedMinutes)` — signed minutes; positive means over plan.
- `formatVariance(minutes)` — `"+35m"`, `"−1h 10m"`, `"on plan"`.

---

## 5. `src/db/` — storage, state, sync

### `idb.ts` — IndexedDB wrapper

Small enough not to justify a dependency. Versioned upgrades are set up while the schema
is still trivial, which is the only time it is cheap to do.

**Constants**

- `DB_NAME = 'tally'`, `DB_VERSION = 1`
- `STORES` — `tasks`, `entries`, `todos`, `dayPlans`, `blocks`, `projects`, `phases`,
  `meta`. `meta` is keyed by `key`; every other store by `id`.
- `INDEXES` *(private)* — `entries.byOwner` on `[ownerType, ownerId]` and
  `entries.byDayKey`; `blocks.byPlan`; `phases.byProject`; `dayPlans.byDayKey`;
  `todos.byPhase`.

**Functions**

| Function | What it does |
|---|---|
| `wrap(req)` *(private)* | Promisifies an `IDBRequest`. |
| `openDb()` | Opens once and caches the promise. `onupgradeneeded` creates any missing store or index and leaves existing ones alone, so a version bump is safe against real data. Rejects on `onblocked` — another tab holding an old version. |
| `getAll<T>(store)` | Every row in a store. |
| `putMany(store, rows)` | Upsert in one transaction. |
| `getMeta<T>(key)` / `setMeta(key, value)` | The `meta` store: settings and sync watermarks. |
| `hardDelete(store, ids)` | Real deletion. **Only for purging tombstones** — user-facing deletes are soft. |
| `clearAll()` | Empties every store in one transaction. Backs test isolation and a future "erase all data". |

### `store.ts` — the only place data changes

Everything is held in memory and written through to IndexedDB. A personal tracker's
whole history is a few thousand rows, so keeping it resident makes rendering and streak
recomputation trivial and removes every loading state from the UI.

**Module helpers**

- `EMPTY` — the initial snapshot, `ready: false`.
- `nowIso()` — `new Date().toISOString()`.
- `uuid()` — `crypto.randomUUID()` with a timestamp+random fallback.
- `stamp(row)` — sets `updatedAt`. **The only thing that should.**

**`Snapshot`** — `{ ready, tasks, entries, todos, dayPlans, blocks, projects, phases, settings }`.

**`class TallyStore`**

| Member | What it does |
|---|---|
| `subscribe(fn)` | For `useSyncExternalStore`. Returns an unsubscribe. |
| `getSnapshot()` | Current immutable snapshot. |
| `emit(next)` *(private)* | Replaces the snapshot and notifies. Every mutation ends here. |
| `get dayConfig` | `{ dayStartMinute, timeZone }` from settings — the `DayConfig` every core function takes. |
| `todayKey(now?)` | Today's `dayKey`. |
| `load()` | Reads all eight stores in parallel and fills the snapshot. An explicit `timeZone` choice wins; otherwise the Eastern default applies. |
| `persist(collection, rows)` *(private)* | Merges rows into memory by id, emits, then writes to IndexedDB. Every mutation below funnels through this. |

**Settings**

- `updateSettings(patch)` — merges and writes to `meta`.

**Tasks**

- `createTask(input)` — fills every default, appends at `max(sortOrder) + 1`.
- `updateTask(id, patch)` — stamps `updatedAt`; `id` cannot be patched away.
- `deleteTask(id)` — soft-deletes the task **and every entry logged against it** in one pass.
- `reorderTasks(orderedIds)` — writes only the rows whose `sortOrder` actually changed.

**Entries**

| Method | Notes |
|---|---|
| `newEntry(ownerType, ownerId, over?)` *(private)* | **The single `Entry` factory.** Nothing else constructs one; this is what keeps the owner pair coherent. |
| `runningEntries()` | `startedAt` set, `endedAt` null, not tombstoned. |
| `startTimer(ownerType, ownerId)` | **Asymmetric on purpose.** For a task, ends any running session *on that task*. For a block, ends any running block *anywhere*, because only one block runs at a time — and never touches a running task timer. |
| `stopTimer(entryId)` | Sets `endedAt`. No-op if already stopped. |
| `toggleTimer(ownerType, ownerId)` | What the buttons call. |
| `addManualSeconds(owner, seconds, dayKey?)` | For when you forgot to hit start. Stored as `amount` in seconds with no session. |
| `logQuantity(taskId, amount, dayKey?)` | One entry per log, so the history keeps its timestamps. |
| `setCheckbox(taskId, dayKey, checked)` | Creating is idempotent; unchecking tombstones every matching non-skip entry for that day. |
| `setSkip(taskId, dayKey, isSkip)` | Same shape, on the skip flag. |
| `updateEntry(id, patch)` / `deleteEntry(id)` | Editing history. `deleteEntry` is a soft delete. |

**To-dos**

- `createTodo(input)` — new to-dos go to the **top** (`min(sortOrder) - 1`).
- `updateTodo(id, patch)`
- **`toggleTodo(id)`** — on completion, if `linkedTaskId` points at a live **timer** task,
  starts that timer. Checking off "write the quarterly review" starts *Deep Work*.
- `deleteTodo(id)`, `reorderTodos(orderedIds)`
- `purgeCompletedTodos(now?)` — tombstones anything completed longer ago than
  `todoRetentionDays`.

**Day plans**

- `ensurePlan(dayKey)` — finds or creates. One plan per day, enforced here.
- `addBlock(planId, input)` — defaults the start to the previous block's end, so adding
  blocks in order needs no typing.
- `updateBlock(id, patch)`
- `deleteBlock(id)` — soft-deletes the block **and its entries**.
- `reorderBlocks(orderedIds)`
- **`repackFrom(planId, fromId)`** — captures the previous starts, applies
  `core/repack`, and **returns an undo closure** that restores them in one write.

**Projects**

- `createProject`, `updateProject`
- `deleteProject(id)` — soft-deletes the project and its phases.
- `addPhase(projectId, input)`, `updatePhase`
- `togglePhase(id)` — **no gating.** Phase 3 can be completed before phase 2; order is
  intent, not a state machine.
- `deletePhase(id)`, `reorderPhases(orderedIds)`

**`export const store = new TallyStore()`** — one module singleton. There is no context
provider, because there is nothing to configure per tree.

### `selectors.ts` — derived reads

Pure over a snapshot, so they stay cheap and testable. `alive(rows)` filters tombstones
and is applied everywhere.

| Selector | Returns |
|---|---|
| `liveTasks(s)` | Unarchived, sorted by `sortOrder`. |
| `archivedTasks(s)` | For the Settings restore list. |
| `taskEntries(s, id)` / `blockEntries(s, id)` | Owner-pair filtered. |
| `TaskToday` | `{ task, total, goalValue, status, scheduled, skipped, running, fraction }` |
| **`taskToday(s, task, dayKey, cfg, now)`** | Everything a Today row needs. `fraction` is `total / goal`, clamped; with no goal the denominator falls back to `max(total, 1)` so the ring never divides by zero. Calls `evaluateDay` with `dayEnded: false` because it is, by definition, today. |
| `streaksFor(s, task, cfg, now)` | `computeStreaks` bound to a task's entries. |
| `heatmap(s, task, cfg, now, days, todayKey)` | `{ dayKey, status }[]`, oldest first. |
| `dayTotalsFor(s, task, cfg, now)` | `Map<dayKey, number>` for tooltips. |
| `liveTodos` / `openTodos` / `doneTodos` | Done sorted newest first. |
| `isOverdue(todo, now)` | Incomplete and past due. |
| `planFor(s, dayKey)` / `blocksFor(s, planId)` | |
| `BlockView` | `{ block, actualSeconds, varianceMinutes, running, endMinute }` |
| `blockView(s, block, cfg, now)` | Sums **all** day slices, so a block worked across the boundary reports its full duration even though the time lands in two days. |
| `liveProjects` / `phasesFor` | Archived projects sort last. |
| `ProjectView` | `{ project, phases, progress, current, estimatedHours }` |
| `projectView(s, project)` | |
| `todosForPhase(s, phaseId)` | |
| `runningEntries(s)` | Everything running, any owner type. |
| `orphans(s)` | Entries whose `ownerId` matches no live task, block or phase. |

### `supabase.ts`

Reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

- `isSyncConfigured` — both present.
- `supabase()` — lazily creates and caches the client, or returns **`null`**. Nothing in
  the app blocks on this; with no project configured Tally is simply local-only, which
  works fully.

### `sync.ts`

One user, two devices, rarely editing the same row at the same moment. That shape makes
**last-write-wins per row** the right answer and a CRDT engineering for a problem that
does not exist.

**Constants**

- `TABLES` — local collection → remote table (`dayPlans` → `day_plans`; the rest match).
- `PULL_KEY = 'sync:lastPulledAt'`, `PUSH_KEY = 'sync:lastPushedAt'`, `EPOCH`.

**State**

- `SyncState` — `off` (not configured) | `signedOut` | `idle` (with the last result) |
  `syncing` | `error`.
- `subscribeToSync(fn)` / `getSyncState()` — a `useSyncExternalStore` pair, same shape as
  the main store.
- `running: Promise | null` — **a second `sync()` while one is in flight returns the same
  promise** rather than starting a concurrent pass.

**`sync()`** — one pass, per table:

1. **Push** every local row with `updatedAt > lastPushedAt`, upserted on `id` as
   `{ id, user_id, updated_at, deleted_at, data }`.
2. **Pull** every remote row with `updated_at > lastPulledAt`, ordered ascending. An
   incoming row wins only if its `updatedAt` is strictly newer than the local one.
3. **Advance the watermark from the newest row the server returned**, never from this
   device's clock, so a skewed clock cannot skip rows.
4. Reload the store if anything was pulled.

Failures set `error` and keep the watermarks. **Offline is the normal case, not an
exception** — a failed pass never blocks a write and never shows a modal.

**Other exports**

- `startSyncLoop()` — syncs on load, on window focus, on `online`, and every 60s while
  the tab is visible.
- `signIn(email)` — magic link via `signInWithOtp`, redirecting back to the current URL.
  Returns a message to display.
- `signOut()` — signs out and **resets both watermarks**, so a second account never
  inherits the first one's position.
- `currentEmail()` — the signed-in address, or `null`.

---

## 6. `src/ui/` — screens and components

### `main.tsx` — boot sequence

1. `store.load()` — reads IndexedDB.
2. `.catch()` logs and continues. **A browser with IndexedDB blocked (a private window,
   locked-down settings) must still render**, not show a blank page.
3. `.finally()` → `startSyncLoop()`, then render `<App />` in `StrictMode`.
4. In production only, registers `sw.js` at `import.meta.env.BASE_URL`. A failed
   registration is swallowed — the offline shell is a nicety, not a requirement.

### `App.tsx`

Holds three pieces of state: `tab`, `detailId`, `editing`. No router — five tabs and one
detail view do not need one.

- `TABS` — `today` ◎, `todos` ✓, `plan` ▤, `projects` ◈, `settings` ⚙.
- `screen()` — Today swaps to `TaskDetail` when `detailId` is set; switching to the Today
  tab clears it.
- `TaskEditor` renders at the App level so it can be opened from both Today and
  TaskDetail.
- Renders `Loading…` until `snapshot.ready`.

The same markup is a bottom tab bar under 900px and a left sidebar above it. That is a
CSS media query in `styles.css`, not a branch in the component.

### `hooks.ts`

- `useSnapshot()` — `useSyncExternalStore` over the store.
- `useStore()` — the singleton.
- `useNow()` — re-renders once a second. **Only call it where a running timer is on
  screen.**

### `ticker.ts`

One shared one-second tick for every running timer.

- `subscribeToTick(fn)` — starts the interval on the first subscriber, clears it on the
  last. Also ticks on `visibilitychange`, because a backgrounded tab comes back with a
  stale clock.
- `getTick()` — the current second, floored.

It holds **no elapsed time**. It is a render trigger and nothing else; elapsed time is
always derived from `startedAt`.

### `format.ts`

| Function | Example |
|---|---|
| `formatDuration(seconds)` | `"1h 24m"`, `"45m"`, `"0m"` |
| `formatClock(seconds)` | `"1:24:33"`, `"05:12"` — for a running timer, where seconds matter |
| `formatAmount(task, value)` | Duration for timers, `"750 ml"` otherwise |
| `formatGoal(task)` | `"30m goal"`, `"1,500 cal limit"`, or `null` |
| `parseDurationToSeconds(input)` | Accepts `"1h 30m"`, `"90m"`, `"1:30"`, or a bare number read as minutes |
| `formatDayKeyShort` / `formatDayKeyLong` | `"Sep 1"` / `"Tuesday, September 1"` — parsed as UTC so no timezone shifts the label |

### `Today.tsx`

**`Today({ onOpenTask, onNewTask })`** — splits tasks into scheduled and
"Not scheduled today" (unscheduled or skipped, rendered dimmed).

**`TaskRow`** *(internal)* — ring, title, meta line, action button. **The ring holds the
current streak count once the day is complete** — 1, then 2, then 3 — and is empty
before that, so the number is the reward for finishing rather than a running commentary.

The action button:

- **timer** → start/stop, showing a live clock while running
- **checkbox** → a check button
- **quantity** → a `+` opening `LogSheet`, plus a row of quick-add pills below

The meta line is where the `atMost` rule surfaces: a limit task reads
`"1h 12m · 2h limit · on track"` or `"· exceeded"` — **never "complete"**. The ring
renders full and red when exceeded rather than claiming 110%.

**`LogSheet`** *(internal)* — a number input for quantity tasks. Enter submits.

### `TaskDetail.tsx`

`HEATMAP_DAYS = 133` — 19 weeks, which fills a 7-row grid exactly.

**`TaskDetail({ taskId, onBack, onEdit })`** — renders a "no longer exists" state if the
task was deleted while open. Contains:

- A 62px ring with percentage, or a tick for checkbox tasks
- Three stats: current streak, longest, completions
- The heatmap; each cell's `title` is `dayKey · status · total`
- Today's actions: start/stop, add time, skip/un-skip, plus the skip allowance used
- The last 40 entries, each deletable
- Archive and delete, with a `confirm()` on delete

**`EntryRow`** *(internal)* — one entry: amount or live duration, day, time, and a delete
button. Flags a running session in red.

**`AddTimeSheet`** *(internal)* — parses a duration string, previews the parse, and lets
you pick Today or Yesterday.

### `TaskEditor.tsx`

**`TaskEditor({ task, onClose })`** — one component for create and edit; `task === null`
means create.

Fields: title; kind (timer/quantity/checkbox); goal direction (at least / at most / just
track); goal value, parsed through `parseDurationToSeconds` for timers; unit label and
quick-adds for quantity; schedule; colour.

- Fields appear and disappear by kind — a checkbox has no goal, a timer has no unit.
- Choosing **at most** shows an inline explanation of the rule, at the moment the
  decision is being made rather than in documentation nobody reads.
- The weekday pills toggle; clearing them all falls back to `daily`.

### `Todos.tsx`

**`Todos()`** — overdue section pinned at the top, then open items, then the last 20
completed, plus a "Clear old completed" action.

**`TodoRow`** *(internal)* — check button, title (struck through when done), and a meta
line showing the due date, the linked task (`"starts Deep Work"`), or the notes.

**`TodoEditor`** *(internal)* — title, notes, due date, priority flag, and a select
listing only **timer** tasks for the link, because linking to a checkbox would do
nothing.

### `Plan.tsx`

**`Plan()`** — the day laid out as **96 fifteen-minute slots**, `←` / Today / `→` to
any date. It is a canvas, not a list.

- Every slot from the day start to the day start is rendered, at `SLOT_PX = 22` per
  15 minutes, so the column is proportional to real time
- **Tap an empty slot** to anchor a block, **tap a second slot** to stretch it across the
  range, then name it. Two taps works on touch where a drag does not
- A block renders as one merged cell spanning its slots; the slots it covers are no
  longer tappable
- Three stats: planned, unplanned, blocks done
- **No timer.** A plan is what you intend; measurement lives on tasks

`snap(minute)` rounds to the 15-minute grid — anything off it would render in the wrong
row. Blocks are keyed by start minute into `byStart`, and every minute they occupy goes
into `covered`, which is what lets the render loop skip past a merged cell.

> **Closure trap, fixed and worth remembering.** The rows are built in a `while` loop
> over a single `let m`. An `onClick={() => tapSlot(m)}` there captures the *variable*,
> so every slot fires with the loop's final value. A `for (let ...)` gets a fresh
> binding per iteration; a `while` does not. Each row now copies `m` into a `const`.

**`BlockSheet`** *(internal)* — one sheet for create and edit. Title, a `−15m / +15m`
duration stepper with 30m/1h/2h/4h shortcuts, a `−15m / +15m` start nudge, note, colour,
mark done, delete. Refuses to save a block running past the end of the day.

### `Projects.tsx`

**`Projects()`** — list with a weighted progress bar, the current phase, and the total
estimate. Selecting one swaps to detail in the same component.

**`ProjectDetail`** *(internal)* — progress bar, notes, phases. Each phase shows its
number or a tick, its estimate, and its to-do count. **When every to-do in a phase is
done it offers "All to-dos done — mark phase done?" rather than closing the phase
itself** — the affordance is the point.

**`ProjectEditor`** / **`PhaseEditor`** *(internal)* — title, notes, target date;
title, estimated hours, notes, and reordering.

### `SettingsView.tsx`

`COLLECTIONS` — the seven synced stores, used by export and import.

- **Day** — day start (a time input writing `dayStartMinute`), **time zone** (the full
  IANA list via `Intl.supportedValuesOf`, falling back to a shortlist), week start, and
  skip allowance (blank = unlimited)
  - `ZoneClock` *(internal)* — a live clock in the selected zone plus the day it
    currently counts toward. When the device zone differs it says so and offers to
    follow the device instead. The day boundary is invisible until it is wrong, and by
    then it has already moved a streak
- **Sync** — `<SyncPanel />`
- **Storage** — persistent-storage state, a **Request persistent storage** button, and
  JSON export/import
  - `exportJson()` — reads all seven stores plus settings into a dated download
  - `importJson(file)` — `putMany` per collection, so it is an **upsert, not a
    wipe-and-load**; importing an old export cannot delete newer rows
- **To-dos** — retention days
- **Archived tasks** — with Restore
- **Orphaned entries** — a count and an explanation, listed rather than deleted

### `SyncPanel.tsx`

Three states: not configured (explains Tally is local-only and what to add), signed out
(email field and "Send sign-in link"), signed in (account, last result, Sync now, Sign
out). Subscribes to `SyncState` directly.

### `RunningBar.tsx`

Sticky at the top of Today and Plan whenever anything is running. Resolves each running
entry's label through its owner type, shows a pulsing dot and a live clock, and offers
Stop. **Multiple timers may run at once** — you can be watching TV and eating.

### `shared/Ring.tsx`

`Ring({ fraction, color, size, exceeded, children })` — an SVG circle with a
`strokeDasharray` offset, rotated -90° so it starts at the top. `exceeded` forces a full
red ring: a blown limit is not "110% complete".

### `shared/Sheet.tsx`

`Sheet({ title, onClose, children })` — a modal with `role="dialog"`. Closes on Escape
and on a backdrop press, but only when the press started on the backdrop, so a drag that
ends outside does not dismiss it. A bottom sheet on phones, centred above 700px.

### `styles.css`

CSS custom properties, dark by default with a `prefers-color-scheme: light` block.
Notable pieces: the `.tabs` bar becoming a sidebar at 900px; `.heat` as a 7-row
`grid-auto-flow: column`; `.num` applying `tabular-nums` so timers do not jitter;
`env(safe-area-inset-*)` throughout for the notch and home indicator.

---

## 7. Tests

**81 tests, ~2 seconds.** `npm run test`.

### `tests/helpers.ts`

- `NY` — `{ dayStartMinute: 240, timeZone: 'America/New_York' }`
- `wallClock(iso, cfg?)` — builds an instant from a wall clock **through
  `civilToInstant`**. Adding 3.75 real hours to midnight on a spring-forward day lands at
  04:45, not 03:45 — the first draft of this helper had exactly that bug and two tests
  caught it. Never construct a test instant by adding hours.
- `hhmm(date, cfg?)` — formats an instant back to wall clock.

### `tests/core/` — 69 tests

| File | Covers |
|---|---|
| `timezone.test.ts` (7) | The Eastern default, that it ignores the device zone, the day starting at 04:00 Eastern rather than 04:00 anywhere, a Pacific device assigning a different day, EDT/EST tracked automatically, and why a fixed UTC-5 offset would be wrong |
| `dayKey.test.ts` (13) | Late-night rollover, the day-start boundary, changing day start, timezone independence, **the 23-hour and 25-hour DST days**, wall-clock resolution of planned minutes, month/year/leap boundaries, `isDayEnded` |
| `sessionSplit.test.ts` (11) | **03:45→05:15 = 15/75**, the same across spring-forward and fall-back, single-day sessions, a three-day session, zero-length and inverted, derived elapsed across a two-day gap, block splitting, manual entries, tombstones and skips |
| `streak.test.ts` (20) | Every `evaluateDay` branch, checkbox implicit goal, counting back through a failure, an unfinished today, limits excluded until day end, a blown limit breaking immediately, skips and unscheduled days as neutral, **recomputation after editing a past day**, and the passive limit-streak behaviour with its `createdAt` floor |
| `progress.test.ts` (8) | **20h + 2h = 91%**, the 9% mirror case, zero-estimate fallback, empty, negative estimates, `currentPhase` with out-of-order completion |
| `repack.test.ts` (10) | **Inserting a block shifts exactly what follows**, nothing before the point moves, no reordering or duration changes, returning only moved blocks, unknown ids, overflow rejection, gaps, overlaps, variance formatting |

### `tests/ui/smoke.test.tsx` — 12 tests

jsdom + `fake-indexeddb`. Each starts from `clearAll()`, so titles stay unambiguous.

Renders the empty state; creates a task and starts/stops its timer; checks off a
checkbox; quick-adds two quantities and asserts the total; **asserts a limit task reads
"on track" then "exceeded" and never "complete"**; navigates tabs and creates a to-do;
lays the day out in 15-minute slots and stretches a block across a tapped range;
asserts the plan has **no** start or stop control anywhere; creates a project with 20h
and 2h phases and asserts 91%; watches the streak number appear inside the ring on
completion and disappear on un-completion; opens task detail and finds the streak stats.

**Why these exist:** a green typecheck and a successful build both pass on a component
that throws on mount and renders nothing.

---

## 8. Config and infrastructure

| File | What it does |
|---|---|
| `package.json` | Scripts: `dev`, `build`, `preview`, `test`, `test:watch`, `typecheck`. Runtime deps: `react`, `react-dom`, `@supabase/supabase-js`. |
| `tsconfig.json` | `strict`, plus **`noUncheckedIndexedAccess`** (array access yields `T \| undefined`) and `verbatimModuleSyntax` (type imports must say `import type`). |
| `vite.config.ts` | `base` becomes `/Tally/` when `GITHUB_PAGES=true`, `/` otherwise. |
| `vitest.config.ts` | Node environment by default; UI tests opt into jsdom with a `// @vitest-environment jsdom` docblock. |
| `index.html` | Viewport with `viewport-fit=cover`, theme colours per scheme, Apple PWA meta tags, manifest and touch icon links. |
| `public/manifest.webmanifest` | `display: standalone`, relative `start_url`/`scope` so it works under a subpath. |
| `public/sw.js` | **Network-first for navigations** so a deploy is picked up next open; **cache-first for hashed assets**, which never change under the same name. Data never passes through it. |
| `public/icon-*.png` | Generated: an indigo ground with a 72%-filled ring, the app's own motif. The maskable variant carries a larger safe zone. |
| `supabase/schema.sql` | One table per collection: `id`, `user_id`, `updated_at`, `deleted_at`, `data jsonb`. Deliberately **not** a column-per-field mapping — the client holds everything in memory and never queries by field, so columns would buy nothing and cost a migration on every shape change. Per-command RLS policies on `auth.uid() = user_id`. Idempotent. |
| `.github/workflows/deploy.yml` | On push to `main`: `npm ci`, test, build with `GITHUB_PAGES=true`, publish to Pages. Supabase values come from repository **Variables** — public by design. |
| `.env.example` | Template for `.env.local`. |

---

## 9. Walkthroughs

### Starting a timer

1. `TaskRow` calls `store.toggleTimer('task', id)`.
2. No running entry for that task, so `startTimer` runs. It ends any other running
   session **on that task**, then `newEntry` creates one with `startedAt = now` and
   `dayKey = todayKey()`.
3. `persist('entries', [entry])` merges into the snapshot, emits, and writes to IndexedDB.
4. `useSnapshot` re-renders. `RunningBar` appears; `useNow` starts the shared tick.
5. Each second, `sessionSeconds(startedAt, null, now)` recomputes elapsed. **Nothing is
   stored per tick** — close the tab, reboot, come back tomorrow, the number is still
   right, because it was never a counter.
6. `sync()` pushes the entry on its next pass.

### Rendering one Today row

1. `Today` computes `dayKey = store.todayKey(now)`.
2. `taskToday(s, task, dayKey, cfg, now)`:
   - `taskEntries` filters by owner pair
   - `dailyTotals` splits timer sessions across the boundary, or sums stamped amounts
   - `effectiveGoal` resolves checkbox → `atLeast 1`
   - `isScheduled` checks the schedule against the weekday
   - `evaluateDay` returns `complete` / `incomplete` / `neutral` / `unresolved`
3. `TaskRow` renders the ring from `fraction`, and the meta line from `status` — which is
   where a limit task gets "on track" instead of "complete".

### A sync pass

1. `startSyncLoop()` calls `sync()` on load, focus, `online`, and every 60s while visible.
2. `sync()` returns early with no client, or sets `signedOut` with no user.
3. Per table: push rows newer than `lastPushedAt`, pull rows newer than `lastPulledAt`,
   merge each incoming row only if strictly newer than the local one.
4. Watermarks advance from the newest `updated_at` the **server** returned.
5. If anything came down, `store.load()` refreshes the snapshot and the UI re-renders.
6. Any failure sets `error`, keeps the watermarks, and the next pass tries again.

### Where a day gets decided

Every timestamp answer in the app traces back to two functions:

- `dayKeyFor(instant, cfg)` — which day does this moment belong to?
- `dayEndInstant(dayKey, cfg)` — when does that day stop?

`splitSession` uses both to clip a session. `dailyTotals` uses `splitSession`.
`computeStreaks` uses `dailyTotals` and `isDayEnded`. `taskToday` uses `computeStreaks`'
building blocks. The Today screen renders the result.

Change the day boundary logic and everything above it moves in step — which is exactly
why it is one small module with 13 tests pointed at it.
