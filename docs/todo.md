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
- [ ] The permission function: one place that answers "can this user do this in this organization", from the member's role and `template_access` (person)
- [ ] Shared Zod schemas in `packages/shared` for each area's request and response bodies, added as each area is built (person)

### Web app

- [ ] App shell: layout, navigation and organization switcher with Nuxt UI, Better Auth client, shared TanStack Query fetch helper with SSR hydration (agent)
- [ ] Sign-up, sign-in, sign-out and password reset pages using Better Auth's endpoints (person)
- [ ] Create a personal organization after sign-up, and the empty state when a user has none (person)
- [ ] Members: list, invite by email, change role, remove; accept-invitation page (person)
- [ ] Groups: create, rename, delete, add and remove members (person)

### Templates

- [ ] API: create, list and archive templates (person)
- [ ] API: edit the draft version's steps (add, reorder, edit, remove) with title, instructions, kind, halt, skippable, assignee and due offset (person)
- [ ] API: edit a step's fields (text, date, dropdown, checkbox) with labels, keys, required and dropdown options (person)
- [ ] API: publish the draft (freezes it, sets the current version, opens a new draft on next edit) and archive a version (person)
- [ ] API: template access, granting groups and people view, run or edit (person)
- [ ] UI: template list, template editor (steps and fields), publish, and access settings (person)

### Runs

- [ ] API: start a run from a template's current version, creating its run steps with resolved assignees and due dates (person)
- [ ] API: run start check that refuses a version with a missing assignee (`assignee_type` set but its column null) and says which steps to fix in a new version; also check assigned members and groups belong to the organization (person). See [Missing assignees](plans/db-structure.md#missing-assignees).
- [ ] API: list runs (mine, my groups', all) and get one run with its steps (person)
- [ ] API: set field values and complete a step, enforcing required fields and halt steps (person)
- [ ] API: skip a skippable step with a reason (person)
- [ ] API: add notes to a step (person)
- [ ] API: reassign a step, cancel a run, and complete the run when every step is resolved (person)
- [ ] UI: run list, run page with steps, fields, notes, skip and complete (person)

### Approvals

- [ ] API: create an approval request when an approval step is reached, as an upsert on `run_step_id`; the approver is the step's current assignee (person)
- [ ] API: approve or reject, with a comment required on rejection; the request's status follows the latest decision, a rejection keeps the step open and an approval resolves it (person)
- [ ] UI: "awaiting my approval" list and the approve or reject dialog (person)

### Schedules

- [ ] API: create, edit, pause and resume a schedule (RRULE and time zone) for a template, and calculate `next_run_at` (person)
- [ ] Job: pg-boss recurring job that starts due runs and advances `next_run_at`; a run that fails the start check is skipped and the template's editors are notified (person)
- [ ] UI: schedule settings on a template (person)

### Notifications

- [ ] One `notify` function: inserts the notification with its dedupe key and creates its deliveries only if the insert happened (person)
- [ ] Sending job: one pg-boss job per delivery, queued in the transaction that creates it; records `attempts`, `last_attempt_at` and `last_error`, sets `sent` or, after the last retry, `failed` (person)
- [ ] Assignment emails when a step is assigned to someone or their group (person)
- [ ] Overdue job: flags overdue steps and emails assignees once, using the `overdue:<run step ID>` dedupe key (person)
- [ ] Approval-needed emails to approvers (person)
- [ ] Skipped-schedule notification to the template's editors (person)
- [ ] UI: notification inbox with unread state, and overdue badges on runs and steps (person)

### Checking it works

- [ ] API tests for each area against a real Postgres, run in CI with a Postgres service container (agent, reviewed by a person)
- [ ] One end-to-end test of the whole loop: sign up, create a template, publish, start a run, complete it (agent, reviewed by a person)

## Then: accounts and organizations

- [ ] Organization types: managed-organization sign-up, same-type membership hooks (person). See [Personal and managed accounts](plans/db-structure.md#personal-and-managed-accounts).
- [ ] Soft delete: delete and restore endpoints, the checks that hide deleted organizations, the block screen, the sign-in block for deleted managed organizations, and the purge job (person). See [Deleted organizations](plans/audit-log.md#deleted-organizations).

## Then: audit log

Following the [audit log plan](plans/audit-log.md):

- [ ] `audit_events` table, with the append-only trigger (custom SQL in the migration) (person)
- [ ] `recordAudit` with per-action payload schemas (person)
- [ ] Better Auth: turn on adapter transactions and test whether hooks share them, then wire up the audit hooks (person). Tests can be written by an agent.
- [ ] Record events across everything built so far: organization, run, user and platform events (person)
- [ ] Context expiry job, and audit events in the purge job (person)
- [ ] Reconciliation job, if the transaction test showed it's needed (person)
- [ ] Operators: Better Auth `admin` plugin, platform audit view (person)

## Before the first production deployment

- [ ] Split the app and owner database roles, and add `MIGRATION_DATABASE_URL` (person, with an agent for the compose, `.env` and Kubernetes config)
- [ ] Publish Docker images from CI (agent)
- [ ] Kubernetes manifests: API, worker, web, migrate Job, probes (agent)
- [ ] Register domains and the `checklog-app` GitHub organization (person; deferred until the MVP, see [decisions](decisions.md))

## Housekeeping

- [x] ESLint: require reasons on disable comments, and enforce import order and `import type` (agent)
- [ ] Push local commits to `origin/main` (5 commits ahead when this list was started)
