# Plan: audit log

Status: **agreed plan**, ready to be built. This is a plan, not the implementation. Under the [AI use policy](../../AGENTS.md) the audit log is core logic and is written by a person; this doc is the spec for that work.

It expands section 6 of the [database structure plan](db-structure.md), which settled the basics: hash-chained logs in `audit_chains` and `audit_events`, with events written in the same transaction as the change they record.

## What it has to do

1. **Record every change that matters to an auditor**: who did what, to which thing, when, and what changed.
2. **Be append-only.** Nothing in the app can edit or delete an event, and events are kept for as long as their organization exists (decided). There are two exceptions, both handled by jobs under strict rules: `context`, which isn't hashed, is erased after a set period ([Context expiry](#context-expiry)), and an organization that was soft-deleted is purged, audit log included, once its grace period ends ([Deleted organizations](#deleted-organizations)).
3. **Be tamper-evident.** If someone with database access edits, deletes or reorders events, verification finds it and says where. Tamper-*proof* is out of reach for software that owns its own database; the goal is that tampering can't go unnoticed.
4. **Never miss an event.** If the change commits, its event commits; if the event can't be written, the change fails.
5. **Be the history.** Field values only store the current value ([decided](db-structure.md#decided)), so the log must hold old and new values.

## Chains

There are four kinds of chain:

| Scope | One per | Holds | Created |
| --- | --- | --- | --- |
| `organization` | Organization | Membership, roles, invitations, groups, templates, schedules | With the organization, in `afterCreateOrganization` |
| `run` | Run | Everything that happens in the run | With the run, in the same transaction |
| `user` | User | Sign-ins, sign-outs and account security changes | With the user, in Better Auth's `user.create.after` hook |
| `app` | Deployment (exactly one) | Platform-wide changes: organizations and users being created, changed, deleted, restored and purged, and operators' actions | By a migration, so it exists before anything else |

Sign-ins go on the user's own chain because signing in isn't tied to one organization (decided). An organization's audit view shows its current members' sign-ins by reading their user chains.

The app chain (decided) is the platform's own record, for operators rather than customers. It overlaps with organization and user chains on purpose: an organization's chain says what happened inside it, while the app chain says which organizations and users exist, and it outlives them. It is never purged, so it keeps a record of every organization and managed account after they're gone.

## Tables

### `audit_chains`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | TypeID `achain_…` |
| `scope` | text | `organization`, `run`, `user` or `app` |
| `organization_id` | text, null | Set for `organization` and `run` chains; null for `user` chains, which belong to no tenant, and for the `app` chain |
| `run_id` | text, null | Set when `scope = run`; unique |
| `user_id` | text, null | Set when `scope = user`; unique |
| `head_seq` | bigint | Sequence number of the latest event; 0 for an empty chain |
| `head_hash` | text | Hash of the latest event; the genesis hash for an empty chain |
| `created_at` | timestamptz | |

**Foreign keys:** `organization_id` references `organizations`, `run_id` references `runs` and `user_id` references `users`, all with `ON DELETE RESTRICT`. Audit history must never disappear as a side effect: a run or organization can only be hard-deleted once its chains have been purged on purpose. In practice organizations are soft-deleted and runs and users are never hard-deleted, so `RESTRICT` acts as a safety net. `audit_events.chain_id` references `audit_chains`. `audit_events.entity_id` and `actor_id` stay plain columns, because they point at different tables depending on the type.

### `audit_events`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | text | TypeID `aevt_…` |
| `chain_id` | text | |
| `seq` | bigint | 1, 2, 3… within the chain. Unique on (`chain_id`, `seq`). |
| `organization_id` | text, null | Copied from the chain so organization-wide queries don't need a join; null on user chains |
| `occurred_at` | timestamptz(3) | Set by the app, millisecond precision (see [Hashing](#hashing)) |
| `actor_type` | text | `user`, `system` (jobs, schedules) or `guest` (v1) |
| `actor_id` | text, null | User ID for `user`; job name for `system` |
| `action` | text | From the [event catalogue](#event-catalogue), e.g. `run_step.completed` |
| `entity_type` | text | e.g. `run_step` |
| `entity_id` | text | The TypeID of the thing acted on |
| `payload` | jsonb | Action-specific details, such as old and new values |
| `context` | jsonb, null | Request details: session ID, IP address, user agent. **Not hashed**, so it can be erased later. See [Personal data](#personal-data). |
| `prev_hash` | text | `head_hash` of the chain before this event |
| `hash` | text | SHA-256 of this event, hex |
| `hash_version` | smallint | Which hashing rules produced `hash`; starts at 1 |

Indexes: (`chain_id`, `seq`) unique; (`organization_id`, `occurred_at`) for the organization audit view; (`entity_type`, `entity_id`) for "history of this thing".

## Writing an event

Everything goes through one function, for example `recordAudit(tx, chain, event)`, which takes the caller's open transaction. No other code inserts into `audit_events`.

Inside the caller's transaction:

1. Lock the chain: `SELECT head_seq, head_hash FROM audit_chains WHERE id = $1 FOR UPDATE`.
2. Build the event with `seq = head_seq + 1`, `prev_hash = head_hash`, and `occurred_at` = now, truncated to milliseconds.
3. Compute `hash` (below).
4. Insert the event, then set `head_seq` and `head_hash` on the chain.

The caller commits. If anything fails, the whole transaction rolls back, so the change and its event either both exist or neither does.

**Contention:** the row lock is held until commit, so writes to the same chain queue up. A run chain is a handful of people working one checklist, and a user chain is one person, so both are quiet. The organization chain is the busiest, but with sign-ins on user chains it only sees administrative changes. The app chain takes one event per sign-up and per organization or account change across the whole deployment; that's fine at MVP scale, and if it ever isn't, account creation can move to a separate chain.

**Several events in one transaction** (for example starting a run records `run.started` and then one event per step) call `recordAudit` repeatedly; the chain is already locked after the first call.

## Hashing

```
hash = sha256_hex( canonical_json({
  v: hash_version,
  chain: chain_id,
  seq,
  prev: prev_hash,
  at: occurred_at as ISO 8601 with milliseconds, UTC ("2026-11-01T09:30:00.123Z"),
  actor: { type: actor_type, id: actor_id },
  action,
  entity: { type: entity_type, id: entity_id },
  payload,
}) )
```

- **`context` is deliberately left out** (decided), so IP addresses and user agents can be erased without breaking verification. The trade-off is that `context` isn't tamper-evident; it's supporting detail for investigations, not evidence.
- **Canonical JSON** is [RFC 8785 (JCS)](https://www.rfc-editor.org/rfc/rfc8785): sorted keys, no whitespace, fixed number formatting. The [`canonicalize`](https://www.npmjs.com/package/canonicalize) package implements it. Without this, the same event could serialise two ways and verification would fail for no reason.
- **Genesis:** a new chain's `head_hash` is `sha256_hex("checklog:chain:" + chain_id)`, so two empty chains never share a starting hash.
- **Round-tripping through Postgres:** verification recomputes hashes from what is stored, so the hashed values must come back out of Postgres identical. Two rules make that true:
  - `occurred_at` is truncated to milliseconds before hashing and stored as `timestamptz(3)`, because Postgres keeps microseconds and JavaScript dates keep milliseconds.
  - `payload` may only contain strings, integers, booleans, null, arrays and objects. No floats (send decimals as strings), no `undefined`, no dates (send ISO strings). `jsonb` reorders keys, but canonical JSON sorts them anyway. `recordAudit` should validate this with a Zod schema and refuse anything else.
- **`hash_version`** lets the rules change later (a different hash, more fields) without breaking old events: the verifier picks the rules by version.

## Keeping it append-only

Three layers, each catching what the one before misses:

1. **Code:** only `recordAudit` writes events, only the context expiry job changes them, and only the purge job deletes them.
2. **A trigger** on both `audit_events` and `audit_chains`: `BEFORE TRUNCATE` always raises an exception. `BEFORE UPDATE` and `BEFORE DELETE` raise one too, except for `recordAudit` moving a chain's head forward, and the two jobs' narrowly defined changes (see [Context expiry](#context-expiry) and [Deleted organizations](#deleted-organizations)). This catches mistakes from any role, such as a careless manual query.
3. **Database privileges** (before the first production deployment, decided): the app connects as a role with only `SELECT, INSERT` on `audit_events`. Migrations, the context expiry job and the purge job use a separate owner role, since those jobs are the only things that change or remove events. That means a second connection string, `MIGRATION_DATABASE_URL`, and both roles in the compose file and Kubernetes config. During MVP development a single role plus the trigger is enough.

What none of this stops: a database superuser can disable triggers and rewrite a whole chain with freshly computed hashes. The chain then verifies, because it's internally consistent. Catching that needs something outside the database (see [Checkpoints](#checkpoints-v1)).

## Verification

`verifyChain(chainId)` reads events in `seq` order and checks, for each one:

- `seq` is exactly one more than the previous one (no gaps, no duplicates), starting at 1
- `prev_hash` equals the previous event's `hash` (or the genesis hash for `seq = 1`)
- recomputing the hash from the stored columns gives the stored `hash`

and finally that the chain's `head_seq` and `head_hash` match the last event. It returns either "valid, N events, head hash X" or the first failing `seq` and which check failed.

Where it runs:

- **On demand:** an admin endpoint and a button on the organization audit page.
- **Nightly:** a pg-boss job verifies every chain with new events since its last run, records the result, and notifies organization owners if one fails.
- **Command line:** `node dist/verify-audit.mjs`, for operators and support.

## Context expiry

Audit events are kept for as long as their organization exists (decided). Apart from a deleted organization's log, the only thing that expires is `context` (IP address, user agent, session ID), because it's personal data that's only useful for recent investigations.

- A nightly job sets `context` to null on events older than `AUDIT_CONTEXT_RETENTION_DAYS` (deployment-wide, default 90). It also clears a user's `context` early on an erasure request.
- `context` isn't hashed, so clearing it doesn't affect verification.
- **How the trigger allows it:** the job sets a transaction-local flag (`SET LOCAL checklog.audit_context_expiry = 'on'`). With that flag, the trigger allows an `UPDATE` that changes `context` to null and nothing else. Any other update, any delete and any truncate still fail. Before the role split, any connection could set the flag, so it guards against mistakes rather than attacks; after the split, the app role has no `UPDATE` at all.

## Deleted organizations

Organizations are soft-deleted (decided). Deleting one hides it straight away but keeps all its data, audit log included, for a grace period during which it can be restored. After that, a job hard-deletes it. The grace period is deployment-wide: `DELETED_ORGANIZATION_GRACE_DAYS`, default 90.

**Better Auth setup:**

- `disableOrganizationDeletion: true` turns off Better Auth's own delete endpoint, which hard-deletes.
- `additionalFields` on `organization` adds `deletedAt`, `deletedBy` and `purgeAfter`. Better Auth then includes them in its schema and API responses.

**Deleting**, through a Checklog endpoint (owners only), in one transaction:

1. Set `deleted_at`, `deleted_by` and `purge_after` (deletion time plus the grace period) on the organization.
2. Record `organization.deleted` on the organization's chain, with the purge date.
3. Rename the slug to `<slug>--deleted--<organization id>`, so the original slug can be reused straight away. The event's payload keeps the original, so a restore can put it back if it's still free.

Because this is Checklog's own endpoint, the change and its event share a transaction; no hook or reconciliation is needed.

**Restoring** is done by the organization's owners (decided), during the grace period:

- **Who:** anyone who was an owner when it was deleted. Memberships aren't touched by a soft delete, so this is simply the organization's members with the `owner` role.
- **Where:** owners of a deleted personal organization see it in a "Recently deleted" list on their account page, with the purge date. Owners of a deleted managed organization have nothing else in the app, so after signing in they get only a block screen: the organization's name, the purge date, **Restore** and **Sign out**.
- **How:** a Checklog endpoint, checking the same rule, clears the three fields, puts the slug back (or asks for a new one if it's been taken), and records `organization.restored` with the restoring owner as the actor.
- **Telling the other owners:** deleting an organization emails all its owners, with the purge date and a link to the Recently deleted list. One owner deleting an organization can't go unnoticed by the others, and any of them can undo it.

The Recently deleted list, the block screen and the restore endpoint are the only things allowed past the checks below, and only for owners. Owners get no other access to a deleted organization: they can't view or export its data, change its members or settings, or start runs until it's restored.

**Hiding a deleted organization.** Better Auth's organization plugin doesn't know about `deletedAt`, so every way in has to check it. Each check uses one shared helper, `isOrganizationDeleted`, and each gets a test:

- **Checklog's permission function** refuses any request for a deleted organization. This covers all of Checklog's own API.
- **Better Auth endpoints that act on an organization**, through a `hooks.before` matcher: setting the active organization, getting the full organization, creating, accepting and rejecting invitations, adding, removing and updating members, and all team endpoints. They fail with "organization not found".
- **Listing a user's organizations:** an `after` hook on Better Auth's list endpoint removes deleted organizations from the response.
- **In a managed organization, accounts can't sign in** while it's deleted (decided). The exception is its owners, who can sign in but are limited to the block screen: the API refuses every request from them except fetching their session, restoring the organization and signing out. A `before` hook on Better Auth's sign-in endpoints refuses everyone else with "your organization has been deleted", and their existing sessions are revoked when the organization is deleted; owners' sessions are revoked too, so they come back through the block screen. A refused sign-in is recorded on the user's chain as `user.sign_in_refused`. In a personal organization nobody is blocked from signing in: members just don't see the deleted organization.
- **Sessions whose active organization was deleted** are treated as having no active organization; the web app sends the user to pick another.

**Purging**, by a nightly job, for each organization whose `purge_after` has passed, in one transaction:

1. Set the purge flag (`SET LOCAL checklog.audit_purge = 'on'`).
2. Delete the events of every chain with that `organization_id`, then those chains.
3. For a managed organization, delete the user chains (events first) of all its accounts, then the accounts. Their sessions, sign-in methods and memberships cascade away with them. A personal organization skips this step. See [Personal and managed accounts](db-structure.md#personal-and-managed-accounts).
4. Delete the organization row. Its templates, runs, members, invitations and teams cascade away with it. This only succeeds because steps 2 and 3 removed the chains and any managed accounts first; otherwise `RESTRICT` blocks it.

**How the trigger allows it:** with the purge flag set, the trigger allows deleting an event or chain only if its organization has `deleted_at` set and `purge_after` in the past. For organization and run chains that's the chain's `organization_id`; for a user chain it's the user's `managed_by_organization_id`. It reads this from the `organizations` row, which still exists until step 4. The app chain can never be deleted. Every other delete still fails.

**Personal accounts' user chains aren't affected.** Personal accounts aren't deleted with an organization, so their sign-in history stays on their own chain, which is never purged; if a user is erased, their `users` row is anonymised as described in [Personal data](#personal-data).

**Leaving a trace:** once purged, nothing about the organization remains in its own tables, but the app chain keeps a record: `organization.purged` with its ID, slug, type and when it was deleted, and `user.purged` for each managed account removed with it.

## Event catalogue

Action names are `entity.past_tense_verb`. The payload lists what each event must carry.

| Chain | Action | Payload |
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
| Organization | `audit.verified`, `audit.verification_failed` | Chain ID, head seq, failing seq |
| App | `organization.created`, `organization.updated`, `organization.deleted`, `organization.restored` | Organization ID, slug, type; changed fields for updates |
| App | `organization.purged` | Organization ID, slug, type, deleted at, accounts removed |
| App | `user.created`, `user.email_changed`, `user.anonymised` | User ID, managed organization ID if any |
| App | `user.purged` | User ID, managed organization ID (written by the purge job) |
| App | `operator.*` | Operator actions, for example `operator.exported_organization`, `operator.banned_user`, `operator.role_changed` |
| App | `audit.verification_failed` | Any chain that fails nightly verification, so operators see it as well as organization owners |
| User | `user.created` | Managed organization ID for a managed account |
| User | `user.sign_in_refused` | Reason (organization deleted) |
| User | `user.signed_in`, `user.signed_out` | Sign-in method (password, OIDC provider), organization made active |
| User | `user.password_changed`, `user.email_changed`, `user.two_factor_enabled`, `user.two_factor_disabled` | |
| Run | `run.started` | Template version, schedule ID if scheduled |
| Run | `run.completed`, `run.cancelled` | Reason for cancellation |
| Run | `run_step.assigned` | Old and new assignee |
| Run | `run_step.completed` | Field values at completion |
| Run | `run_step.skipped` | Skip reason |
| Run | `run_step.reopened` | Reason, if reopening is allowed |
| Run | `field.value_set` | Field key, old value, new value |
| Run | `note.added` | Note ID, body |
| Run | `approval.requested` | Approver type and reference |
| Run | `approval.decided` | Decision, comment |
| Run | `run_step.overdue` | Due at (written by the overdue job, actor `system`) |

Draft edits to templates aren't logged event by event; publishing a version logs the whole frozen version's ID, and the version itself is immutable, so it is the record.

Failed sign-ins aren't recorded in the audit log (there may be no user to attach them to); they go to application logs and Better Auth's rate limiting.

## Better Auth

Membership, role, invitation, team and account changes happen inside Better Auth, so they're recorded from its hooks:

- **Organization plugin hooks:** `afterCreateOrganization` (also creates the organization's chain), `afterAddMember`, `afterRemoveMember`, `afterUpdateMemberRole`, `afterCreateInvitation`, `afterCancelInvitation`, `afterAcceptInvitation`, `afterRejectInvitation`, `afterCreateTeam`, `afterUpdateTeam`, `afterDeleteTeam`, `afterAddTeamMember`, `afterRemoveTeamMember` and `afterUpdateOrganization`. Organization deletion doesn't go through Better Auth at all (see [Deleted organizations](#deleted-organizations)).
- **Database hooks:** `user.create.after` creates the user's chain; `session.create.after` records sign-ins.
- **Endpoint hooks:** `before` hooks on sign-in (blocking managed accounts of deleted organizations), and on adding members, accepting invitations and creating organizations (an account only joins an organization of its own type, and a managed account only its own).

**Atomicity** (decided: test, then reconcile). These hooks run after Better Auth's own write. Unless that write and the hook share a transaction, a crash in between leaves a change with no event. The first step is to turn on the Drizzle adapter's `transaction` option and test whether the hooks run inside the same transaction:

- **If they do**, `recordAudit` uses that transaction and the guarantee holds.
- **If they don't**, events are still recorded from the hooks, and a nightly reconciliation job compares current memberships, roles, invitations and groups with what the organization chain says they should be. It records any difference as a `system` event, so a missed change shows up in the log within a day, marked as found by reconciliation rather than recorded at the time.

## Personal data

An append-only log and the right to erasure (GDPR) pull in opposite directions. The plan keeps personal data out of the hashed fields as far as possible:

- **Actors and subjects are stored as IDs**, never names or email addresses. The UI looks names up when displaying events. If a user is erased, their `users` row is anonymised and the log keeps an opaque ID, which counts as pseudonymised.
- **Invitation email addresses** are the exception: there's no user ID yet. The payload stores a salted hash of the address instead, so an auditor can confirm "this invitation went to x@example.com" if they already know the address, but the log doesn't reveal it.
- **`context` (IP address, user agent)** is recorded for auth events only, isn't hashed, and is erased after `AUDIT_CONTEXT_RETENTION_DAYS` or on an erasure request (decided).
- **Note bodies and text field values** are user content and are hashed. If someone types personal data into a note, it stays in the log permanently. That's the same trade-off every audit system makes.

## Reading the log

- **Run timeline:** a run's page shows its chain as a timeline, newest first.
- **Organization audit view:** owners and admins can filter the organization's events by date, actor, action and entity. Sign-ins come from the user chains of the organization's current members.
- **Entity history:** "show history" on a template, schedule or member reads by (`entity_type`, `entity_id`).
- **Your activity:** each user can see their own user chain (sign-ins and security changes).
- **Platform audit view:** operators can browse and filter the app chain. Operators are platform administrators, separate from organization roles; Better Auth's `admin` plugin provides the role (`users.role = "admin"`) along with banning users, which is recorded as an `operator.*` event.
- Reading the log is itself not logged in the MVP.

## Checkpoints (v1)

To catch a superuser rewriting a whole chain, the log needs an anchor outside the database:

- A pg-boss job periodically writes an `audit_checkpoints` row per chain: chain ID, head seq, head hash, time, and a signature over those with a private key the database never sees (from an environment variable or a key management service).
- Evidence packs include the chain, its latest checkpoint and the public key, so an outside auditor can verify both the chain and that it matches what the server signed earlier.
- Checkpoint hashes could also be emailed to organization owners as a weekly digest, which is a cheap external copy.

## Evidence pack export (v1)

The v1 evidence pack (PDF plus ZIP) includes each run chain as JSON lines with all hashed fields, the genesis rule, the hashing rules for each `hash_version`, and a short verification script, so the evidence can be checked without Checklog.

## Testing

Tests (which agents may write, reviewed by a person) should cover:

- Appending events produces a valid chain; verification passes.
- Editing any hashed column, deleting an event, swapping two events or changing `head_hash` each make verification fail at the right `seq`.
- Editing `context` doesn't affect verification.
- Two concurrent transactions appending to one chain both succeed, with consecutive `seq` values and no fork.
- A failed business write leaves no event, and a failed event write leaves no business change.
- The app chain can't be deleted, even with the purge flag.
- Purging an organization leaves `organization.purged` and `user.purged` events on the app chain.
- The trigger always blocks `TRUNCATE`; blocks event updates without the context expiry flag, and with it allows only setting `context` to null; blocks deletes without the purge flag, and with it allows only chains and events of organizations past their `purge_after`.
- Soft-deleting an organization hides it from every entry point listed in [Deleted organizations](#deleted-organizations): Checklog's API, Better Auth's organization endpoints, the organization list and the active organization.
- Restoring within the grace period brings back the organization with its data and audit log intact, and its slug if it's free. Only its owners can see it in Recently deleted or on the block screen, or restore it; other members and other users can't.
- An owner of a deleted managed organization can sign in, but every request except fetching their session, restoring and signing out is refused.
- When a managed organization is deleted, its accounts can't sign in and lose their sessions, except owners; when a personal organization is deleted, nobody is blocked. Restoring lets everyone sign in again.
- A personal account can't join a managed organization, a managed account can't join or create any other organization, and an invitation to a managed organization for an email that already has an account is refused.
- The purge job removes an organization, its data and its chains only after `purge_after`, plus all its accounts and their user chains if it's managed, and leaves other organizations and personal accounts alone. Hard-deleting an organization whose chains or managed accounts still exist fails.
- A payload with a float, a date or `undefined` is rejected.
- Hashes recomputed after a round trip through Postgres match.

## Suggested order of work

1. `audit_chains` and `audit_events` tables, the trigger, and `recordAudit` with hashing
2. `verifyChain` and its tests, before anything else writes events
3. Better Auth: turn on adapter transactions, test whether hooks share them, then wire up the hooks
4. Chain creation for organizations (`afterCreateOrganization`) and users (`user.create.after`), the app chain (created by a migration), and app chain events for organization and user changes
5. Soft delete: Better Auth `additionalFields` and `disableOrganizationDeletion`, the delete and restore endpoints, and the checks that hide deleted organizations
6. Organization types: `account_type` and `managed_by_organization_id`, the managed-organization sign-up flow, the same-type membership hooks, and the sign-in block for deleted managed organizations
7. The nightly context expiry and purge jobs, once pg-boss jobs exist
8. The nightly verification job, and reconciliation if step 3 showed it's needed
9. Template, run and approval events as those features are built
10. Operators: Better Auth's `admin` plugin, the platform audit view, and `operator.*` events
11. Before the first production deployment: split the app and owner database roles, and add `MIGRATION_DATABASE_URL`

## Decided

- **Better Auth atomicity:** test whether hooks share Better Auth's transaction; if not, record from hooks and reconcile nightly
- **IP addresses and user agents:** stored in `context`, outside the hash, and erased after a deployment-wide period
- **Retention:** audit events are kept for as long as their organization exists; `context` expires after a set period
- **Deleted organizations:** soft-deleted, hidden at once, restorable by their owners during a deployment-wide grace period (default 90 days), then purged with their audit log and managed accounts; personal accounts and their user chains are kept
- **Organization types:** each organization is personal or managed, fixed at creation; managed organizations contain only managed accounts, created by the managed sign-up flow or by accepting an invitation (domain verification, SSO and SCIM in v1); outsiders use guest links (v1); in a deleted managed organization only owners can sign in
- **Database roles:** one role plus the trigger during MVP development; split before the first production deployment
- **Sign-ins:** recorded on a per-user chain
- **App chain:** one deployment-wide chain for organization and user lifecycle changes and operator actions, never purged
- **Owners of a deleted organization:** can sign in, but only to restore it

## Open questions

None at the moment. Add new ones here as the audit log is built.
