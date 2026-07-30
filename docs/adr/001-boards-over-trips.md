# ADR 001: Boards over Trips

## Status

Accepted

## Context

FinanzApp is evolving from a travel-centric product to a general personal-finance
app. Users need everyday household boards (individual or shared) and travel
boards with split/debt semantics. We already have a `Trip` document and a graph
of participants, invitations, expenses, budgets, and cards keyed by `tripId`.

## Decision

Evolve `Trip` **in place** into `Board` with:

- `type: everyday | travel`
- Existing documents backfilled as `travel`
- MongoDB collection remains `trips` until a later infra rename (`scope:v1`)
- Child documents keep the stored field `tripId` (same ObjectId) while the API
  prefers `boardId` and accepts `tripId` as a temporary alias

### Rules by type

| Capability                             | `everyday`                                 | `travel` |
| -------------------------------------- | ------------------------------------------ | -------- |
| Shared board / invitations             | Yes                                        | Yes      |
| Expenses                               | Yes (common pool)                          | Yes      |
| `paidByParticipantId`                  | Optional (defaults to creator participant) | Required |
| Splits / debts / settle                | No                                         | Yes      |
| Travel budgets (current Budget entity) | No                                         | Yes      |

Monthly category budgets for everyday are a later issue and must not reuse
travel `Budget` semantics.

### API compatibility

- Primary routes: `/api/boards`
- Legacy alias: `/api/trips` (same handlers)
- Responses include both `board`/`boards` and `trip`/`trips` (same payload)
- Nested resources accept `boardId` or `tripId` in body/query/path aliases

## Consequences

- No parallel Board collection; no data copy migration of `_id`s
- Frontend can migrate gradually from `trip` keys to `board` keys
- Feature gates prevent everyday boards from using travel-only flows
- Telegram rewrite and category/payment-method work stay out of this ADR’s scope

## Migration

On application boot, idempotent backfill:

```js
db.trips.updateMany({ type: { $exists: false } }, { $set: { type: 'travel' } });
```

## Type immutability

`type` is set at board creation and **cannot be changed** via `PATCH`. Changing
type after create would leave orphan travel budgets, divisible expenses, or
pending settlements. Owners should create a new board with the desired type.

## Listing travel budgets on everyday boards

`GET` budgets for an `everyday` board returns an empty list (not 403), so legacy
clients and the Telegram bot keep working when the active board is everyday.
Create/update/delete of travel budgets still require `type=travel`.
