# To do

A running list of what's next. Tick items off when they're done, add new ones as they come up, and remove finished ones once they're no longer useful as a record. Plans hold the detail; this list says what to work on and in what order.

Each item is marked with who does it under the [AI use policy](../AGENTS.md): **person** for core logic (data model, business logic, API behaviour, auth, migrations), **agent** for setup, config, CI, tests and docs (a person can always do these too).

## Now

- [x] **Better Auth additional fields** (person). See [Personal and managed accounts](plans/db-structure.md#personal-and-managed-accounts) and [Deleted organizations](plans/audit-log.md#deleted-organizations).
  - [x] `organizations`: `accountType` (personal or managed), `deletedAt`, `deletedBy`, `purgeAfter`
  - [x] `users`: `managedByOrganizationId`, referencing `organizations` with `ON DELETE RESTRICT`
  - [x] `disableOrganizationDeletion: true` on the organization plugin
  - [x] Regenerate `auth-schema.ts` (keep the time-zone timestamps and lint formatting) and generate a migration
- [x] **Finish the schema** (person), following the [database plan](plans/db-structure.md). `audit_events` waits for the audit work below.
  - [x] `template_steps`, `template_fields`, `template_access`
  - [x] `schedules`
  - [x] `runs`, `run_steps`
  - [x] `template_steps`: separate assignee columns with `ON DELETE SET NULL`, `assignee_type` (member, team, role)
  - [x] `run_steps`: add `assignee_type`, matching `template_steps`
  - [x] `run_field_values`, `step_notes`
  - [x] `approval_requests`, `approval_decisions`: drop the approver columns and `run_id`, make `run_step_id` unique (one request per step)
  - [x] `notifications` and `notification_deliveries`, following [Notifications](plans/db-structure.md#7-notifications): typed payload, subject, dedupe key; add `schedule_skipped` to `notificationTypes`, the `NotificationPayload` union to `packages/shared`, and the `ndel` prefix to `typeid.ts`
  - [x] Replace migrations `0000`–`0009` with one baseline migration (the old ones fail on a fresh database), reset the dev database and apply it
- [x] Remove the unused `auditChains` prefix from `src/apps/api/src/util/typeid.ts` (person)

## Next: core app

Getting the template-to-run loop working end to end, with personal organizations only at first. Each sub-item should be roughly one pull request.

UI screens are written by a person under the [AI use policy](../AGENTS.md); agents may only set up the app shell and other UI boilerplate.

**Keep audit easy to add later:** do each write in a single database transaction, passed down to wherever the change happens, so `recordAudit` can be added inside it without restructuring.

### Foundations

- [x] Logging: winston logger in `core/logger.ts`, readable by default and JSON with `LOG_FORMAT=json`, with `LOG_LEVEL` (agent)
- [x] Request logging: one `http`-level line per API request (method, path, status, duration) (agent)
- [x] Email sending: SMTP config through environment variables, a mail catcher (for example Mailpit) in `docker-compose.yaml` for development, and one `sendEmail` helper (person)
- [x] API structure: a router per area under `/api`, the typed `route()` helper validating with Zod schemas from `packages/shared`, the error format with an error handler, and a not-found handler; see [API and auth](implementation-notes.md#api-and-auth) (agent)
- [x] Session middleware: read the Better Auth session on every API request and expose the user and active organization to handlers (person)
- [x] Development seed: `pnpm db:seed` creates sign-in accounts and an organization through Better Auth (agent)
- [x] The permission function: one place that answers "can this user do this in this organization", from the member's role and `template_access`, in `core/permissions.ts` (person)
- [ ] **Shared API contracts:** request schemas (Zod) and response types (plain TypeScript, `Dto` suffix) in the shared package's `api` entry point, filled by mappers in the API
  - [x] Restructure `packages/shared` into the `api`, `domain`, `auth` and `utils` entry points: split `enums.ts` and the area files between `api/` and `domain/`, switch to subpath exports with no root entry, update every import and the tsdown `alwaysBundle` pattern (agent, behaviour-neutral refactor)
  - [x] Move the TypeID prefixes to `utils/typeid.ts`; the API's generators import them (agent, behaviour-neutral refactor)
  - [x] Row types for Checklog's tables in `util/types.ts`, with plain names like the existing `Organization`, and the `mappers/` convention, recorded in the implementation notes (agent)
  - [x] `typeIdSchema` in shared (person)
  - [x] `paginationQuerySchema`, `Paginated<T>` with `total`, and the API cursor and count helpers (person)
  - [ ] Request schemas and response types per area, added as each area is built, replacing the `never` placeholders and filling the mapper skeletons in `src/mappers/` (person)

### Time zones

- [ ] Add Luxon to the catalog and the API (and the web app for display) (agent)
- [x] Migration: `runs.timezone` text, and `template_steps.due_offset` from `interval` to `text` (person)
- [ ] `util/time.ts`: `addOffset`, `todayIn`, and rrule date conversion with `keepLocalTime` (person)
- [ ] Tests for `util/time.ts` with the DST fixtures in the plan's Luxon table (agent, reviewed by a person)
- [ ] `X-Timezone` header in `useApi()`, and its parsing and validation in `route()` (person)
- [ ] Date and time formatting helper in the web app (person)
- [ ] Validate zones with Luxon's `IANAZone.isValidZone` and store their canonical names, replacing the `Intl` check in `timezoneSchema` (person)
- [ ] Move the schedule calculations onto Luxon (person)

### Web app

- [x] App shell: layout, navigation and organization switcher with Nuxt UI, Better Auth client, shared TanStack Query fetch helper with SSR hydration (agent)
- [ ] Sign-up, sign-in, sign-out and password reset pages using Better Auth's endpoints (person)
- [ ] Create a personal organization after sign-up, and the empty state when a user has none (person)
- [ ] Members: list, invite by email, change role, remove; accept-invitation page (person)
- [ ] Groups: create, rename, delete, add and remove members (person)

### Templates

One pull request per item:

- [x] API: create (with an empty version 1 draft), list, get, rename, archive and restore templates; a duplicate active name is `validation_failed` on `name`, archiving archives the template's schedules, and archiving or restoring a template already in that state is `conflict` (person)
- [x] API: edit the draft's steps (add, reorder, edit, remove) through `requireDraft`; title, instructions, kind, halt, skippable, assignee and due offset, with the step rules from the plan (person)
- [x] API: `GET` and `POST /templates/:templateId/draft` return the draft with its steps and their fields (person)
- [x] API: `POST /templates/:templateId/draft` starts editing through `ensureDraft`, which copies the current version into a new draft, and is the only route that creates one; edits to a template with no draft are `conflict`, so the editor's step IDs are always the draft's (person)
- [x] API: edit a step's fields (add, reorder, edit, remove) with labels, keys, help text, required and options; approval steps can have fields (person)
  - `POST /templates/:templateId/draft/steps/:stepId/fields` adds a field
  - `PUT /templates/:templateId/draft/steps/:stepId/fields/order` reorders the step's fields
  - `PATCH /templates/:templateId/draft/steps/:stepId/fields/:fieldId` edits a field
  - `DELETE /templates/:templateId/draft/steps/:stepId/fields/:fieldId` removes a field
- [x] API: `updatedAt` edit-conflict check on step and field `PATCH`es, refusing a stale edit with `conflict` (person)
  - `PATCH /templates/:templateId/draft/steps/:stepId`
  - `PATCH /templates/:templateId/draft/steps/:stepId/fields/:fieldId`
- [x] `precondition_failed` error code, with details pointing at steps, for the publish and start checks (person)
- [x] API: publish the draft with the publish checks, discard a draft, list versions, get one version, and archive a version (person)
  - `POST /templates/:templateId/draft/publish` publishes the draft and makes it the current version
  - `DELETE /templates/:templateId/draft` discards the draft
  - `GET /templates/:templateId/versions` lists versions
  - `GET /templates/:templateId/versions/:versionId` returns one version with its steps and fields
  - `POST /templates/:templateId/versions/:versionId/archive` archives a version
- [x] API: template access, granting groups and people view, run or edit; can land any time after templates (person)
  - `GET /templates/:templateId/access` lists the template's grants
  - `PUT /templates/:templateId/access` grants a member or group a level, or changes the level of their existing grant
  - `DELETE /templates/:templateId/access/:accessId` revokes a grant
- [ ] UI: template list, template editor (steps and fields), publish, versions and access settings (person)
- [ ] Later: `search` on name in `GET /templates`, an optional `ilike` filter that escapes `%` and `_` (person)

### Runs

- [ ] API: `startRun` from a template's current version, creating its run steps with resolved assignees and due dates from `addOffset`; `runs.timezone` from the schedule, or from `X-Timezone` for an ad hoc run (person)
- [ ] API: run start check, refused with `precondition_failed`: the template is active with a current version that isn't archived, no missing assignees (`assignee_type` set but its column null), and assigned members and groups still belong to the organization (person). See [Missing assignees](plans/db-structure.md#missing-assignees).
- [ ] Run step permission check `canActOnStep` in `core/permissions.ts`: the step's assignee (member, group or role), or anyone with `run` on the template when the step is unassigned (person)
- [ ] API: list runs (mine, my groups', all, plus status) and get one run with its steps, fields, values, notes and a computed `blocked`; anyone with `view` on the template or assigned a step sees the whole run (person)
- [ ] Shared `validateFieldValue(options, value)` in `domain/fields.ts`, used by the API and the web app (person)
- [ ] API: set field values by key and complete a step, enforcing required fields, halt steps and `allowFuture` (date fields against `todayIn` the user's zone) (person)
- [ ] API: skip a skippable step with a reason (person)
- [ ] API: add notes to a step (person)
- [ ] API: reassign a step, cancel a run, and complete the run when every step is resolved; completed and cancelled runs refuse step actions with `conflict` (person)
- [ ] UI: run list with the start column, run page with steps, fields, notes, skip and complete; the start time in the run's zone, due dates with the run's zone alongside when it differs, and times rendered on the client only (person)

### Approvals

- [ ] API: create an approval request when an approval step is reached, as an upsert on `run_step_id`; the approver is the step's current assignee (person)
- [ ] API: approve or reject, with a comment required on rejection; the request's status follows the latest decision, a rejection keeps the step open and an approval resolves it (person)
- [ ] UI: "awaiting my approval" list and the approve or reject dialog (person)

### Schedules

- [ ] API: create, edit, pause and resume a schedule (RRULE and time zone) for a template, and calculate `next_run_at` (person)
- [ ] Job: pg-boss recurring job that starts due runs and advances `next_run_at`; a run that fails the start check is skipped and the people who can edit the template are notified (person)
- [ ] UI: schedule settings on a template (person)

### Notifications

- [ ] One `notify` function: inserts the notification with its dedupe key and creates its deliveries only if the insert happened (person)
- [ ] Sending job: one pg-boss job per delivery, queued in the transaction that creates it; records `attempts`, `last_attempt_at` and `last_error`, sets `sent` or, after the last retry, `failed` (person)
- [ ] Assignment emails when a step is assigned to someone or their group (person)
- [ ] Overdue job: flags overdue steps and emails assignees once, using the `overdue:<run step ID>` dedupe key (person)
- [ ] Approval-needed emails to approvers (person)
- [ ] Skipped-schedule notification to the people who can edit the template (person)
- [ ] UI: notification inbox with unread state, and overdue badges on runs and steps (person)

### Checking it works

- [ ] API tests for each area against a real Postgres (Testcontainers; see [Tests](implementation-notes.md#tests)), starting with the permission functions (agent, reviewed by a person)
- [x] Unit tests for the shared package's domain rules, assignee mapping, field options, schedule recurrence and TypeID schemas (agent, reviewed by a person)
- [ ] One end-to-end test of the whole loop: sign up, create a template, publish, start a run, complete it (agent, reviewed by a person)

## Then: accounts and organizations

- [ ] Organization types: managed-organization sign-up, same-type membership hooks (person). See [Personal and managed accounts](plans/db-structure.md#personal-and-managed-accounts).
- [ ] Soft delete: delete and restore endpoints, the checks that hide deleted organizations, the block screen, the sign-in block for deleted managed organizations, and the purge job (person). See [Deleted organizations](plans/audit-log.md#deleted-organizations).
- [ ] **Account deletion** (person), following [Deleted accounts](plans/operators-and-account-deletion.md#deleted-accounts):
  - [ ] `users`: `deletedAt`, `deletedBy`, `purgeAfter` through `additionalFields`, and `DELETED_ACCOUNT_GRACE_DAYS`
  - [ ] `before` hook refusing `deleteUser` and `removeUser`
  - [ ] Personal account delete and restore endpoints, with a preflight check, the last owner rule, and deleting and restoring sole-member organizations
  - [ ] Managed account delete and restore endpoints for owners, and the deleted members list
  - [ ] Sign-in hook and block screen for deleted personal accounts; refuse deleted managed accounts
  - [ ] Hide deleted accounts from member lists and pickers
  - [ ] Account purge in the nightly job, deleting the account's user events

## Then: audit log

Following the [audit log plan](plans/audit-log.md):

- [ ] `audit_events` table, with the append-only trigger (custom SQL in the migration); `user_id` as a plain column, an `impersonated_by` column, and the trigger's purge rule for users (person)
- [ ] `recordAudit` with per-action payload schemas (person)
- [x] Better Auth: turn on adapter transactions and test whether hooks share them (they don't; see the [atomicity decision](plans/audit-log.md#better-auth))
- [ ] Better Auth: record audit events from the `after` hooks (person)
- [ ] Record events across everything built so far: organization, run, user and platform events; field value changes record the user's zone (person)
- [ ] Context expiry job, and audit events in the purge job (person)
- [ ] **Operators** (person unless marked), following the [operators plan](plans/operators-and-account-deletion.md):
  - [x] Access controller with `platform-admin` in `@checklog/shared`; `admin()` and `adminClient()`; schema migration
  - [ ] `before` hooks refusing `set-role`, `remove-user`, `create-user`, `update-user`, `set-user-password` and direct `impersonate-user`
  - [ ] Grant script for `platform-admin` (or `create-admin`, if it uses `generateId`) and a platform admin in the development seed
  - [ ] Impersonation endpoint with a justification, `impersonated_by` in `recordAudit`, start and stop events; confirm the `ctx.request` check first ([open question](plans/operators-and-account-deletion.md#open-questions))
  - [ ] Impersonation limits: the Better Auth `before` hook and an `impersonation` option on `route()`
  - [ ] `operator.*` events for bans and session revokes
  - [x] Page option and middleware for platform admin pages (agent)
  - [ ] Platform admin screens and the platform audit view

## Before the first production deployment

- [ ] Split the app and owner database roles, and add `MIGRATION_DATABASE_URL` (person, with an agent for the compose, `.env` and Kubernetes config)
- [x] Publish Docker images from CI: `main` and `sha-<commit>` tags on GHCR, for amd64 and arm64 (agent)
- [ ] Kubernetes manifests: API, worker, web, migrate Job, probes (agent)
- [ ] Register domains and the `checklog-app` GitHub organization (person; deferred until the MVP, see [decisions](decisions.md))

## Housekeeping

- [x] ESLint: require reasons on disable comments, and enforce import order and `import type` (agent)
- [ ] Push local commits to `origin/main` (5 commits ahead when this list was started)
