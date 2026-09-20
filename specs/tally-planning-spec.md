# Tally — Day Plans & Phased Projects

> Companion to `tally-spec.md`. Two planning modules layered on the same IndexedDB +
> Supabase store. Read the main spec's day-boundary and timer sections first — both
> modules depend on them.

## 1. What it is

The main spec tracks *whether* you did a thing. Neither of these does that. They answer
two different questions:

- **Day plan** — "what is the shape of today?" An ordered timeline of blocks: 4h
  studying, 4h internal projects, 1h admin. Planned up front, then tracked against.
- **Phased project** — "what is the shape of this piece of work?" An ordered list of
  phases with an hour estimate each, progressed over days or weeks.

They are deliberately separate systems. A day plan is horizontal (one day, many
activities). A project is vertical (one body of work, many days). Neither feeds streaks,
for the same reason to-dos don't: streaks measure recurring behavior, and a plan is a
one-off by definition.

## 2. Requirements

### 2.1 Day plan

- One plan per `dayKey`, created fresh. No templates in v1.
- A plan holds ordered **blocks**. A block has a title, a planned start, a planned
  duration, an optional note, and a color.
- Blocks are **self-contained** — a block does not reference a recurring task. "Study"
  as a block and "Deep Work" as a timer task are unrelated objects that happen to share
  a name. This keeps the day plan disposable: deleting a plan can never damage a streak.
- Each block tracks actual time with start/stop, multiple sittings per block, and manual
  entry — the same affordances as a timer task.
- A block shows planned vs. actual and the signed variance (`+35m`, `−1h 10m`).
- **One block runs at a time.** Starting a block stops any other running block. It does
  *not* stop running task timers; those are orthogonal and may overlap a block freely.
- Blocks may be reordered, resized, deleted, and inserted between existing blocks.
- **Repack** action: recompute every planned start from a given block onward so blocks
  sit contiguously with no gap or overlap. This is the operation that makes editing a
  plan tolerable; without it every insert means retyping four start times.
- Gaps between blocks are legal and rendered as unplanned time. Overlaps are legal too,
  rendered with a warning stripe — this is a plan, not a calendar engine with conflict
  resolution.
- A day plan is complete when every block is complete. Completion is cosmetic; nothing
  downstream consumes it.

### 2.2 Phased project

- A **project** has a title, notes, an optional target date, and ordered **phases**.
- A phase has a title, notes, an **estimated hours** value, and a completion timestamp.
- Progress is **weighted by estimate**, not by phase count: a project with a 20h phase
  and a 2h phase is 91% done when the first finishes, not 50%. Count-weighted progress
  bars lie exactly when the work is lumpiest.
- **No gating.** Phase 3 can be completed before phase 2. Order is intent, not a state
  machine; enforcing sequence buys nothing and blocks the common case where you get
  unblocked out of order.
- Current phase, for display purposes, is the first incomplete one.
- A to-do may be attached to a phase. Completing every to-do in a phase does not
  auto-complete the phase — it surfaces a "mark phase done?" affordance.
- Time may be logged against a phase (actual vs. estimate). Schema supports this in v1;
  UI lands in v1.1.
- Archived when complete; kept indefinitely, unlike to-dos.

## 3. Data model additions

All four extend `Syncable` from the main spec — `id`, `updatedAt`, `deletedAt`.

```ts
interface DayPlan extends Syncable {
  dayKey: string            // one plan per dayKey, enforced in app code
  note: string
  createdAt: string
}

interface Block extends Syncable {
  planId: string
  title: string
  plannedStartMinute: number  // minutes since day start, NOT a timestamp
  plannedMinutes: number
  note: string
  colorHex: string
  completedAt: string | null
  sortOrder: number
}

interface Project extends Syncable {
  title: string
  notes: string
  targetDate: string | null
  colorHex: string
  isArchived: boolean
  createdAt: string
}

interface Phase extends Syncable {
  projectId: string
  title: string
  notes: string
  estimatedHours: number
  completedAt: string | null
  sortOrder: number
}
```

No changes to `Entry` — it already carries `{ownerType, ownerId}`, so `'block'` and
`'phase'` are values, not schema. `Todo.phaseId` is already declared in the main spec.
Children hold parent ids; there are no stored back-references to drift out of sync.

**Why `Entry` is reused rather than a new `BlockSession` type.** Session splitting at the
day boundary and the "start timestamp, never accumulate" running-timer rule are the two
places the main spec says the app will break first. Duplicating them for blocks means
two implementations of the bug. One `Entry` type means the existing split function, the
persistent running-timer bar, and manual entry all work on blocks for free.

The remaining cost is small: `isSkip` is meaningless for block and phase entries, and
aggregation queries must filter on `ownerType`. The XOR invariant that would have needed
app-code enforcement and a repair pass under CloudKit is structural here — one owner
pair, one owner.

## 4. Hard parts

**1. Planned times are offsets, never timestamps.** `plannedStartMinute` is minutes
since the user's day start. A DST transition, a flight across timezones, or changing day
start from 04:00 to 05:00 must not corrupt a saved plan. Rendering resolves the offset
against that day's actual start; a 23-hour spring-forward day compresses the tail of the
plan rather than shifting every block into the wrong day. Storing wall-clock timestamps
here is the off-by-one-hour bug the main spec's risk 4 warns about, in a new place.

**2. Orphaned entries.** The owner pair prevents *multiple* owners; it does not prevent
a *dangling* one. A block deleted on the Mac while the phone logs time against it leaves
an entry pointing at a tombstone. Aggregation joins through the owner and drops
unresolvable entries; a maintenance pass surfaces them in Settings rather than deleting
them silently. A dropped hour you can see beats a double-counted hour you can't.

**3. Blocks crossing the day boundary.** A plan starting at 04:00 with 22 hours of
blocks runs past the next day start. Planned overflow is clamped: any block whose
planned start exceeds 1440 minutes is rejected at save. Actual time is not clamped — the
existing session-splitting function handles a block worked from 03:30 to 05:00 exactly
as it handles a task timer, and the block's total counts the whole session even though
it lands in two `dayKey`s. Blocks belong to a plan, not to a day's aggregation.

**4. Repack must be predictable.** Repack from block *n* sets each subsequent planned
start to the previous block's planned end, in `sortOrder`. It never reorders, never
changes durations, and never touches blocks before *n*. Undo-able as a single action.

## 5. Screens

| Screen | Contents |
|---|---|
| **Day plan** | Vertical timeline for today, planned vs. actual per block, tap to start/stop, drag to reorder, repack button, running block pinned. Date picker to view or build another day. |
| **Block editor** | Title, planned start, duration, color, note. Duration as a stepper in 15-min increments. |
| **Projects** | List with weighted progress bar, current phase, target date. |
| **Project detail** | Phase list with estimate and actual, attached to-dos, add/reorder/complete phases. |

Narrow viewports: Day plan is a fourth bottom tab alongside Today, To-dos and Projects.
Wide viewports: both are sidebar items in the main spec's two-column layout. The
persistent running bar shows the running block if there is one, alongside any running
task timers.

## 6. Scope

**v1** — day plan with blocks, start/stop and manual entry, planned vs. actual, repack,
reorder; projects with phases, estimates, weighted progress, to-do attachment.

**v1.1** — duplicate a previous day's plan (the cheap 80% of templates); per-phase time
logging UI; day adherence stat (matched minutes ÷ planned minutes); block reminders at
planned start, subject to the main spec's risk 3.

**Later** — named reusable templates ("standard work day"); auto-advance to the next
block on stop; a block that *does* link to a timer task, if the separation turns out to
be annoying rather than clarifying.

**Out of scope** — calendar import or two-way sync, conflict resolution against real
events, shared projects, Gantt views, dependencies between phases.

## 7. Tasks

### Phase A — Day plan vertical slice

1. **Extend the schema.** Add the `dayPlans`, `blocks`, `projects` and `phases` object
   stores behind an IndexedDB version bump, plus the matching Supabase tables with RLS
   policies. *Done when:* an existing store with real task data opens without loss, and
   the new tables round-trip through sync to a second device.
2. **Entry owner resolution.** One `entriesFor(ownerType, ownerId)` accessor and one
   `createEntry(owner, ...)` factory. Depends on 1. *Done when:* nothing in the app
   reads `Entry.ownerId` without an `ownerType` beside it, and a unit test covers
   entries whose owner no longer exists.
3. **Day plan read model.** Pure functions over plain objects: resolve
   `plannedStartMinute` to wall-clock times for a given day, compute per-block actual
   from entries, compute variance. Depends on 1. *Done when:* tested against a
   spring-forward and a fall-back day, plus a day-start change from 04:00 to 05:00.
4. **Day plan screen, read-only.** Depends on 3. *Done when:* a seeded plan renders as
   a timeline with planned times and zero actuals.
5. **Block start/stop.** Reuse the running-timer path. Depends on 2, 4. *Done when:*
   starting a second block stops the first, actual time survives a tab close, and a
   running task timer is unaffected.
6. **Block create, edit, delete, reorder.** Depends on 4. *Done when:* a plan can be
   built from empty in the browser with no seeded data.
7. **Repack.** Depends on 6. *Done when:* inserting a 30-min block at position 2 of
   five and repacking shifts exactly blocks 3–5, and one undo reverts it.
8. **Manual time entry on a block.** Depends on 5. *Done when:* a 45-min entry can be
   added and edited after the fact and the variance updates.

### Phase B — Projects

9. **Project and Phase wiring.** Depends on 1. *Done when:* both round-trip through
   IndexedDB and sync.
10. **Weighted progress function.** Pure, depends on 9. *Done when:* a 20h + 2h project
    reports 91% with the first phase complete, and a project with all-zero estimates
    falls back to count-weighting instead of dividing by zero.
11. **Projects list and detail.** Depends on 10. *Done when:* a project can be created,
    phases added, reordered, and completed out of order.
12. **To-do attachment.** Depends on 11. *Done when:* a to-do can be attached to a
    phase, appears in project detail, and completing the last one offers to close the
    phase without doing it automatically.

### Phase C — Fit and finish

13. **Boundary and overflow handling.** Depends on 3, 5. *Done when:* a block worked
    03:30–05:00 shows 90 min on the block, contributes 30/60 to the two `dayKey`s, and
    a block planned past 1440 minutes is rejected with a visible reason.
14. **Two-device sync loop.** Depends on 5, 11. *Done when:* editing the same block on
    two devices offline and reconnecting converges to the later `updatedAt` with no
    duplicate entries, and orphaned entries are listed rather than lost.
15. **Wide-viewport navigation.** Depends on 5. *Done when:* both modules are reachable
    from the sidebar and the running bar shows the running block.

## 8. Risks and gotchas

1. **Schema versioning is no longer trivial.** The main spec's risk 5 said to set up
   versioned upgrades while the schema was simple. This is that moment. Do task 1 before
   anything else, against a store that has real data in it.
2. **Two systems that look alike.** A block and a timer task render almost identically
   and behave differently. Expect to reach for the wrong one; if it happens repeatedly
   after two weeks of use, that's the signal to allow the optional link, not before.
3. **The plan becomes homework.** A day plan you build every morning is a chore by day
   four. The v1.1 duplicate-yesterday action is what makes this survive; if daily
   planning stops happening before it ships, pull it forward.
4. **Estimates rot.** Per-phase estimates entered once and never revised make progress
   meaningless. Show actual next to estimate as soon as phase time logging exists.
5. **Orphaned entries accumulate quietly.** Task 2's owner resolution and task 14's
   listing are the whole defense; don't defer them.

## 9. Assumptions and open decisions

| # | Question | Default assumed |
|---|---|---|
| 1 | Blocks track time themselves, or start a task timer? | **Self-contained**, per your answer |
| 2 | Reusable day templates? | **No** in v1; duplicate-a-day in v1.1 |
| 3 | Per-phase data | **Estimated hours**, per your answer; target dates only on the project |
| 4 | Do blocks or phases affect streaks? | No — same reasoning as to-dos |
| 5 | Multiple running blocks? | No, one at a time; task timers unaffected |
| 6 | Sequential phase gating? | No gating, complete in any order |
| 7 | Progress weighting | By estimated hours, falling back to count |
| 8 | Overlapping blocks | Allowed, flagged visually |
| 9 | Time logging storage | Reuse `Entry` via `{ownerType, ownerId}` |
| 10 | Plans for past or future dates | Any date; editing history is allowed |
| 11 | Block granularity | 15-minute increments in the editor |
| 12 | Deleting a plan | Soft-deletes its blocks and their entries in one pass |
