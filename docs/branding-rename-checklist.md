# Checklist: rename Travels → FinanzApp (DevOps / backend)

Operational checklist for issue **#11**. Pair with frontend issue **#10** (UI/PWA
manifest) and ADR `docs/adr/002-branding-rename-infra.md`.

**Rule:** never commit real tokens, API keys, or production URLs with secrets.

---

## 1. Decisions (sign-off before changes)

| Item                        | Recommendation                                                       | Owner            | Done |
| --------------------------- | -------------------------------------------------------------------- | ---------------- | ---- |
| Fly app name                | **Keep** `finanzapp-travels-backend` for v1 (see ADR 002)            | DevOps           | ☐    |
| New Telegram bot username   | Register via BotFather (e.g. `@FinanzAppBot` — confirm availability) | Product + DevOps | ☐    |
| Production SPA URL          | Confirm canonical `https://…` for `FRONTEND_URL`                     | DevOps           | ☐    |
| Grace period for legacy bot | Suggest **90 days** after new bot is live                            | Product          | ☐    |
| Coordinate FE deploy        | FE #10 merged before or with bot go-live                             | Dev              | ☐    |

---

## 2. New Telegram bot (BotFather)

| Step | Action                                                                     | Done |
| ---- | -------------------------------------------------------------------------- | ---- |
| 2.1  | `/newbot` → name **FinanzApp**, username without "Travels"                 | ☐    |
| 2.2  | `/setdescription` — everyday + travel boards, link from web app            | ☐    |
| 2.3  | `/setabout` — short tagline + link to web                                  | ☐    |
| 2.4  | `/setuserpic` — FinanzApp icon (match PWA, FE #10)                         | ☐    |
| 2.5  | `/setcommands` — align with bot handlers (`/start`, `/board`, `/reset`, …) | ☐    |
| 2.6  | Save token in password manager; **do not** commit to git                   | ☐    |

Suggested `/setcommands` (adjust to match shipped handlers):

```
start - Vincular cuenta o ver ayuda
board - Ver o cambiar tablero activo
reset - Cancelar conversación en curso
```

---

## 3. Fly.io secrets (staging → production)

Apply on the `finanzapp-travels-backend` app (or staging app if split).

```bash
# Staging example — replace placeholders
fly secrets set \
  TELEGRAM_BOT_TOKEN="<new-bot-token>" \
  WEBHOOK_URL="https://<api-host>/api/bot/webhook" \
  FRONTEND_URL="https://<spa-host>" \
  -a finanzapp-travels-backend
```

| Secret                              | Purpose                                      | Done |
| ----------------------------------- | -------------------------------------------- | ---- |
| `TELEGRAM_BOT_TOKEN`                | New FinanzApp bot token                      | ☐    |
| `WEBHOOK_URL`                       | Full HTTPS URL to `POST /api/bot/webhook`    | ☐    |
| `FRONTEND_URL`                      | Production SPA origin for CORS + email links | ☐    |
| `APP_NAME`                          | Optional; defaults to `FinanzApp` in emails  | ☐    |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | Unchanged unless rotating                    | ☐    |
| `MONGODB_URI`                       | Unchanged                                    | ☐    |
| `FX_API_KEY`, `GROQ_API_KEY`, SMTP  | Unchanged unless rotating                    | ☐    |

After deploy, verify logs show `✅ Webhook configurado: <WEBHOOK_URL>`.

Local dev: copy `.env.example` → `.env` and set the same variable names (use a
**test** bot token, not production).

---

## 4. CORS validation

| Check                | How                                                                                                | Done |
| -------------------- | -------------------------------------------------------------------------------------------------- | ---- |
| SPA origin allowed   | Browser login from production URL; no CORS error on `/api/auth/*`                                  | ☐    |
| Credentials          | Cookies / `withCredentials` work for authenticated routes                                          | ☐    |
| New preview hostname | If using Vercel preview, add origin to `FRONTEND_URL` or extend allowlist in code (separate issue) | ☐    |

Allowed origins are built in `src/main.ts`: localhost ports + `FRONTEND_URL`.

---

## 5. Webhook and health

| Check              | Command / action                                            | Expected                          | Done |
| ------------------ | ----------------------------------------------------------- | --------------------------------- | ---- |
| Health             | `GET https://<api-host>/api/health`                         | 200                               | ☐    |
| Webhook registered | `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"` | `url` matches `WEBHOOK_URL`       | ☐    |
| Link flow          | Web → Cuenta → generate token → `/start <token>` in new bot | User linked, confirmation message | ☐    |
| Expense flow       | Send everyday expense message                               | Expense on active board in API    | ☐    |
| Board switch       | `/board` in Telegram                                        | Lists boards, sets active         | ☐    |

---

## 6. Legacy bot → new bot coexistence plan

### Phase A — Preparation (T-7 days)

| Action                                                                                     | Done |
| ------------------------------------------------------------------------------------------ | ---- |
| New bot created; token in staging only                                                     | ☐    |
| FE #10 on staging (manifest shows **FinanzApp**)                                           | ☐    |
| Update **legacy** bot via BotFather: description mentions migration date + new `@username` | ☐    |
| Optional: pin message on legacy bot channel/group docs with new bot link                   | ☐    |

### Phase B — Go-live (T0)

| Action                                                                | Done |
| --------------------------------------------------------------------- | ---- |
| Deploy backend with **new** `TELEGRAM_BOT_TOKEN` to production        | ☐    |
| Deploy frontend #10 to production                                     | ☐    |
| Smoke tests (section 5) on production                                 | ☐    |
| Announce in-app / email: "Nuevo bot de Telegram" with `@new_username` | ☐    |

### Phase C — Legacy deprecation (T0 → T+90)

The backend serves **one** bot token per environment. The legacy bot cannot use
the new handlers unless its token is still wired to the API. Recommended approach:

1. **Immediately after cutover:** remove webhook from legacy bot so it stops
   processing expenses:

   ```bash
   curl -X POST "https://api.telegram.org/bot<LEGACY_TOKEN>/deleteWebhook"
   ```

2. **BotFather (legacy bot):** set description and about to point users to the new
   bot and the web app. Telegram will show this when users open the old chat.

3. **Optional lightweight deprecation webhook** (if product wants auto-replies):
   deploy a minimal endpoint (separate Fly app or serverless) with **only** the
   legacy token that responds to any message with:

   ```
   ⚠️ Este bot fue reemplazado por FinanzApp.

   Usá el bot nuevo: @<NEW_BOT_USERNAME>
   Vinculá tu cuenta desde la web: Configuración → Bot de Telegram.

   Este chat ya no registra gastos.
   ```

   Do **not** store the legacy token in this repository.

4. **User data:** existing `telegramUserId` links in MongoDB remain valid for the
   new bot (same user IDs). Users only need a new `/start <token>` if they never
   linked on the new bot.

### Phase D — Retirement (T+90)

| Action                                          | Done |
| ----------------------------------------------- | ---- |
| Remove legacy bot deprecation endpoint (if any) | ☐    |
| Revoke / delete legacy bot token in BotFather   | ☐    |
| Remove legacy token from any secret store       | ☐    |
| Archive this checklist with dates filled in     | ☐    |

---

## 7. `.env.example` and documentation

| Item                                                                         | Done |
| ---------------------------------------------------------------------------- | ---- |
| `.env.example` documents `TELEGRAM_BOT_TOKEN`, `WEBHOOK_URL`, `FRONTEND_URL` | ☐    |
| ADR 002 merged (`docs/adr/002-branding-rename-infra.md`)                     | ☐    |
| This checklist merged                                                        | ☐    |
| No secrets in git history for this PR                                        | ☐    |

---

## 8. Out of scope (explicit)

- Renaming GitHub repositories or Fly app (deferred per ADR 002).
- Frontend UI copy / PWA manifest (frontend #10).
- Offline expense queue (backend #12).
- New product features.

---

## Rollback

If the new bot misbehaves after go-live:

1. `fly secrets set TELEGRAM_BOT_TOKEN="<previous-token>"` and redeploy.
2. Re-register webhook for the previous token if it was deleted.
3. Revert FE deploy if manifest/copy changes cause issues.

Document incident date and root cause in this file or a postmortem issue.
