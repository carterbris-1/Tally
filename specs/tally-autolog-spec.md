# Tally — Auto-Log to Day Plan — Spec

> Fourth companion to `tally-spec.md`, `tally-planning-spec.md` and `tally-next-spec.md`.
> A per-task flag that turns a finished timer session into a completed block on that day's
> plan. Same React + TypeScript PWA, same local-first store, no new dependencies.

## 1. What it is

Today the timer and the day plan never speak. You press play on **Read**, sit for 45
minutes, press stop, and the plan for that day still shows whatever you sketched at
breakfast. The session exists only as an `Entry`, visible in stats and nowhere on the
timeline.

This adds one flag per task. With it on, stopping the timer writes a completed block onto
that day's plan at the time it actually happened.

The screen is now called **Schedule** in the UI, not "Day plan". The rename is copy only:
the stored shapes are still `DayPlan`, `Block` and `logToPlan`, and the Supabase table is
still `day_plans`, because renaming those buys nothing a user can see and costs a
migration. The task editor's recurrence field was relabelled "Repeat" in the same pass —
two fields called "Schedule" sat next to each other otherwise, meaning different things.

It is worth being explicit that this reverses a decision already made and documented.
`src/ui/Plan.tsx` opens with: *"Nothing here starts a timer — a plan is what you intend,
and mixing intention with measurement was making both harder to read."* The plan was
deliberately kept free of measurement. After this change the canvas carries both, and the
two are indistinguishable by design (§9, #1). That is the trade being made: a single
honest timeline of the day, at the cost of no longer being able to ask what you *meant*
to do. If that reads wrong, the cheapest moment to reverse it is now.

## 2. Requirements

### 2.1 The setting

A boolean on `Task`, default `false`, surfaced in `TaskEditor` as **Add to schedule**.
Only meaningful for `kind === 'timer'`; hidden for checkbox and quantity tasks, which have
no session to place. Existing tasks read as `false` when the field is absent — no
migration, no backfill.

### 2.2 What gets written

When a timer session on a flagged task ends:

| Field | Value |
|---|---|
| `title` | the task's title, verbatim |
| `colorHex` | the task's `colorHex`, so it reads as that task on the canvas |
| `plannedStartMinute` | real offset from day start, to the minute, unsnapped |
| `plannedMinutes` | the slice's real duration, rounded to the nearest minute |
| `completedAt` | the session's `endedAt` — it describes work already done |
| `note` | empty |
| `planId` | via `ensurePlan(dayKey)`, creating the plan if that day has none |

Sessions shorter than 60 seconds are discarded entirely, mis-taps included.

### 2.3 One block per session, per day touched

Each stop writes its own block; three runs of the same task produce three blocks. A
session crossing the 04:00 day start splits, one block per day it touches — 03:30–04:30
becomes 30 minutes at the end of one plan and 30 at the start of the next.

The 60-second floor and the split interact, and need a second rule between them: the floor
applies to the session as a whole, but a session comfortably over it can still leave a
sliver on one side of the boundary. 03:59:50–04:01:00 is 70 seconds and survives the
floor, then splits into 10 seconds and 60. Any slice rounding to zero minutes is dropped,
so that one writes a single 1-minute block rather than a 1-minute block and an empty one.

### 2.4 Manual time is not logged

`addManualSeconds` records an amount with no `startedAt`/`endedAt`. There is no instant to
place a block at, so it writes nothing. Same for quantity entries and skips.

### 2.5 Overlap is now an expected state

A logged block may land on top of a planned one. Both must remain visible and separately
tappable (§5.3).

## 3. Stack and infrastructure

No new dependencies, no new services, no schema migration.

- **TypeScript 5.9 / React 19 / Vite 7**, tested with **Vitest 3** + Testing Library, as
  the rest of the app.
- **Persistence unchanged**: IndexedDB locally, Supabase Postgres for sync.
- **No Supabase migration is needed.** `supabase/schema.sql` provisions every table
  identically — `id`, `user_id`, `updated_at`, `deleted_at`, `data jsonb`. A new field on
  `Task` lives inside `data` and reaches other devices with no DDL. The constraint this
  imposes is the usual one: the database cannot enforce anything about the new field, so
  its default and validity are the TypeScript layer's problem alone.
- **Sync semantics unchanged**: last-write-wins per row on `updatedAt`, blocks are
  ordinary `Syncable` rows and travel like any other.

## 4. Data model

One added field. `Block` is untouched.

```ts
export interface Task extends Syncable {
  // ...existing fields
  /**
   * Stopping a timer on this task drops a completed block onto that day's plan.
   * Absent on tasks created before the flag existed, which reads as false.
   */
  logToPlan: boolean
}
```

A logged block is an ordinary `Block`. Nothing marks it as machine-written, which is a
deliberate choice (§9, #1) with one consequence worth stating plainly: **the write is
fire-and-forget**. Delete the block and nothing regenerates it; edit its time and nothing
corrects it back. There is no link from block to entry, so the two drift independently
after creation, and that is the intended behaviour rather than a gap.

## 5. Hard parts

### 5.1 There are two places a session ends, not one

`stopTimer` is the obvious one. But `startTimer` also ends sessions, at `store.ts:240`,
where it stops any already-running session for the same owner by persisting `endedAt`
directly rather than calling `stopTimer`. Hooking only `stopTimer` means a task restarted
without being stopped logs nothing, which is exactly the double-tap case a user hits by
accident and then cannot explain.

Both paths must funnel through one private `finishEntry(entry, at)` that sets `endedAt`
and does the logging. This is also the only place `openRead` and to-do completion reach
the timer, so fixing the choke point covers them for free.

### 5.2 Wall-clock ms is the wrong way to find a day offset

`plannedStartMinute` is *minutes since day start*, and `dayKey.ts` is careful that this is
civil arithmetic: `instantForDayMinute` notes that "minute 360 on a 23-hour day is still
10:00, not 11:00". The inverse does not exist yet and cannot be written as
`(instant - dayStartInstant(dayKey)) / 60000` — on the two DST days a year that is off by
an hour for every session after the transition, silently placing blocks in the wrong slot.

Add the civil inverse next to its twin:

```ts
/** Minutes since the start of `dayKey`, civil — the inverse of instantForDayMinute. */
export function dayMinuteFor(instant: Date | number, dayKey: string, cfg: DayConfig): number
```

Derive it from `zonedParts` and a civil day difference against `parseDayKey(dayKey)`, never
from an ms subtraction. In America/New_York the 02:00 transition falls *inside* a tally day
(04:00 → 04:00), so this is reachable in normal use, not a theoretical edge.

### 5.3 The plan canvas silently drops colliding blocks

This is the largest piece of work, and it is a live bug the moment overlaps become
possible. `Plan.tsx` builds `byStart = new Map<number, Block>()` keyed on the snapped start
minute, then walks slots in order, skipping any marked `covered`. Two blocks starting in
the same 15-minute slot means **the second overwrites the first in the map and never
renders** — no warning, no indication the day holds anything else. A logged block landing
on a planned one would make one of them vanish.

The renderer must become lane-aware: `Map<number, Block[]>`, with blocks that share a slot
drawn as columns within the row, each independently tappable. Slot coverage must account
for every lane rather than the single block that happened to win the map.

### 5.4 Splitting reuses existing code, but needs start offsets

`splitSession` in `src/core/sessionSplit.ts` already divides a session across day
boundaries and returns `{ dayKey, seconds }[]`, bounded against non-advancing boundaries.
It does not report where within each day a slice begins, but that is derivable rather than
a rewrite: the first slice starts at `dayMinuteFor(startedAt, …)`, and every later slice
starts at minute 0 by construction. A timer left running for days produces a slice per day;
cap the write at the first 2 slices and discard the rest, since a three-day block is noise
rather than a record.

## 6. Scope

**v1** — the flag, the write on stop, the boundary split, the civil inverse, lane-aware
rendering, the 60-second floor.

**Later** — a per-task default for new tasks; a "log this too" action on an existing
session in `TaskDetail`; logging manual time by asking for a start time.

**Out of scope** — editing a block writing back to the entry; any link between block and
entry; logging non-timer tasks; a global on/off switch.

## 7. Tasks

### Phase A — the write path, end to end

1. **Add `logToPlan` to `Task` and its default.** Absent reads as `false` in the store's
   normalisation. *Done when:* an existing task loads without the field and typechecks.
2. **Add the toggle to `TaskEditor`**, timer tasks only. Depends on 1.
   *Done when:* flipping it and reopening the editor shows it still on.
3. **`dayMinuteFor` in `src/core/dayKey.ts`**, pure, with tests. Depends on nothing.
   *Done when:* a 14:05 instant on a 25-hour DST day returns the same minute as the
   23-hour case, and round-trips through `instantForDayMinute`.
4. **Funnel both end-of-session paths through `finishEntry`.** Depends on nothing.
   *Done when:* restarting a running task without stopping it still ends the first
   session exactly once, and existing timer tests pass unchanged.
5. **Write one block on stop**, ignoring boundaries and the floor for now. Depends on
   1, 3, 4. *Done when:* a flagged task timed for two minutes appears on today's plan at
   the right time, already ticked.

### Phase B — correctness

6. **Apply the 60-second floor.** Depends on 5. *Done when:* play-then-immediately-stop
   leaves the plan empty.
7. **Split across the day boundary** via `splitSession`, capped at 2 slices. Depends on
   5. *Done when:* an 03:30–04:30 session yields 30 minutes on each of two plans, and the
   second day's plan is created if it did not exist.
8. **Leave manual and non-timer entries alone.** Depends on 5.
   *Done when:* `addManualSeconds` on a flagged task writes no block.
9. **Store-level tests** for the above against a fake clock. Depends on 6, 7, 8.

### Phase C — the canvas

10. **Make `Plan.tsx` lane-aware** — `Map<number, Block[]>`, columns per slot, coverage
    across all lanes. Depends on nothing; ship before 5 reaches daily use.
    *Done when:* two blocks starting in the same slot both render and both open on tap.
11. **Style logged blocks legibly at narrow widths**, two and three to a slot.
    Depends on 10. *Done when:* a three-lane slot is readable at 360px.
12. **UI test**: flagged task, timed, stopped, block visible on the Plan tab.
    Depends on 5, 10.

## 8. Risks and gotchas

1. **Task 10 is a bug fix, not a feature.** Colliding blocks already disappear today if
   two are created in one slot by hand. Shipping the write path before the lane fix will
   look like the new feature is eating blocks.
2. **DST makes minutes ambiguous, not out of range.** An earlier draft of this spec
   warned that a 25-hour day holds 1500 minutes and would overflow `MINUTES_PER_DAY`.
   That is wrong, and `dayMinuteFor`'s tests disprove it: the day is 1500 real minutes
   long but its highest civil index is 1439, because the index is a wall-clock offset
   rather than elapsed time. The 1440 bound is safe. The real consequence is the other
   side of the same coin — on the long day the repeated hour maps *two* instants onto one
   minute, so a session logged at 01:30 cannot be told from one logged an hour later; on
   the short day the skipped hour maps onto no instant at all. Blocks stay in range; they
   just cannot always say which 01:30 they meant.
3. **Two devices, one running timer.** Both stop it independently and each writes its own
   block; last-write-wins deduplicates the entry but not the blocks, leaving a visible
   duplicate. Rare, self-correcting by hand, and the cost of having no entry link.
4. **The plan stops being a plan.** Once a day's canvas fills with logged blocks, the
   morning sketch is buried among them. This is the §1 trade arriving in practice.
5. **Timezone changes rewrite history.** `timeZone` is a setting; changing it moves every
   past block's real-world meaning while `plannedStartMinute` stays put. Already true of
   planned blocks, and no worse here.

## 9. Assumptions and open decisions

| # | Question | Default assumed |
|---|---|---|
| 1 | Logged blocks distinguishable from planned? | No — an ordinary, editable block |
| 2 | Repeat runs in one day | One block per run, never merged |
| 3 | Placement | Real clock time, overlaps allowed |
| 4 | Session crossing 04:00 | Split into one block per day |
| 5 | Arrives ticked off? | Yes, `completedAt` = session end |
| 6 | Minimum worth recording | 60 seconds |
| 7 | Snap start/duration to the 15-min grid? | No — store the truth; editing snaps it |
| 8 | Block title | Task title verbatim, no duration suffix |
| 9 | Setting scope | Per task, default off, timer tasks only |
| 13 | Name of the screen | "Schedule" in the UI; `DayPlan`/`logToPlan` unchanged in code |
| 14 | Flag on a task switched away from timer | Cleared, as `unitLabel` already is |
| 10 | Timer left running for days | Log the first 2 day-slices, discard the rest |
| 15 | A slice under 30s after splitting | Dropped; a block of no minutes is not a record |
| 11 | Deleting a logged block | Nothing regenerates it |
| 12 | Flag on a task with past sessions | Not retroactive; future stops only |
