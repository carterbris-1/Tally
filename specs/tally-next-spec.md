# Tally — Next Round Spec

> Third companion to `tally-spec.md` and `tally-planning-spec.md`. Three diagnosed bugs,
> then weekly goals, a stats screen, and a daily reading feed. Same React + TypeScript PWA,
> same no-backend constraint: anything fetched at runtime must be CORS-enabled.

## 1. What it is

Two weeks of use produced a short list: three small bugs that make daily use worse, and
three features the original spec deferred. One of those — weekly goals — collides with a
scheduling variant that was specced but never built. The daily read is the only genuinely
new idea, and it is a feed, not a tracker: it answers "what should I read today", not "did
I read today". Keeping those apart is the same call made for to-dos and day plans.

## 2. Requirements

### 2.1 Bug — the clear-completed button

Two faults in `src/ui/Todos.tsx`, not one. Its visibility condition is `open.length > 0`:
it renders on **open** to-dos while acting on **completed** ones, so it vanishes exactly
when useful — everything done, nothing open, no button. And `purgeCompletedTodos()` only
tombstones to-dos completed over `settings.todoRetentionDays` (30) days ago, so nothing
finished this month qualifies and the click does nothing, silently.

The 30-day rule is right as an **automatic** policy and wrong as a **button**. Split them:
retention keeps running on load; the button becomes "Clear N completed", shows a live
count, hides at zero, and clears everything completed regardless of age.

### 2.2 Bug — mobile layout

The modal sheet renders its action row underneath the fixed tab bar on iPhone. Two causes:
`.sheet` uses `max-height: 88vh`, and on mobile Safari `vh` is the **large** viewport — the
height with the URL bar collapsed — so it claims space that is not on screen; and the scrim
bottom-aligns the sheet, putting its last 60-odd pixels behind the tab bar and its
safe-area inset. Separately, the To-dos header (`3 open`) clips at 390px wide.

No interactive control may sit under the tab bar or outside the safe area; sheet actions
stay reachable without scrolling at 667px tall; headers fit at 360px.

### 2.3 Bug — no favicon

`index.html` declares `apple-touch-icon` (which is why the home screen works) and a
manifest, but no `<link rel="icon">` and no `favicon.ico`, so browser tabs have nothing to
draw. The PNGs already exist in `public/`.

### 2.4 Week trackers

A goal is currently evaluated per day. Add a **weekly goal period** — "10h of deep work
this week", "read on 5 days this week". Direction is unchanged but applies to the week's
total. Weeks start on
`settings.weekStartDay`, built from `dayKey`s, never date math. A weekly task's streak
counts **consecutive weeks**; Today's row shows week-to-date progress and days remaining.
**This subsumes `Schedule.timesPerWeek(n)`** — specced, never implemented, currently
reporting every day as scheduled. See §5.2.

### 2.5 Stats

Already v1.1 in `tally-spec.md` §9. Per task and across tasks: week / month / all-time
totals; completion rate over a chosen window plus the **count of complete days** — "read
14 times this month" is the number actually wanted; current and longest streak surfaced
outside task detail; and a time-of-day histogram for timer tasks, bucketed by session
**start** hour.

### 2.6 Daily read

One essay, article or research paper per day.

- **Source:** fetched fresh, never curated. Verified CORS-enabled APIs only —
  `hn.algolia.com` for essays and articles, OpenAlex and Crossref for papers. **arXiv was
  specced and dropped: it serves curl happily but sends no `Access-Control-Allow-Origin`,
  so a browser blocks it.** Semantic Scholar rate-limits anonymous callers.
- **Selection:** rotate the kind (essay → article → paper) so consecutive days differ in
  shape; within a kind weight by topic interest; never repeat within 90 days; respect a
  minutes budget.
- **Not a habit.** No streak, no heatmap, neutral like to-dos — consistent with
  `tally-spec.md` decisions #4 and #8. It may link to a timer task the way a to-do does,
  so opening the piece starts a "Read" timer.
- Each day's pick is **decided once and stored**, so both devices agree and it does not
  change on reopen. Per item: open, finish, skip (redraws), save.

## 3. Stack and infrastructure

Restated, because every item above has to fit inside it:

- **React 19 + TypeScript 5.9, Vite 7**, static files on **GitHub Pages** at
  `https://carterbris-1.github.io/Tally/`. No server, no compute.
- **Supabase free tier** for sync: one jsonb table per collection, RLS on `auth.uid()`.
  **IndexedDB** is what the UI reads; sync is background last-write-wins on `updatedAt`.
- `src/core/` is **pure functions only** — no React, no IndexedDB, no Supabase imports.
  That is what the 98 existing tests cover, and where everything hard below belongs.
- All mutations go through the single `TallyStore`: soft deletes, client-generated uuids,
  `updatedAt` on every write. Timezone pinned to `America/New_York`, day starts 04:00.

**New runtime dependencies: none** — the three APIs are plain `fetch` against endpoints
verified to send `Access-Control-Allow-Origin`, each behind an adapter with a timeout.

**Migration cost.** `Task.goalPeriod` and the `Settings` additions are *fields* — rows are
stored whole, so old ones read back with the field absent and default. The daily read needs
a **collection**: the four-edit runbook in `PLAYBOOK.md` §3 — `types.ts`, `idb.ts` (STORES
+ `DB_VERSION` bump + index), `sync.ts` (TABLES), `supabase/schema.sql`.

## 4. Data model

```ts
// fields on existing types (migration-free)
interface Task {
  goalPeriod: 'day' | 'week'   // default 'day'; goalValue is then a weekly total
}

interface Settings {
  readTopics: Record<string, number>  // "philosophy" -> weight 0..3, 0 = never
  readMinutesMax: number              // length budget, default 30
  readLinkedTaskId: string | null     // opening the piece starts this timer
}

// new collection
type ReadKind = 'essay' | 'article' | 'paper'

interface DailyRead extends Syncable {
  dayKey: string            // one row per day; uniqueness enforced in app code
  kind: ReadKind
  title: string
  author: string
  url: string
  topic: string
  minutes: number           // estimated reading time
  year: number | null
  source: 'hn' | 'arxiv' | 'openalex'
  sourceId: string          // stable; what the 90-day window dedupes on
  openedAt: string | null   // finishedAt / skippedAt / savedAt follow the same shape
  finishedAt: string | null
  skippedAt: string | null
  savedAt: string | null
  createdAt: string
}
```

Nothing is bundled. Only the *choice* is stored, one row per `dayKey`, including days not
yet reached (§5.4). `Schedule.timesPerWeek` is **removed** from the union.

## 5. Hard parts

### 5.1 Week keys, and the week that is not seven days

A week needs the same treatment a day got. **`weekKey` is the `dayKey` of the week's first
day** — `"2026-09-07"`, not `"2026-W37"`. ISO week numbers assume Monday starts the week;
`weekStartDay` is configurable, so ISO would be wrong for anyone on Sunday and wrong at
year boundaries for everyone.

Two consequences to handle rather than discover. A week containing a DST transition is 167
or 169 real hours, which falls out free **provided** weekly aggregation sums `dayKey`
buckets and never subtracts timestamps. And changing `weekStartDay` **retroactively
re-partitions history** — weekly streaks are recomputed, never cached, and the setting warns.

### 5.2 `timesPerWeek` and weekly goals are the same feature wearing two hats

`Schedule.timesPerWeek(3)` claims to mean "any 3 days this week", is implemented as
"scheduled every day", and is not that. A weekly `atLeast 3` counting complete days is.

**Resolution: delete `timesPerWeek` from `Schedule`.** A schedule answers which days are
an opportunity; a goal answers how much. Keeping both means two mechanisms that can
disagree — a `timesPerWeek(3)` task with a daily `atLeast 30m` goal has no coherent
meaning, and nothing would stop you creating one. Existing tasks migrate on read to
`{ type: 'daily' }` with `goalPeriod: 'week'`.

### 5.3 The daily pick must be decided once

If selection runs at render you get a different article each time you open the app, and a
different one on each device — both worse than a bad pick. The pick is computed **once per
`dayKey`**, written as a `DailyRead` row, and synced: render today's row if it exists,
otherwise choose, write, sync. Two devices offline the same morning each choose;
last-write-wins resolves it and the loser's pick is replaced, since nothing is lost but a
suggestion. Selection is a **pure function** over `(live, recentSourceIds, topics, budget,
dayKey)`, seeded by `dayKey` so it is deterministic and testable.

### 5.4 With no corpus, the buffer is the floor

Three external APIs, no backend, a phone on a train. With nothing bundled to fall back to,
the app **works ahead**: whenever online it fills the next three days' picks as
`DailyRead` rows, so waking up offline reads a row chosen days ago. Rotation and the
90-day dedupe must consider **buffered** rows as well as past ones, or three days fetched
in one pass collide with each other.

Each adapter gets a 4-second timeout and returns `[]` on failure. If every source fails
and the buffer is dry the card says so and retries on reconnect — a fabricated pick is
worse than an honest gap, and only a fresh install that has never been online gets there.

### 5.5 Stats over a growing entry set

`computeStreaks` walks from a task's creation to today; stats multiply that by task count
and window, per render, while a one-second ticker runs. Rollups memoise on
`(entries, dayKey)` rather than `now` — a running timer changes today's total, not last
month's.

## 6. Scope

**This round:** all three bugs; the weekly goal period with weekly streaks; the stats
screen; the daily read with all three live adapters and a three-day buffer.

**Later:** saved-for-later as its own screen; per-topic reading stats; notifications for the
daily pick; a "why this?" on each selection; Pocket/Instapaper import; a small seed list if
the APIs prove unreliable.
**Out of scope:** in-app reading or full-text extraction (links open in the browser),
recommendations learned beyond topic weights, sharing, any source needing a CORS proxy.

## 7. Tasks

### Phase A — Bugs
1. **Favicon.** Add `<link rel="icon">` entries pointing at the existing PNGs, plus a
   32×32 generated for tab crispness. *Done when:* a hard-reloaded tab on Safari and
   Chrome shows the ring icon, and the home-screen icon is unchanged.
2. **Sheet on small viewports.** `dvh` instead of `vh`; scrim above the tab bar; sheet
   actions in a sticky footer inside the sheet. *Done when:* on a 390×667 viewport the
   To-dos editor's Save button is fully visible and tappable without scrolling, and the
   tab bar is dimmed by the scrim rather than sitting over it.
3. **Header and small-screen polish.** Depends on 2. *Done when:* every screen header
   renders without clipping at 360px wide.
4. **Clear-completed.** Automatic 30-day purge stays on load; the button clears all
   completed and shows its count. *Done when:* with 3 completed and 0 open to-dos it
   reads "Clear 3 completed", is visible, and empties the section; at 0 it is absent.

### Phase B — Week trackers
5. **Week keys, pure.** `weekKeyFor(dayKey, weekStartDay)`, `daysInWeek`, `weekRange`.
   *Done when:* unit tested across a year boundary, both `weekStartDay` values, and a
   week containing each DST transition.
6. **Weekly evaluation.** `goalPeriod` on `Task`; `evaluateWeek` mirroring `evaluateDay`,
   including `atMost` staying unresolved until the week closes. Depends on 5.
   *Done when:* a 10h weekly target reports complete at 10h and not at 9h59m, and a
   weekly limit is never complete mid-week but fails immediately when exceeded.
7. **Weekly streaks.** Consecutive weeks, neutral weeks skipped. Depends on 6.
   *Done when:* a missed week breaks the streak, and an all-skipped week does not.
8. **Retire `timesPerWeek`.** Remove from the union, migrate on read. Depends on 6.
   *Done when:* a stored task with `timesPerWeek(3)` loads as a daily schedule with a
   weekly `atLeast 3` goal, and the type no longer exists.
9. **Weekly UI.** Period toggle in the editor; week-to-date progress and days left on the
   Today row. Depends on 7. *Done when:* a weekly task created on-device shows
   "6h 30m of 10h · 3 days left".

### Phase C — Stats
10. **Rollup functions, pure.** Totals by week and month, completion counts, completion
    rate, time-of-day buckets. Depends on 5. *Done when:* "complete days this month"
    matches a hand-counted heatmap for a seeded task.
11. **Stats screen.** Depends on 10. *Done when:* it renders per-task rows for a chosen
    window with no visible lag while a timer runs.
12. **Time-of-day histogram.** Depends on 10. *Done when:* a session started at 21:30 lands
    in the 21:00 bucket, and one crossing 04:00 lands only in its start hour.

### Phase D — Daily read
13. **Live adapters.** HN Algolia, OpenAlex and Crossref behind one `Candidate[]` interface,
    each with a 4s timeout returning `[]` on failure. *Done when:* each returns normalised
    candidates from the real API, and a blocked network yields `[]`, not a thrown error.
14. **Selection, pure.** Kind rotation, topic weighting, 90-day dedupe against past and
    buffered picks, seeded by `dayKey`. Depends on 13. *Done when:* the same inputs always
    return the same item, and something read 89 days ago cannot be chosen.
15. **`DailyRead` collection.** The four-edit runbook plus store methods. Depends on 14.
    *Done when:* today's pick persists across reload and reaches a second device.
16. **Daily read card.** Today screen, with open / finished / skip / save. Depends on 15.
    *Done when:* skipping draws a different item and records the skip.
17. **Three-day buffer.** Fill forward whenever online; honest empty state when it is dry.
    Depends on 15. *Done when:* after one online visit, disabling the network still yields a
    pick for the next three days, and a fresh profile offline shows that, not an error.
18. **Reading settings.** Topic weights, minutes budget, linked timer task. Depends on 16.
    *Done when:* setting a topic weight to 0 excludes it from selection.

## 8. Risks and gotchas

1. **`timesPerWeek` removal is a schema change in disguise.** It is a stored `Schedule`
   variant, so the read-time migration in task 8 must ship with or before the union
   change — never after, or stored tasks fail to parse.
2. **Live API shape drift.** None guarantees a stable response or unlimited anonymous use.
   Treat every field as optional and every source as removable.
3. **No corpus means no floor.** Every pick depends on a third party staying reachable and
   generous. The buffer hides brief outages, not a source that closes — the fallback then
   is the seed list this round skipped. arXiv already proved the risk is not theoretical.
4. **Weekly `atMost` is a long silence.** A weekly limit spends up to six days unresolved,
   which reads as nothing happening. Show week-to-date consumption prominently or the
   mode feels broken.
5. **Changing `weekStartDay` rewrites history** — weekly streaks move. Warn at the setting.
6. **Stats is the first screen that can be slow**, and easiest to memoise wrongly: keying
   on `now` defeats the cache, keying on nothing serves stale numbers.

## 9. Assumptions and open decisions

| # | Question | Default / answer |
|---|---|---|
| 1 | Where does the daily piece come from? | **Answered:** live only — HN Algolia, OpenAlex, Crossref. No curated corpus (arXiv sends no CORS header) |
| 2 | How is the daily piece chosen? | **Answered:** rotate kind, weight by topic, no repeat in 90 days, minutes budget |
| 3 | Does the daily read feed a streak? | **Answered:** no — neutral like to-dos; may link a timer task |
| 4 | What does "sight image" mean? | **Answered:** the missing browser-tab favicon |
| 5 | Week key format | The `dayKey` of the week's first day, not an ISO week number |
| 6 | Do `timesPerWeek` and weekly goals coexist? | No — `timesPerWeek` is deleted and migrated |
| 7 | Weekly streak unit | Consecutive weeks; a neutral week is skipped, not a break |
| 8 | Can a task have both a daily and a weekly goal? | No — one period per task |
| 9 | What covers an offline day? | A three-day buffer of picks, filled whenever online |
| 10 | Every source fails and the buffer is dry | Say so plainly and retry on reconnect — never fabricate a pick |
| 11 | Two devices choosing offline on the same day | Last-write-wins; the losing pick is replaced |
| 12 | Time-of-day bucket for a long session | Its start hour only |
| 13 | Stats default window | This month; week and all-time toggles |
| 14 | In-app reader? | No — links open in the browser |
| 15 | Does clearing completed to-dos delete or tombstone? | Tombstone, like every other delete |
