# Home: bounded database reads and concurrent synchronization

## Context

Production timing logs showed a monthly forecast taking 11.67 seconds, with
10.72 seconds spent ensuring recurring and installment occurrences. Home,
Insights and Goals could perform that synchronization concurrently. Recurring
generation checked each occurrence separately; Goals read each month's forecast
sequentially and the priority widget calculated capacity a second time.

## Decision

- Share in-flight synchronization within a process, keyed by board and user.
  Each caller still passes authorization. Completed results are not cached.
  A larger requested horizon waits for smaller work, then ensures its own range.
- Read recurring versions, occurrence keys and participants in batches. Retain
  lazy compatibility for legacy rules through indexed upserts, without counting
  versions individually. Insert only missing occurrences with `$setOnInsert`.
  Preserve skipped/rescheduled occurrences by reading keys regardless of date.
- For installments, read participants and existing keys once, perform one bulk
  write for missing installments and one due-status update for the board.
- Read financial data for a forecast range once and group by month in memory.
  Reuse the financial summary calculation, including travel attribution,
  refunds and separate currencies. Reuse capacity in the priority widget.
- Add authenticated `/expenses/recent` and `/incomes/recent` endpoints, limited
  to five documents each. Filter personal travel shares before limiting.
  Expense lists populate only categories; editing fetches full details.
- Home uses independent React Query requests and a 30-second in-memory cache
  scoped by user, board and month. Financial mutations invalidate inactive Home
  cache too. Goal changes invalidate the Home widget. No financial response is
  cached in the service worker or persisted by this change.

This follows Single Responsibility (SOLID): synchronization remains in its
domain services, calculations in financial services, and display/cache state in
the client. No new cache server, worker, queue or dependency is required.

## Deployment and verification

Deploy backend before frontend: the client requires the new recent endpoints.
No environment changes or document migration is needed. The additive expense
index `{tripId: 1, paymentYearMonth: 1, createdAt: -1, _id: -1}` supports recent
lists. Ensure this index exists in production if automatic index creation is
disabled; do not run `syncIndexes()` to remove existing indexes.

Run backend lint, Jest and build; frontend lint, Vitest and production build.
Regression tests cover overlapping horizons, authorization, unchanged existing
occurrences, batch query counts, month boundaries, refunds, travel shares,
currency separation, progressive loading and cache invalidation.

After deployment, compare multiple warm Home reloads using the same board/month.
Record endpoint timings, forecast sync/compute timings, and time until movements
become visible. Verify a new expense/income refreshes totals and goals, and that
editing a recent expense retrieves its full details. Production speedup must be
measured after deployment; unit query counts are not a latency benchmark.

## Limits

Coalescing is process-local, not a distributed lock. Unique occurrence indexes
and upserts still protect against duplicate documents. Mongo latency, pool wait,
machine resource limits and index availability still require runtime monitoring.
