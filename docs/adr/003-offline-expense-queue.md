# ADR 003: Offline expense queue and idempotency

## Status

Accepted

## Context

Users capture expenses on mobile PWA where connectivity is intermittent. The MVP
ships synchronous `POST /expenses` only. Post-MVP (v1) we need:

- Queue expense creates client-side when offline or on transient network failure
- Sync when connectivity returns without duplicating rows in MongoDB
- Predictable conflict behaviour for retries

## Decision

### Client queue (frontend)

- Persist pending creates in **IndexedDB** (`finanzapp-offline` / `expense-queue`)
- Each enqueue generates a **UUID v4** (`clientRequestId`) before any network call
- On submit: try online POST; on offline / network error → enqueue locally and
  show success toast (“se sincronizará al volver la conexión”)
- `online` event + app mount trigger FIFO sync (stop on first hard failure to
  preserve order)
- Only **create** is queued; updates/deletes remain online-only (out of scope)

### Idempotency (backend)

- `CreateExpenseDto.clientRequestId` (optional UUID v4) and HTTP header
  `Idempotency-Key` (alias; body wins if both sent)
- Store `clientRequestId` on `Expense` with unique partial index
  `{ createdBy, clientRequestId }`
- `ExpensesService.create`: if key exists for user → return existing expense
  (no second budget increment)
- Concurrent duplicate inserts catch MongoDB `E11000` and return existing row

### FX and budgets on replay

- Idempotent replay returns the **original** persisted expense (FX snapshot from
  first successful write). Retries must not recalculate FX or touch budget twice.

## Conflict policy (basic)

| Scenario                           | Behaviour                                                   |
| ---------------------------------- | ----------------------------------------------------------- |
| Same `clientRequestId` retried     | Return existing expense (200 semantics via 201 + same body) |
| Different payload, same key        | Rejected by unique index + first-write-wins on replay       |
| Board/category deleted before sync | Sync fails with 4xx; item stays in queue with `lastError`   |
| Auth expired during sync           | Refresh flow runs; if still 401, item remains queued        |

Full bidirectional sync / CRDT is explicitly out of scope.

## Consequences

- **Positive:** Safe offline capture; no duplicate expenses on flaky networks
- **Negative:** Queued items may fail permanently if server state changed; user
  must retry manually after fixing data
- **Ops:** No migration for legacy rows (`clientRequestId` optional / sparse index)

## References

- Global backlog G-21 / backend issue #12
- Frontend: `src/services/offlineExpenseQueue.ts`,
  `src/services/createExpenseWithOffline.ts`
