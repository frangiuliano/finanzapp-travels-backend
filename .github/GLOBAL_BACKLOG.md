# FinanzApp — Global backlog (multi-repo)

Fuente de verdad para el **orden de ejecución entre**
`finanzapp-travels-backend` y `finanzapp-travels-frontend`.

El Developer Agent debe usar este archivo cuando `/dev` / `siguiente` corre
en un producto multi-repo (ver `.github/ISSUE_WORKFLOW.md` y
`ai-software-company/standards/issue-workflow.md` § multi-repo).

## Repos

| Clave      | GitHub                                                     | Path local (workspace)       |
| ---------- | ---------------------------------------------------------- | ---------------------------- |
| `backend`  | https://github.com/frangiuliano/finanzapp-travels-backend  | `finanzapp-travels-backend`  |
| `frontend` | https://github.com/frangiuliano/finanzapp-travels-frontend | `finanzapp-travels-frontend` |

**Canónico:** este archivo vive en el backend:
`.github/GLOBAL_BACKLOG.md`.  
El frontend apunta al mismo archivo vía
`../finanzapp-travels-backend/.github/GLOBAL_BACKLOG.md`.

## Cómo elegir la próxima (resumen)

1. Recorrer la tabla por `G-NN` ascendente.
2. Saltar filas cuyo issue de GitHub esté **cerrado**.
3. Saltar si alguna dependencia (`Depends on`) sigue **abierta**.
4. Saltar si ese issue (o otro del mismo `scope` en el **mismo** repo) ya tiene
   `status:in-progress` — un agente, un issue.
5. La primera fila que pase → trabajar en ese **repo** + **issue #**.
6. Anunciar en el chat: `Próxima global: G-NN → <repo>#N — <título>`.

`parallel-ok`: la fila puede implementarse en paralelo con la indicada (otro
agente / otro chat). Un solo `/dev` **no** salta una fila anterior abierta
solo por `parallel-ok`; usá `/dev #N` en el otro repo si querés paralelizar.

## Tabla global

| Global | Repo     | Issue | Título corto                  | Depends on                        | Notes                           |
| ------ | -------- | ----- | ----------------------------- | --------------------------------- | ------------------------------- |
| G-01   | backend  | #2    | Trip → Board + ADR            | —                                 | Fundación dominio               |
| G-02   | frontend | #1    | Design system + shell tablero | —                                 | `parallel-ok: G-01` (mocks OK)  |
| G-03   | backend  | #3    | Categorías + seed             | backend#2                         |                                 |
| G-04   | backend  | #4    | Medios de pago + closingDay   | backend#2                         | Paralelo con G-03 si hay 2 devs |
| G-05   | frontend | #2    | Wizard primer tablero         | backend#2, frontend#1             |                                 |
| G-06   | frontend | #3    | UI categorías / medios        | backend#3, backend#4, frontend#1  |                                 |
| G-07   | backend  | #5    | Expenses por board            | backend#2, #3, #4                 |                                 |
| G-08   | frontend | #4    | Captura rápida                | backend#5, frontend#2, frontend#3 |                                 |
| G-09   | backend  | #6    | Incomes + summary             | backend#5                         |                                 |
| G-10   | backend  | #7    | Presupuestos mensuales        | backend#3, #5                     |                                 |
| G-11   | frontend | #5    | Home incomes / restante       | backend#6, #7, frontend#1         |                                 |
| G-12   | backend  | #8    | Reportes + ciclo TC           | backend#3–#6                      |                                 |
| G-13   | frontend | #6    | Reportes UI                   | backend#8, frontend#1             |                                 |
| G-14   | backend  | #9    | FX snapshot                   | backend#5, #8                     |                                 |
| G-15   | frontend | #7    | Módulo Viajes                 | backend#2, #5, frontend#1, #4     |                                 |
| G-16   | backend  | #10   | Telegram rewrite              | backend#5 (+#2–#4)                |                                 |
| G-17   | frontend | #8    | Cuenta + Telegram copy        | backend#10, frontend#1            |                                 |
| G-18   | frontend | #9    | PWA polish                    | frontend#4                        | `scope:v1`                      |
| G-19   | backend  | #11   | Branding/infra + bot          | backend#10                        | `scope:v1`; coord FE#10         |
| G-20   | frontend | #10   | Branding FinanzApp UI         | MVP everyday usable               | `scope:v1`; coord backend#11    |
| G-21   | backend  | #12   | Offline queue                 | captura BE+FE estable             | `scope:v1`                      |

## Mantenimiento (PO)

Al crear, cerrar o reordenar issues multi-repo:

1. Actualizá esta tabla (`G-NN`, deps, números de GitHub).
2. Mantener consistencia con labels `order-*` y la sección Dependencias de cada issue.
3. No duplicar orden solo en un repo: **esta tabla manda** para `/dev siguiente`.
