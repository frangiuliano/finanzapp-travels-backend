# ADR 002: Branding rename Travels → FinanzApp (infra y bot)

## Status

Accepted (2026-08-01)

## Context

The product evolved from a travel-expense app ("FinanzApp Travels") to a general
personal-finance app centered on **boards** (`everyday` and `travel`). The MVP
backend and frontend already use "FinanzApp" in user-facing copy, emails, and bot
messages, but infrastructure identifiers still carry the legacy name:

| Layer             | Current identifier                                        | Notes                                   |
| ----------------- | --------------------------------------------------------- | --------------------------------------- |
| Fly.io app        | `finanzapp-travels-backend`                               | `fly.toml`, default webhook URL in code |
| GitHub repos      | `finanzapp-travels-backend`, `finanzapp-travels-frontend` | Out of scope for this ADR               |
| Telegram bot      | Legacy username (e.g. `@…TravelsBot`)                     | Single `TELEGRAM_BOT_TOKEN` per deploy  |
| PWA manifest (FE) | `name: "FinanzApp Travels"`                               | Addressed in frontend issue #10         |
| CORS              | `FRONTEND_URL` secret on Fly                              | Must include production SPA origin      |

DevOps recommended **not** renaming the Fly app name early: it implies DNS,
certificates, webhook URLs, and secret rotation with little user-visible benefit
while the public URL can stay stable.

## Decision

### 1. Fly.io app name — keep for v1 rename

- **Keep** `finanzapp-travels-backend` as the Fly app name for the first branding
  rollout.
- Set `WEBHOOK_URL` explicitly in Fly secrets so the default hardcoded host in
  `TelegramClientService` is not relied upon in production.
- Revisit Fly rename (or a new app + cutover) only when:
  - a new public API hostname is required, or
  - the legacy name causes operational confusion for the team.

### 2. Telegram bot — new bot, phased cutover

- Register a **new** bot via BotFather with FinanzApp branding (username, name,
  description, `/setabout`, `/setuserpic`).
- Deploy the new `TELEGRAM_BOT_TOKEN` to staging first, then production.
- **Do not** commit tokens; store only in Fly secrets / CI secret store.
- Retire the legacy bot after a documented grace period (see
  `docs/branding-rename-checklist.md`).

### 3. CORS and frontend URL

- Production `FRONTEND_URL` must match the deployed SPA origin (scheme + host,
  no trailing slash). The API allows localhost origins in development
  (`src/main.ts`).
- When the frontend hostname changes, update the Fly secret **before** switching
  DNS to the new SPA.

### 4. Coordination with frontend

- Backend checklist (this repo, issue #11) covers secrets, webhook, CORS, and bot
  migration.
- Frontend issue #10 covers UI strings, `index.html`, and PWA manifest
  `name` / `short_name`.
- Deploy order: staging bot + API secrets → FE staging → validate link flow →
  production bot token swap → FE production → legacy bot deprecation messages.

## Consequences

- Operators follow `docs/branding-rename-checklist.md` for rollout; no product
  code changes are required in this ADR beyond documentation and `.env.example`
  comments.
- Users may see "Travels" in the PWA install name until frontend #10 ships; API
  and emails already say FinanzApp.
- Legacy Telegram users must re-link only if chat IDs differ between bots;
  linking is per `telegramUserId` on the User document — migrating to a new bot
  does not invalidate existing links as long as the same backend DB is used.

## References

- `docs/branding-rename-checklist.md` — operational checklist
- `.env.example` — required secrets and comments
- `fly.toml` — current Fly app name
- Frontend: `frangiuliano/finanzapp-travels-frontend` issue #10
