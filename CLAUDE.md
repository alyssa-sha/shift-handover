@AGENTS.md

# Shift Handover System

A demo shift-log and handover app for 24/7 public-service operations (airport terminal,
hospital ward). Operators record severity-tagged log entries during a shift, close the
shift with a handover, and submit it to a supervisor. The supervisor approves it — which
publishes it and notifies the next shift — or returns it with feedback.

**`requirement.md` is the source of truth for what to build.** It carries the numbered
functional requirements (FR-1 … FR-8), the data model, the RLS policy matrix, and the
milestone order. Read the relevant FR before implementing, and update `requirement.md`
in the same commit if the behaviour it describes changes.

## Commands

```bash
npm run dev         # next dev (Turbopack is the default in Next 16)
npm run build       # next build — must pass before any commit
npm run lint        # eslint (flat config)
npm run typecheck   # tsc --noEmit
npm test            # unit tests
npx vercel          # link / preview deploy
```

## Stack

Next.js 16.3.4 (App Router) · TypeScript strict · Tailwind CSS v4 · Supabase (Auth,
Postgres, RLS, Realtime) · Anthropic Messages API (`claude-sonnet-5`) · Vercel.

## Next.js 16 — read before writing code

This project is on Next.js 16.3.4. Several conventions differ from older App Router code.
Verified against `node_modules/next/dist/docs/`; check there before reaching for a
remembered pattern.

- **`proxy.ts`, not `middleware.ts`.** Middleware was renamed to Proxy in Next 16. The
  file lives at the project root and exports a function named `proxy`. Its runtime is
  Node.js and cannot be configured to `edge`. Config flags were renamed too
  (`skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`).
- **Request APIs are async, with no synchronous fallback.** `await cookies()`,
  `await headers()`, `await draftMode()`, and `await props.params` /
  `await props.searchParams` in pages, layouts and route handlers. Synchronous access was
  removed in 16 and now throws.
- **Typed page props.** Use the generated helpers — `PageProps<'/shifts/[id]'>`,
  `LayoutProps<...>`, `RouteContext<...>` — rather than hand-written prop interfaces. Run
  `npx next typegen` if they are stale.
- **`next lint` is gone.** `next build` no longer lints. Lint is a separate `eslint` run,
  already wired as `npm run lint`, and CI runs it separately.
- **ESLint uses flat config** (`eslint.config.mjs`). Extend the existing `defineConfig`
  array; do not add an `.eslintrc`.
- **`revalidateTag` takes a second `cacheLife` argument.** The single-argument form is
  deprecated and is a TypeScript error.

## Layout

```
app/
  (auth)/login, (auth)/register     public routes
  (app)/page.tsx                    shift calendar — the landing view (FR-4)
  (app)/shifts/[id]/                shift detail: log entries + handover editor
  (app)/review/                     supervisor review queue (FR-7)
  api/handover/draft/route.ts       server-only AI drafting call (FR-6)
lib/
  supabase/client.ts                browser client (Client Components)
  supabase/server.ts                server client (Server Components, Actions, handlers)
  supabase/proxy.ts                 session-refresh helper used by proxy.ts
  types/database.ts                 generated Supabase types
proxy.ts                            session refresh + route protection (root)
supabase/migrations/                SQL migrations — schema and RLS together
supabase/seed.sql                   demo shift slots (run second)
supabase/seed_assignments.sql       rosters registered operators (run after sign-up)
```

## Supabase conventions

- Use `@supabase/ssr`. Three client factories, never mixed: browser, server (reads
  `await cookies()`), and the proxy helper. A Server Component must not import the browser
  client.
- **Anon/publishable key only.** There is no service-role key in this project — not in the
  app, not in CI, not in `.env.local`. Every query runs as the signed-in user and is
  filtered by RLS.
- When a write needs rights the signed-in user does not have — notification fan-out on
  publication being the only case — implement it as a `SECURITY DEFINER` Postgres function
  or trigger with `set search_path = public`, not as a privileged client.
- **Every table gets RLS enabled and policies written in the same migration that creates
  it.** A table without policies is a review failure, not a follow-up ticket.
- Resolve the caller's role through the `auth_role()` helper rather than selecting from
  `profiles` inside a policy on `profiles`, which recurses.
- Prefer Server Actions for mutations and Server Components for reads. Reach for a Route
  Handler only where one is genuinely needed (the AI draft endpoint).

## Security rules

- `.env.local` is git-ignored and must stay that way. `.env.example` is committed with
  placeholder values for `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
  `ANTHROPIC_API_KEY`.
- `ANTHROPIC_API_KEY` is server-only. Never prefix it `NEXT_PUBLIC_`, never import it into
  a Client Component, and never pass it through a props boundary.
- **This application never sends email**, including from tests and seeds — no notification,
  digest or alert mail is built or triggered (`requirement.md` §4, FR-8.6). The one
  exception is not ours: Supabase Auth's own confirmation mail, which it sends on sign-up
  once *Confirm email* is enabled in the project. That toggle is off during development and
  may be switched on for the live demo (FR-1.5); the register flow handles both.
- Render user-authored log and handover content as text. No `dangerouslySetInnerHTML`.
- UI role checks are convenience only. The RLS policy is the actual control, and both must
  exist for every gated action (FR-2.4).

## AI drafting

- Server-side only, in `app/api/handover/draft/route.ts`, using the official
  `@anthropic-ai/sdk`.
- Model `claude-sonnet-5`, a single non-streaming `messages.create` call,
  `max_tokens: 16000`. Summarising one shift's logs does not need an Opus-tier model.
- The prompt receives only the log entries of the one shift being handed over.
- **Weight the draft by severity** (FR-6.8): `critical` entries are incidents — call each
  one out individually near the top, with its time and what happened, and never merge or
  drop one. `warning` entries get a brief line each. `info` entries are condensed into a
  short summary rather than enumerated. The incoming shift should see what matters in the
  first few lines.
- Failure is never fatal: return a clear error and leave the operator's draft untouched.
  The operator can always write the handover by hand.
- `handovers.ai_assisted` records provenance for internal audit. It is **not** rendered in
  the supervisor's review view (FR-6.6) — the operator edits and submits, so the operator
  owns the content.

## Agent harness

Two subagents, used in this order for each milestone in `requirement.md` §10:

**Building agent** — implements one milestone at a time. It reads the relevant FRs, writes
the migration and the code together, commits in small consecutive steps as it goes (see
"Quality gates" below), and runs `lint`, `typecheck`, `test` and `build` locally before
handing off. It does not move to the next milestone on its own.

**Review agent** — runs when a milestone is finished, before the next one starts. It:

1. Re-reads the FRs the milestone claims to satisfy and checks each acceptance criterion.
2. Audits the migration: is RLS enabled on every new table, does every policy have a
   matching UI gate, is there any path that assumes a service-role key.
3. Runs the four quality gates and reports real output, not a summary.
4. Exercises the flow with **synthetic test data only** — seeded users and shifts, fake
   addresses on a domain that cannot receive mail. It never sends an email and never
   touches production data.
5. Reports findings ranked by severity. The building agent fixes them before the next
   milestone begins.

## Quality gates

All four must pass before a commit, and CI (GitHub Actions on push and PR) enforces them:

`npm run lint` · `npm run typecheck` · `npm test` · `npm run build`

Unit tests cover the pure logic, where a bug is silent: the handover state machine
(`draft → submitted → approved | changes_requested`), next-shift resolution for
notification fan-out, severity ordering and formatting, route protection and redirect
resolution, and the AI prompt builder. **RLS is verified manually**, through the
cross-account steps in each milestone's checklist — there is no Docker and so no local
Postgres to test policies against, and pointing an automated suite at the hosted project
would mean CI holding two sets of real credentials for a demo.

**No pre-commit hook is installed for this project** — a deliberate decision. Run the gates
yourself before committing.

Commit messages follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`,
`refactor:`.

**Make small, consecutive commits wherever possible.** Commit each coherent step as soon as
it stands on its own rather than batching a whole milestone into one large commit — the
schema migration, then the data access, then the UI, then the tests. A reviewer should be
able to read the milestone as a sequence of small diffs, and a bad step should be revertable
without taking the rest of the milestone with it. Two rules bound how small: every commit
leaves the tree working with the four gates passing, and a migration ships together with the
code that depends on it.

## Scope guardrails

This is a demo. When a choice presents itself, take the simpler branch. Do not add
attachments, roster management, extra roles, org hierarchy, email or push delivery, or
audit-export features — §4 of `requirement.md` lists these as explicitly out of scope. If
something genuinely needed is missing from the requirements, add it to §12 "Open questions"
and ask, rather than building it speculatively.
