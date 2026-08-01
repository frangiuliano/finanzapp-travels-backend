# Issue Workflow — FinanzApp Travels Backend

Este proyecto sigue el estándar definido en
`ai-software-company/standards/issue-workflow.md`.

## Extensiones de este proyecto

- **Scope activo:** `scope:mvp` agrupa el rediseño a tableros (Board) y finanzas cotidianas; `scope:v1` para post-MVP (offline, export, rename infra).
- **Tipos usados:** `type:foundation` para dominio/DB/migración, `type:feature` para API de producto, `type:chore` para tooling.
- **Repo pareja:** Issues de UI viven en `frangiuliano/finanzapp-travels-frontend`. Referenciar dependencias cross-repo en el body (URL o `frontend#N`).
- **Decisión de dominio acordada:** evolucionar `Trip` → `Board` con `type: everyday | travel` (no entidad Board paralela).

## GLOBAL_BACKLOG (multi-repo) — obligatorio para `/dev siguiente`

- **Canónico:** `.github/GLOBAL_BACKLOG.md` (este repo).
- Al elegir el próximo issue, el Developer debe usar el algoritmo
  **A) Producto multi-repo** de `issue-workflow.md` y la tabla `G-NN` de ese
  archivo (puede indicar un issue del **frontend**).
- El `order-NN` local sigue siendo útil dentro del repo; el orden **entre**
  repos lo define `G-NN`.

## Notas

- El número de issue en GitHub no coincide necesariamente con el orden de
  ejecución. Usar `G-NN` (global) o `order-NN` (local).
- El Developer Agent debe leer este archivo antes de elegir el próximo issue.
- **CI:** `.github/workflows/ci.yml` corre en PRs a `main` y push a `issue-*`
  (lint, test, build). El Reviewer debe verificar checks verdes antes de aprobar.
