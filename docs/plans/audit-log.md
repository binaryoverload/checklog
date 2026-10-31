# Plan: audit log

Status: **agreed plan**, ready to be built. This is a plan, not the implementation. Under the [AI use policy](../../AGENTS.md) the audit log is core logic and is written by a person; this doc is the spec for that work.

It expands section 6 of the [database structure plan](db-structure.md): one append-only `audit_events` table, with events written in the same transaction as the change they record.

## What it has to do

1. **Record every change that matters to an auditor**: who did what, to which thing, when, and what changed.
2. **Be append-only.** Nothing in the app can edit or delete an event, and events are kept for as long as their organization exists (decided). There are two exceptions, both handled by jobs under strict rules: `context` is erased after a set period ([Context expiry](#context-expiry)), and an organization that was soft-deleted is purged, audit log included, once its grace period ends ([Deleted organizations](#deleted-organizations)).
3. **Be hard to alter.** The app can only add events, and the database refuses edits and deletes from anyone else (see [Keeping it append-only](#keeping-it-append-only)). That's what comparable products do, and what SOC 2 and ISO 27001 auditors expect. Cryptographic tamper evidence, which would also detect changes made directly in the database, is a [future feature](#future-tamper-evidence), not part of the MVP or v1 (decided).
4. **Never miss an event.** If the change commits, its event commits; if the event can't be written, the change fails.
5. **Be the history.** Field values only store the current value ([decided](db-structure.md#decided)), so the log must hold old and new values.

## Scopes

Every event has a scope, which says whose log it belongs to:

| Scope | Belongs to | Holds |
| --- | --- | --- |
| `organization` | One organization (`organization_id`), and one of its runs when `run_id` is set | Membership, roles, invitations, groups, templates, schedules, and everything that happens in runs |
| `user` | One user (`user_id`) | Sign-ins, sign-outs and account security changes |
| `platform` | The deployment as a whole | Organizations and users being created, changed, deleted, restored and purged, and operators' actions |

- **Sign-ins are user events** because signing in isn't tied to one organization (decided). An organization's audit view shows its current members' sign-ins alongside its own events.
- **Platform events** (decided) are the platform's own record, for operators rather than customers. They overlap with organization events on purpose: `organization.deleted` is recorded in the organization's log and as a platform event. Platform events have no `organization_id`, so they're never purged and keep a record of every organization and managed account after they're gone.

## Table

### `audit_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | TypeID `aevt_…`. Time-ordered, so it's also the sort order for events with the same timestamp. |
| `scope` | text | `organization`, `user` or `platform` |
| `organization_id` | text, null | Set for `organization` scope only |
| `run_id` | text, null | Set for events that happen in a run; `organization_id` is set too |
| `user_id` | text, null | Set for `user` scope only: the user whose log it is |
| `occurred_at` | timestamptz | Defaults to `now()` |
| `actor_type` | text | `user`, `system` (jobs, schedules) or `guest` (v1) |
| `actor_id` | text, null | User ID for `user`; job name for `system` |
| `action` | text | From the [event catalogue](#event-catalogue), e.g. `run_step.completed` |
| `entity_type` | text | e.g. `run_step` |
| `entity_id` | text | The TypeID of the thing acted on |
| `payload` | jsonb | Action-specific details, such as old and new values |
| `context` | jsonb, null | Request details: session ID, IP address, user agent. Erased after a set period; see [Personal data](#personal-data). |

**Foreign keys:** `organization_id` references `organizations`, `run_id` references `runs` and `user_id` references `users`, all with `ON DELETE RESTRICT`. Audit history must never disappear as a side effect: an organization or account can only be hard-deleted once its events have been purged on purpose. In practice organizations are soft-deleted and runs and users are never hard-deleted, so `RESTRICT` acts as a safety net. `entity_id` and `actor_id` stay plain columns, because they point at different tables depending on the type, and platform events must outlive what they describe.

**Indexes:** (`organization_id`, `occurred_at`) for the organization audit view; (`run_id`, `occurred_at`) for a run's timeline; (`user_id`, `occurred_at`) for a user's activity; (`scope`, `occurred_at`) for the platform view; (`entity_type`, `entity_id`) for "history of this thing".

## Writing an event

Everything goes through one function, for example `recordAudit(tx, event)`, which takes the caller's open transaction and inserts one row. No other code inserts into `audit_events`.

- The caller commits. If anything fails, the whole transaction rolls back, so the change and its event either both exist or neither does.
- There's no locking: events are independent rows, so concurrent writes don't wait for each other.
- `recordAudit` validates each event with a Zod schema per action, so every event of a given action carries the payload the [event catalogue](#event-catalogue) requires, and checks the scope rules (for example, `organization` scope must have `organization_id`). A `check()` constraint on the table backs up the scope rules.
- Several events in one transaction (for example starting a run records `run.started` and then one event per step) just call `recordAudit` repeatedly.

## Keeping it append-only

Three layers, each catching what the one before misses:

1. **Code:** only `recordAudit` writes events, only the context expiry job changes them, and only the purge job deletes them.
2. **A trigger** on `audit_events`: `BEFORE TRUNCATE` always raises an exception. `BEFORE UPDATE` and `BEFORE DELETE` raise one too, except for the two jobs' narrowly defined changes (see [Context expiry](#context-expiry) and [Deleted organizations](#deleted-organizations)). This catches mistakes from any role, such as a careless manual query.
3. **Database privileges** (before the first production deployment, decided): the app connects as a role with only `SELECT, INSERT` on `audit_events`. Migrations, the context expiry job and the purge job use a separate owner role, since those jobs are the only things that change or remove events. That means a second connection string, `MIGRATION_DATABASE_URL`, and both roles in the compose file and Kubernetes config. During MVP development a single role plus the trigger is enough.

What none of this stops: someone with superuser access to the database can disable the trigger and edit or delete events, and nothing would show it afterwards. Detecting that is what the [future tamper evidence](#future-tamper-evidence) would add.

## Context expiry

Audit events are kept for as long as their organization exists (decided). Apart from a deleted organization's log, the only thing that expires is `context` (IP address, user agent, session ID), because it's personal data that's only useful for recent investigations.

- A nightly job sets `context` to null on events older than `AUDIT_CONTEXT_RETENTION_DAYS` (deployment-wide, default 90). It also clears a user's `context` early on an erasure request.
- **How the trigger allows it:** the job sets a transaction-local flag (`SET LOCAL checklog.audit_context_expiry = 'on'`). With that flag, the trigger allows an `UPDATE` that changes `context` to null and nothing else. Any other update, any delete and any truncate still fail. Before the role split, any connection could set the flag, so it guards against mistakes rather than attacks; after the split, the app role has no `UPDATE` at all.

## Deleted organizations

Organizations are soft-deleted (decided). Deleting one hides it straight away but keeps all its data, audit log included, for a grace period during which it can be restored. After that, a job hard-deletes it. The grace period is deployment-wide: `DELETED_ORGANIZATION_GRACE_DAYS`, default 90.

**Better Auth setup:**

- `disableOrganizationDeletion: true` turns off Better Auth's own delete endpoint, which hard-deletes.
- `additionalFields` on `organization` adds `deletedAt`, `deletedBy` and `purgeAfter`. Better Auth then includes them in its schema and API responses.

**Deleting**, through a Checklog endpoint (owners only), in one transaction:

1. Set `deleted_at`, `deleted_by` and `purge_after` (deletion time plus the grace period) on the organization.
2. Record `organization.deleted` in the organization's log and as a platform event, with the purge date.
3. Rename the slug to `<slug>--deleted--<organization id>`, so the original slug can be reused straight away. The event's payload keeps the original, so a restore can put it back if it's still free.

Because this is Checklog's own endpoint, the change and its events share a transaction; no hook or reconciliation is needed.

**Restoring** is done by the organization's owners (decided), during the grace period:

- **Who:** anyone who was an owner when it was deleted. Memberships aren't touched by a soft delete, so this is simply the organization's members with the `owner` role.
- **Where:** owners of a deleted personal organization see it in a "Recently deleted" list on their account page, with the purge date. Owners of a deleted managed organization have nothing else in the app, so after signing in they get only a block screen: the organization's name, the purge date, **Restore** and **Sign out**.
- **How:** a Checklog endpoint, checking the same rule, clears the three fields, puts the slug back (or asks for a new one if it's been taken), and records `organization.restored` in the organization's log and as a platform event, with the restoring owner as the actor.
- **Telling the other owners:** deleting an organization emails all its owners, with the purge date and a link to the Recently deleted list. One owner deleting an organization can't go unnoticed by the others, and any of them can undo it.

The Recently deleted list, the block screen and the restore endpoint are the only things allowed past the checks below, and only for owners. Owners get no other access to a deleted organization: they can't view or export its data, change its members or settings, or start runs until it's restored.

**Hiding a deleted organization.** Better Auth's organization plugin doesn't know about `deletedAt`, so every way in has to check it. Each check uses one shared helper, `isOrganizationDeleted`, and each gets a test:

- **Checklog's permission function** refuses any request for a deleted organization. This covers all of Checklog's own API.
- **Better Auth endpoints that act on an organization**, through a `hooks.before` matcher: setting the active organization, getting the full organization, creating, accepting and rejecting invitations, adding, removing and updating members, and all team endpoints. They fail with "organization not found".
- **Listing a user's organizations:** an `after` hook on Better Auth's list endpoint removes deleted organizations from the response.
- **In a managed organization, accounts can't sign in** while it's deleted (decided). The exception is its owners, who can sign in but are limited to the block screen: the API refuses every request from them except fetching their session, restoring the organization and signing out. A `before` hook on Better Auth's sign-in endpoints refuses everyone else with "your organization has been deleted", and their existing sessions are revoked when the organization is deleted; owners' sessions are revoked too, so they come back through the block screen. A refused sign-in is recorded as the user event `user.sign_in_refused`. In a personal organization nobody is blocked from signing in: members just don't see the deleted organization.
- **Sessions whose active organization was deleted** are treated as having no active organization; the web app sends the user to pick another.

**Purging**, by a nightly job, for each organization whose `purge_after` has passed, in one transaction:

1. Set the purge flag (`SET LOCAL checklog.audit_purge = 'on'`).
2. Delete the organization's events (`organization_id` = the organization).
3. For a managed organization, delete the user events of all its accounts, then the accounts. Their sessions, sign-in methods and memberships cascade away with them. A personal organization skips this step. See [Personal and managed accounts](db-structure.md#personal-and-managed-accounts).
4. Record `organization.purged`, and `user.purged` for each managed account removed, as platform events.
5. Delete the organization row. Its templates, runs, members, invitations and teams cascade away with it. This only succeeds because steps 2 and 3 removed its events and any managed accounts first; otherwise `RESTRICT` blocks it.

**How the trigger allows it:** with the purge flag set, the trigger allows deleting an event only if its organization has `deleted_at` set and `purge_after` in the past. For organization events that's the event's `organization_id`; for user events it's the user's `managed_by_organization_id`. It reads this from the `organizations` row, which still exists until step 5. Platform events can never be deleted. Every other delete still fails.

**Personal accounts' events aren't affected.** Personal accounts aren't deleted with an organization, so their sign-in history stays, and is never purged; if a user is erased, their `users` row is anonymised as described in [Personal data](#personal-data).

**Leaving a trace:** once purged, nothing about the organization remains in its own tables, but its platform events stay: when it was created, deleted and purged, with its ID, slug and type, and a `user.purged` for each managed account removed with it.

## Event catalogue

Action names are `entity.past_tense_verb`. The payload lists what each event must carry.

| Scope | Action | Payload |
| --- | --- | --- |
| Organization | `organization.created` | Account type (personal or managed) |
| Organization | `organization.updated` | Changed fields: old and new |
| Organization | `organization.deleted`, `organization.restored` | Purge date; original slug |
| Organization | `member.added`, `member.removed` | User ID, role |
| Organization | `member.role_changed` | User ID, old role, new role |
| Organization | `invitation.created`, `invitation.cancelled`, `invitation.accepted`, `invitation.rejected` | Invitation ID, role, group (see [Personal data](#personal-data) for the email address) |
| Organization | `team.created`, `team.updated`, `team.deleted` | Name, old and new for updates |
| Organization | `team_member.added`, `team_member.removed` | Team ID, user ID |
| Organization | `template.created`, `template.archived` | |
| Organization | `template_version.published`, `template_version.archived` | Version number |
| Organization | `template_access.granted`, `template_access.changed`, `template_access.revoked` | Principal, old and new level |
| Organization | `schedule.created`, `schedule.updated`, `schedule.paused`, `schedule.resumed` | Changed fields |
| Organization (run) | `run.started` | Template version, schedule ID if scheduled |
| Organization (run) | `run.completed`, `run.cancelled` | Reason for cancellation |
| Organization (run) | `run_step.assigned` | Old and new assignee |
| Organization (run) | `run_step.completed` | Field values at completion |
| Organization (run) | `run_step.skipped` | Skip reason |
| Organization (run) | `run_step.reopened` | Reason, if reopening is allowed |
| Organization (run) | `field.value_set` | Field key, old value, new value |
| Organization (run) | `note.added` | Note ID, body |
| Organization (run) | `approval.requested` | Approver type and reference |
| Organization (run) | `approval.decided` | Decision, comment |
| Organization (run) | `run_step.overdue` | Due at (written by the overdue job, actor `system`) |
| User | `user.created` | Managed organization ID for a managed account |
| User | `user.sign_in_refused` | Reason (organization deleted) |
| User | `user.signed_in`, `user.signed_out` | Sign-in method (password, OIDC provider), organization made active |
| User | `user.password_changed`, `user.email_changed`, `user.two_factor_enabled`, `user.two_factor_disabled` | |
| Platform | `organization.created`, `organization.updated`, `organization.deleted`, `organization.restored` | Organization ID, slug, type; changed fields for updates |
| Platform | `organization.purged` | Organization ID, slug, type, deleted at, accounts removed |
| Platform | `user.created`, `user.email_changed`, `user.anonymised` | User ID, managed organization ID if any |
| Platform | `user.purged` | User ID, managed organization ID (written by the purge job) |
| Platform | `operator.*` | Operator actions, for example `operator.exported_organization`, `operator.banned_user`, `operator.role_changed` |

Draft edits to templates aren't logged event by event; publishing a version logs the whole frozen version's ID, and the version itself is immutable, so it is the record.

Failed sign-ins aren't recorded in the audit log (there may be no user to attach them to); they go to application logs and Better Auth's rate limiting.

## Better Auth

Membership, role, invitation, team and account changes happen inside Better Auth, so they're recorded from its hooks:

- **Organization plugin hooks:** `afterCreateOrganization`, `afterAddMember`, `afterRemoveMember`, `afterUpdateMemberRole`, `afterCreateInvitation`, `afterCancelInvitation`, `afterAcceptInvitation`, `afterRejectInvitation`, `afterCreateTeam`, `afterUpdateTeam`, `afterDeleteTeam`, `afterAddTeamMember`, `afterRemoveTeamMember` and `afterUpdateOrganization`. Organization deletion doesn't go through Better Auth at all (see [Deleted organizations](#deleted-organizations)).
- **Database hooks:** `user.create.after` records `user.created`; `session.create.after` records sign-ins.
- **Endpoint hooks:** `before` hooks on sign-in (blocking managed accounts of deleted organizations), and on adding members, accepting invitations and creating organizations (an account only joins an organization of its own type, and a managed account only its own).

**Atomicity** (decided: test, then reconcile). These hooks run after Better Auth's own write. Unless that write and the hook share a transaction, a crash in between leaves a change with no event. The first step is to turn on the Drizzle adapter's `transaction` option and test whether the hooks run inside the same transaction:

- **If they do**, `recordAudit` uses that transaction and the guarantee holds.
- **If they don't**, events are still recorded from the hooks, and a nightly reconciliation job compares current memberships, roles, invitations and groups with what the organization's log says they should be. It records any difference as a `system` event, so a missed change shows up in the log within a day, marked as found by reconciliation rather than recorded at the time.

## Personal data

An append-only log and the right to erasure (GDPR) pull in opposite directions. The plan keeps personal data out of the log as far as possible:

- **Actors and subjects are stored as IDs**, never names or email addresses. The UI looks names up when displaying events. If a user is erased, their `users` row is anonymised and the log keeps an opaque ID, which counts as pseudonymised.
- **Invitation email addresses** are the exception: there's no user ID yet. The payload stores a salted hash of the address instead, so an auditor can confirm "this invitation went to x@example.com" if they already know the address, but the log doesn't reveal it.
- **`context` (IP address, user agent)** is recorded for auth events only, and is erased after `AUDIT_CONTEXT_RETENTION_DAYS` or on an erasure request (decided).
- **Note bodies and text field values** are user content. If someone types personal data into a note, it stays in the log permanently. That's the same trade-off every audit system makes.

## Reading the log

- **Run timeline:** a run's page shows its events (`run_id`), newest first.
- **Organization audit view:** owners and admins can filter the organization's events by date, actor, action and entity. Sign-ins come from the user events of the organization's current members.
- **Entity history:** "show history" on a template, schedule or member reads by (`entity_type`, `entity_id`).
- **Your activity:** each user can see their own user events (sign-ins and security changes).
- **Platform audit view:** operators can browse and filter platform events. Operators are platform administrators, separate from organization roles; Better Auth's `admin` plugin provides the role (`users.role = "admin"`) along with banning users, which is recorded as an `operator.*` event.
- Reading the log is itself not logged in the MVP.

## Evidence pack export (v1)

The v1 evidence pack (PDF plus ZIP) includes a run's events as JSON lines alongside the PDF report and uploaded files, so the record can be read and checked without Checklog.

## Future: tamper evidence

Not planned for the MVP or v1 (decided). If customers in regulated industries need proof that the log hasn't been changed even by someone with database access, it can be added later without redesigning the table:

- A scheduled job takes each period's new events (for example every hour), hashes them in `id` order, and writes a digest that includes the previous digest's hash, signed with a key the database never sees. This is the approach AWS CloudTrail uses for log file integrity.
- It runs outside the write path, so it adds no locking or cost to recording events.
- It only proves integrity from the day it's turned on, not for events recorded before.

## Testing

Tests (which agents may write, reviewed by a person) should cover:

- A failed business write leaves no event, and a failed event write leaves no business change.
- An event whose payload doesn't match its action's schema, or that breaks the scope rules, is rejected.
- The trigger always blocks `TRUNCATE`; blocks updates without the context expiry flag, and with it allows only setting `context` to null; blocks deletes without the purge flag, and with it allows only events of organizations past their `purge_after`. Platform events can't be deleted even with the flag.
- Soft-deleting an organization hides it from every entry point listed in [Deleted organizations](#deleted-organizations): Checklog's API, Better Auth's organization endpoints, the organization list and the active organization.
- Restoring within the grace period brings back the organization with its data and audit log intact, and its slug if it's free. Only its owners can see it in Recently deleted or on the block screen, or restore it; other members and other users can't.
- An owner of a deleted managed organization can sign in, but every request except fetching their session, restoring and signing out is refused.
- When a managed organization is deleted, its accounts can't sign in and lose their sessions, except owners; when a personal organization is deleted, nobody is blocked. Restoring lets everyone sign in again.
- A personal account can't join a managed organization, a managed account can't join or create any other organization, and an invitation to a managed organization for an email that already has an account is refused.
- The purge job removes an organization, its data and its events only after `purge_after`, plus all its accounts and their user events if it's managed, and leaves other organizations and personal accounts alone. Hard-deleting an organization whose events or managed accounts still exist fails.
- Purging an organization leaves `organization.purged` and `user.purged` platform events.

## Suggested order of work

1. The `audit_events` table, its scope constraint and trigger, and `recordAudit` with per-action payload schemas
2. Better Auth: turn on adapter transactions, test whether hooks share them, then wire up the hooks
3. Recording organization, user and platform events for organization and account changes
4. Soft delete: Better Auth `additionalFields` and `disableOrganizationDeletion`, the delete and restore endpoints, and the checks that hide deleted organizations
5. Organization types: `account_type` and `managed_by_organization_id`, the managed-organization sign-up flow, the same-type membership hooks, and the sign-in block for deleted managed organizations
6. The nightly context expiry and purge jobs, once pg-boss jobs exist
7. Reconciliation, if step 2 showed it's needed
8. Template, run and approval events as those features are built
9. Operators: Better Auth's `admin` plugin, the platform audit view, and `operator.*` events
10. Before the first production deployment: split the app and owner database roles, and add `MIGRATION_DATABASE_URL`

## Decided

- **No hash chains:** a plain append-only table, as comparable products use; cryptographic tamper evidence is a future feature, not MVP or v1
- **Better Auth atomicity:** test whether hooks share Better Auth's transaction; if not, record from hooks and reconcile nightly
- **IP addresses and user agents:** stored in `context` and erased after a deployment-wide period
- **Retention:** audit events are kept for as long as their organization exists; `context` expires after a set period
- **Deleted organizations:** soft-deleted, hidden at once, restorable by their owners during a deployment-wide grace period (default 90 days), then purged with their audit log and managed accounts; personal accounts and their events are kept
- **Organization types:** each organization is personal or managed, fixed at creation; managed organizations contain only managed accounts, created by the managed sign-up flow or by accepting an invitation (domain verification, SSO and SCIM in v1); outsiders use guest links (v1); in a deleted managed organization only owners can sign in
- **Database roles:** one role plus the trigger during MVP development; split before the first production deployment
- **Sign-ins:** recorded as user events
- **Platform events:** a deployment-wide record of organization and user lifecycle changes and operator actions, never purged
- **Owners of a deleted organization:** can sign in, but only to restore it

## Open questions

None at the moment. Add new ones here as the audit log is built.
