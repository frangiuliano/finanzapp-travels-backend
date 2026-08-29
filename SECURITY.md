# Seguridad — FinanzApp Backend

Este documento es el checklist vivo para mantener el nivel de seguridad alcanzado tras la remediación de agosto 2026. No es un registro histórico de auditorías (eso vive fuera del repo, en los documentos de planificación del workspace) — es una lista de qué revisar y cuándo, y qué reglas seguir al escribir código nuevo.

## Reportar un problema de seguridad

Proyecto personal de un solo mantenedor. Si encontrás algo, avisale directamente al dueño del repositorio antes de abrir un issue público.

## Dónde viven los secretos

- Variables de entorno reales sólo en `.env` (nunca versionado) y en los secrets de Fly.io (`fly secrets set`).
- `src/config/env.validation.ts` es la fuente de verdad de qué variables son obligatorias y su formato — si agregás una variable de entorno nueva que el código necesita para funcionar, agregala también ahí. Si no lo hacés, una config incompleta puede fallar en producción de forma silenciosa en vez de no arrancar.
- Rotar `JWT_SECRET` / `JWT_REFRESH_SECRET` invalida todas las sesiones activas (todos los usuarios tienen que volver a loguearse) — coordinar el timing.
- Rotar `TELEGRAM_WEBHOOK_SECRET` requiere actualizar también la config del webhook en Telegram (`configureWebhook()` la reconfigura solo al reiniciar el proceso).

## Checklist de mantenimiento recurrente

**Cada vez que aparece un PR de Dependabot:** revisarlo y mergearlo si CI pasa. No dejarlos acumular — cuanto más viejo, más grande y arriesgado el salto de versión.

**Mensual:**

- Correr `npm audit --omit=dev --audit-level=high` a mano como doble chequeo (además del gate de CI).
- Revisar si se agregó algún endpoint nuevo con `@Public()` desde la última revisión — confirmar que cada uno realmente necesita estar sin autenticación.
- Revisar los logs de producción en busca de patrones de abuso (muchos 401 seguidos desde un mismo origen, reintentos de refresh anómalos).

**Trimestral:**

- Rotar `JWT_SECRET`, `JWT_REFRESH_SECRET` y `TELEGRAM_WEBHOOK_SECRET`.
- Revisar la lista de orígenes permitidos en CORS (`main.ts`) — sacar los que ya no correspondan.
- Revisar si el cost factor de bcrypt (`user.schema.ts`, hoy 10) sigue siendo razonable para el hardware de ataque actual.

## Reglas al escribir código nuevo

Antes de mergear cualquier cambio que toque estas áreas, confirmá:

- **Nuevo recurso o endpoint que devuelve/modifica datos de un usuario:** verificá pertenencia (ownership) contra el usuario autenticado antes de exponer o mutar — nunca confíes en un `userId` que venga del body/query, siempre `@GetUser()`.
- **Nuevo `@Param()` que representa un ObjectId de Mongo:** ya está cubierto automáticamente por el pipe global si el nombre del parámetro está en la allowlist de `src/common/pipes/parse-mongo-id.pipe.ts` — si usás un nombre de parámetro nuevo (no `id`, `boardId`, `tripId`, etc.), agregalo a esa allowlist.
- **Nueva variable de entorno:** agregala al esquema de `env.validation.ts`, no sólo a `.env.example`.
- **Nueva llamada HTTP a un servicio externo:** usá `externalRequestSignal()` (`src/common/utils/external-request.util.ts`) para el timeout, no un `fetch()` desnudo.
- **Nuevo log de error o de una respuesta de una integración externa:** usá `toSafeErrorMessage()` (`src/common/utils/log-redaction.util.ts`) — nunca loguees el objeto `error`/`response` completo. Si el log incluye un email, usá `maskEmail()`. Nunca loguees un token, ni siquiera un fragmento.
- **Nuevo endpoint sensible (login, registro, reset de contraseña, cualquier cosa que un bot podría abusar):** aplicá `@Throttle()`.
- **Nueva dependencia de producción:** revisá que no tenga vulnerabilidades conocidas antes de agregarla (`npm audit` la va a atrapar en CI, pero mejor no mergear algo que ya sabés que va a fallar el gate).

## Decisiones ya tomadas (no las reviertas sin una razón nueva)

- `bcrypt.genSalt(10)`: valor deliberado, no subirlo a 12 sin medir el impacto en latencia de login/registro bajo carga real.
- Cookie de refresh con `SameSite=Lax` y `Path=/api/auth`: asume que el frontend llega al backend a través de un proxy same-origin (ver `vercel.json` del frontend). Si el frontend alguna vez deja de usar ese proxy, revisar si `SameSite=Lax` sigue siendo suficiente.
- El registro y el reenvío de verificación de email responden con el mismo mensaje exista o no la cuenta, para no permitir enumeración de usuarios.
