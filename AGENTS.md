# FinanzApp Backend — Codex instructions

## Product and workspace

This repository is the FinanzApp NestJS API. The product manages everyday
personal finances and shared travel boards. The agreed domain evolution is
`Trip` to `Board`, with `type: everyday | travel`; do not create a parallel
Board model unless an issue explicitly changes that decision.

- Companion repository: `../finanzapp-travels-frontend`.
- Team framework (local workspace): `../../ai-software-company`.
- Product workflow and canonical multi-repo backlog:
  `.github/ISSUE_WORKFLOW.md` and `.github/GLOBAL_BACKLOG.md`.

If the local team framework is available, use its role prompts and standards;
do not copy or modify them while working on a product issue. If it is absent,
continue using this file and the repository's `.github` documentation.

## Role shortcuts

Interpret these user requests as workflow intents, even though they are not
native Codex slash commands:

- `/dev siguiente` or `/dev <issue>`: Developer workflow.
- `/rev <PR>` or `revisá el PR <PR>`: Reviewer workflow.
- `/po`, `/arch`, and `/ops`: consult the matching role prompt in the team
  framework before responding.

## Developer workflow

1. For `siguiente`, select the first eligible `G-NN` item in the canonical
   global backlog. Respect closed issues, open dependencies, and
   `status:in-progress`; the selected issue may belong to the frontend repo.
2. Read the complete GitHub issue, its acceptance criteria, dependencies,
   scope, and out-of-scope section before changing files. Set
   `status:in-progress` only after selection succeeds.
3. Rename the current Codex task to `#<number> — <issue title>` with the
   available task-title tool. If that tool is unavailable, report exactly
   `Task: #<number> — <issue title>` so the user can rename it manually.
4. Work in the repository named by the backlog item. Use branch
   `issue-<number>-<short-english-slug>`, conventional commits, the existing
   PR template, and `Closes #<number>` in the PR body.
5. Do not widen scope, merge PRs, or mix issues in a PR. Ask when an issue is
   materially ambiguous.
6. Before push, run `npm run lint`, `npm run test`, and `npm run build`.
   CI runs the same checks on PRs and `issue-*` branches. This repository does
   not currently define `verify:lockfile`; do not invoke or invent it.
7. At completion, provide a concise implementation summary, PR URL/number,
   issue closure, and reproducible local test steps.

## Reviewer workflow

Review the linked issue, complete PR body, branch diff, and CI status before
giving a verdict. Check every acceptance criterion, scope, architecture,
security, test coverage, database/migration impact, and conventional commits.
Do not implement fixes.

For a deep review, explicitly use parallel reviewers for (1) bugs/edge cases
and test gaps and (2) security risks, then consolidate their findings. Publish
the complete verdict as a GitHub PR comment when GitHub access is available.
Never recommend merge while CI is failing.

## Code Review Rules

- Preserve the agreed `Trip` to `Board` migration and `everyday | travel`
  domain invariant.
- Validate authorization and tenant/board ownership for all user-controlled
  identifiers and mutations.
- Never log or commit secrets, access tokens, personally identifiable finance
  data, or production database credentials.
- Changes to persistence models must include a safe migration strategy and
  tests for critical business rules.
