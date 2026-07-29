# Issue Workflow — FinanzApp Travels Backend

Este proyecto sigue el estándar definido en
`ai-software-company/standards/issue-workflow.md`.

## Extensiones de este proyecto

- **Scope activo:** `scope:mvp` agrupa el rediseño a tableros (Board) y finanzas cotidianas; `scope:v1` para post-MVP (offline, export, rename infra).
- **Tipos usados:** `type:foundation` para dominio/DB/migración, `type:feature` para API de producto, `type:chore` para tooling.
- **Repo pareja:** Issues de UI viven en `frangiuliano/finanzapp-travels-frontend`. Referenciar dependencias cross-repo en el body (URL o `frontend#N`).
- **Decisión de dominio acordada:** evolucionar `Trip` → `Board` con `type: everyday | travel` (no entidad Board paralela).

## Notas

- El número de issue en GitHub no coincide necesariamente con el orden de
  ejecución. Usar el label `order-NN` para saber qué tomar primero.
- El Developer Agent debe leer este archivo antes de elegir el próximo issue.
