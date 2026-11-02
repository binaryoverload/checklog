# Plan: operators and account deletion

Status: **agreed plan**, with one [open question](#open-questions). This is a plan, not the implementation. Under the [AI use policy](../../AGENTS.md) auth, the audit log and migrations are core logic written by a person; this doc is the spec for that work.

Operators get a custom `platform-admin` role through Better Auth's `admin` plugin, granted only in the database or by a CLI script. Impersonation needs a justification and is recorded in the platform, user and organization logs. Accounts are soft-deleted with a grace period, like organizations, and `audit_events.user_id` stops being a foreign key so users can be purged.

It extends the [audit log plan](audit-log.md), replacing step 9 of its [order of work](audit-log.md#suggested-order-of-work).

## Admin plugin and the platform-admin role

Platform admins are separate from organization roles: an organization `owner` or `admin` has no platform powers, and a platform admin has no organization role unless they're also a member.

**Setup**

- **Server:** `admin()` alongside `organization()` in `core/auth.ts`, with a custom access controller and `defaultRole: "user"`. The plugin adds no models, so `typeid.ts` needs no new prefix.
- **Client:** `adminClient()` in `plugins/auth-client.ts`, with the same access controller and roles.
- **Shared:** the access controller and roles live in `@checklog/shared`, because server and client both need them.
- **Schema:** the plugin adds `role`, `banned`, `ban_reason` and `ban_expires` to `users`, and `impersonated_by` to `sessions`. Regenerate `auth-schema.ts` (keeping time-zone timestamps and lint formatting), then generate a migration.

**Roles** (decided: a custom `platform-admin`, not the built-in `admin`, so `users.role` never shares a word with an organization role)

| Role | Who | Permissions |
| --- | --- | --- |
| `user` | Everyone, by default | None |
| `platform-admin` | Operators | `user`: list, get, ban, impersonate; `session`: list, revoke |

**Not granted, and refused by `before` hooks as well**

- **`set-role`** (decided): the role is set only in the database or by a CLI script, and Checklog never sets `adminUserIds`.
- **`delete`:** accounts are soft-deleted through Checklog's own endpoints (see [Deleted accounts](#deleted-accounts)).
- **`create`, `update`, `set-email`, `set-password`:** these go around the personal and managed account rules, which are enforced by hooks on the organization endpoints.
- **`impersonate-admins`:** one platform admin can't impersonate another.

With `adminUserIds` unset, the access controller decides every admin call, with no bypass. A `before` hook still refuses `/admin/set-role`, `/admin/remove-user`, `/admin/create-user`, `/admin/update-user` and `/admin/set-user-password` for everyone, and `/admin/impersonate-user` over HTTP: roles don't cover Better Auth's `deleteUser` or the direct impersonation block, and the hooks are a backstop if `adminUserIds` is ever set.

**Bootstrapping:** in production, every platform admin is granted by a CLI script that sets `users.role`, or a direct database update. Use Better Auth's `create-admin` CLI only if it generates IDs with Checklog's TypeID `generateId`; otherwise add a small grant script. The development seed adds a platform admin account next to the existing owner and member.

## Impersonation

Impersonation needs a justification, recorded in the audit log (decided). Better Auth's endpoint only takes a user ID, so Checklog wraps it.

**Flow**

1. A platform admin calls `POST /api/operator/impersonate` with the user ID and a justification (required, not blank).
2. The endpoint checks the caller is a platform admin and the target isn't.
3. It records the start events, then calls `auth.api.impersonateUser` and passes its session cookie back.
4. A `before` hook refuses `/admin/impersonate-user` when it arrives over HTTP, so the wrapper is the only way in. See [Open questions](#open-questions).
5. Stopping goes through Better Auth's `stopImpersonating`, with an `after` hook recording the stop events. A session that just expires records no stop event; the session ID and its expiry show when it ended.

**Recording it** (decided: it shows in the organization's log)

- `operator.impersonation_started` and `operator.impersonation_stopped` go in the platform log, the impersonated user's log, and the log of every organization the user belongs to. They carry the platform admin's ID, the justification and the impersonation session ID.
- Every event recorded during the session sets `impersonated_by` to the platform admin's ID. `recordAudit` reads it from the session's `impersonatedBy`, so callers don't pass it.

**Limits while impersonating** (decided: nothing auth-related, nothing destructive)

- **Auth:** a `before` hook refuses every Better Auth endpoint for an impersonation session, except reading the session, listing and switching organizations, and stopping the impersonation. That rules out email, password, sign-in method and two-factor changes, session management, membership, roles, invitations, teams, and starting another impersonation.
- **Refused while impersonating:** `route()` takes `impersonation: "allow" | "refuse"` (default `"allow"`), alongside its `auth` and `organization` options. A route set to `"refuse"` rejects impersonation sessions. Each route is set case by case (decided), smaller deletes such as a note or a draft step included. Likely refused: deleting or restoring accounts and organizations, removing members, archiving templates and schedules, and cancelling runs.

## Banning

Better Auth's ban blocks sign-in and revokes the user's sessions. `ban-user`, `unban-user` and `revoke-user-sessions` are recorded from `after` hooks as `operator.banned_user`, `operator.unbanned_user` and `operator.revoked_sessions` platform events, with the reason and expiry for bans.

Banning stays separate from deletion: a ban is an operator's decision, recorded as one, while a deleted account or organization blocks sign-in through its own rules.

## Deleted accounts

Accounts are soft-deleted with a grace period, like organizations (decided). Deleting one hides it and blocks sign-in at once, keeps everything for `DELETED_ACCOUNT_GRACE_DAYS` (default 90), then a nightly job hard-deletes it.

**Better Auth setup**

- `additionalFields` on `user` adds `deletedAt`, `deletedBy` and `purgeAfter`, matching organizations.
- Better Auth's `deleteUser` and the admin plugin's `removeUser` hard-delete at once, so a `before` hook refuses both, for `adminUserIds` too.

**Who deletes and restores** (decided), through Checklog endpoints

| Account | Deleted by | Restored by |
| --- | --- | --- |
| Personal | The account itself | The account itself, by signing in during the grace period |
| Managed | The organization's owners, never the account itself | The organization's owners, from a deleted members list |

Owners of a managed organization can restore a deleted member as well as the whole organization.

**Rules** (decided)

- **Last owner:** an account can't be deleted while it's the last owner of an organization with other members; ownership is transferred or the members removed first. In a managed organization the last owner can't be deleted at all; deleting the organization is the way out. Deleted owners don't count as owners. A platform admin can't delete their account while they hold the role; the preflight shows it as a blocker.
- **Sole-member organizations:** when a personal account is deleted, every organization where it's the only member is soft-deleted in the same transaction, with the account as `deleted_by`. Organizations with other members carry on, and the account's memberships stay until the purge so a restore loses nothing. A preflight check shows the person which organizations will be deleted, and any last owner blockers, before they confirm.
- **Email:** stays taken until the purge, so a restore can't clash with a new sign-up.

**Deleting**, in one transaction

1. Repeat the preflight checks: the last owner rule, and the organizations where the account is the only member.
2. Set `deleted_at`, `deleted_by` and `purge_after` on the user.
3. For a personal account, soft-delete the organizations where it's the only member.
4. Revoke its sessions.
5. Record `user.deleted` in the user's log and as a platform event, with the purge date and any organizations deleted with it, plus `organization.deleted` for each. For a managed account, also record `user.deleted` in its organization's log, with the owner as actor.

**While deleted**

- Hidden from member lists and pickers everywhere (except the owners' deleted members list in a managed organization), and can't be assigned steps or approvals.
- A deleted personal account can sign in, but only to a block screen with the purge date, **Restore** and **Sign out**; the API refuses everything else.
- A deleted managed account can't sign in; the refusal is recorded as `user.sign_in_refused`.

**Restoring** clears the three fields and records `user.restored` in the user's log, as a platform event, and in the organization's log for a managed account. Restoring a personal account also restores the organizations deleted with it (decided). Both share the same grace period, so they're always still restorable together; each gets its slug back, or asks for a new one if it's been taken.

**Purging**, in the same nightly job as organizations, once `purge_after` has passed, in one transaction

1. Set the purge flag.
2. Delete the account's user events (decided). Organization events it appears in belong to their organization and are kept, with an ID that no longer resolves. Platform events are always kept.
3. Record `user.purged` as a platform event.
4. Delete the user row. Sessions, sign-in methods, memberships and team memberships cascade. `organizations.deleted_by` and `template_versions.published_by` become null; `created_by`, `completed_by` and similar aren't foreign keys, so they keep the ID.

## Audit log changes

These are folded into the [audit log plan](audit-log.md):

- **`user_id` is a plain column** (decided), like `entity_id` and `actor_id`, not a foreign key. Users can be purged, and their organization events keep an ID that no longer resolves. This replaces "anonymise, never delete": erasure is now account deletion.
- **New `impersonated_by` column** (text, nullable): the platform admin's ID on any event done while impersonating. A column, not part of `context`, because `context` expires after 90 days.
- **Trigger:** with the purge flag set, deleting an event is allowed only if what it belongs to has `deleted_at` set and `purge_after` past. For user events that's now either the user's `managed_by_organization_id` or the user themselves. Platform events still can't be deleted.
- **Sign-in hook:** also limits deleted personal accounts to their block screen and refuses deleted managed accounts.

**New and changed events**

| Scope | Action | Payload |
| --- | --- | --- |
| User | `user.deleted`, `user.restored` | Purge date; organizations deleted with the account |
| User | `user.sign_in_refused` | Reason: organization deleted, account deleted |
| User | `operator.impersonation_started`, `operator.impersonation_stopped` | Platform admin ID, justification, session ID |
| Organization | `user.deleted`, `user.restored` | Managed accounts only: user ID, purge date |
| Organization | `operator.impersonation_started`, `operator.impersonation_stopped` | Impersonated user ID, platform admin ID, justification, session ID |
| Platform | `user.deleted`, `user.restored` | User ID, managed organization ID if any, purge date, organizations deleted with it |
| Platform | `user.purged` | User ID, managed organization ID if any |
| Platform | `operator.*` | Impersonation started and stopped, banned, unbanned, sessions revoked |

`user.anonymised` and `operator.role_changed` are dropped.

## Web app

- **App shell** (agent): an `auth: "platform-admin"` page option in `page-meta.d.ts`, checked by the global middleware against `session.user.role`, and a platform admin entry in the user menu.
- **Screens** (person): the user list; a user's page with ban, sessions and impersonate (with the justification prompt); a banner with a stop button while impersonating; the platform audit view; the deleted account block screen; the deleted members list for managed organization owners.

## Testing

Tests can be written by an agent and reviewed by a person. They should cover:

- **Roles:** the `user` role, and organization owners and admins, can't call any admin endpoint.
- **Refused endpoints:** `set-role`, `remove-user`, `create-user`, `update-user`, `set-user-password` and Better Auth's `deleteUser` are refused, even with `adminUserIds` set.
- **Impersonation:** calling `/admin/impersonate-user` directly is refused; the Checklog endpoint refuses a blank justification and a platform admin target; start and stop land in the platform, user and organization logs; events during the session carry `impersonated_by`.
- **Impersonation limits:** an impersonation session is refused by every Better Auth endpoint except reading the session, listing and switching organizations, and stopping, and by every route set to `impersonation: "refuse"`.
- **Bans:** bans, unbans and session revokes are recorded as `operator.*` events.
- **Account deletion rules:** the last owner of an organization with other members can't be deleted; the last owner of a managed organization can't be deleted at all; a managed account can't delete itself, but its owners can delete and restore it; a platform admin can't delete their own account.
- **Organizations follow the account:** deleting a personal account that's an organization's only member soft-deletes that organization, and restoring the account restores it. The preflight lists those organizations and any last owner blockers. Leaving or being removed from your only organization, and deleting a personal organization, aren't blocked.
- **While deleted:** a deleted personal account can only reach its block screen; a deleted managed account can't sign in; both lose their sessions and are hidden from member lists and pickers.
- **Purge:** an account is removed only after `purge_after`, with its user events; organization and platform events that mention it are kept, and `user.purged` is recorded. The trigger refuses deleting a user's events before their `purge_after`.

## Order of work

Account deletion fits after organization soft delete in "Then: accounts and organizations" in the [to-do list](../todo.md); operators stay last in "Then: audit log". All items are for a person unless marked.

**Account deletion**

1. `users`: `deletedAt`, `deletedBy`, `purgeAfter` through `additionalFields`, and `DELETED_ACCOUNT_GRACE_DAYS`
2. `before` hook refusing `deleteUser` and `removeUser`
3. Personal account delete and restore endpoints, with a preflight check, the last owner rule, and deleting and restoring sole-member organizations
4. Managed account delete and restore endpoints for owners, and the deleted members list
5. Sign-in hook and block screen for deleted personal accounts; refuse deleted managed accounts
6. Hide deleted accounts from member lists and pickers
7. Account purge in the nightly job, deleting the account's user events

**Audit log**

1. `audit_events`: `user_id` as a plain column and an `impersonated_by` column; the trigger's purge rule for users

**Operators**

1. Access controller with `platform-admin` in `@checklog/shared`; `admin()` and `adminClient()`; schema migration
2. `before` hooks refusing `set-role`, `remove-user`, `create-user`, `update-user`, `set-user-password` and direct `impersonate-user`
3. Grant script for `platform-admin` (or `create-admin`, if it uses `generateId`) and a platform admin in the development seed
4. Impersonation endpoint with a justification, `impersonated_by` in `recordAudit`, start and stop events
5. Impersonation limits: the Better Auth `before` hook and an `impersonation` option on `route()`
6. `operator.*` events for bans and session revokes
7. Page option and middleware for platform admin pages (agent)
8. Platform admin screens and the platform audit view

## Decided

- **Operator role:** a custom `platform-admin` through Better Auth's `admin` plugin, granted only in the database or by a CLI script; `set-role` is refused and `adminUserIds` is never set
- **Impersonation:** needs a justification, goes through Checklog's own endpoint, and is recorded in the platform, user and organization logs; nothing auth-related or destructive while impersonating, set per route
- **Deleted accounts:** soft-deleted with a deployment-wide grace period (default 90 days), then purged with their user events; personal accounts delete and restore themselves, managed accounts are deleted and restored by their organization's owners
- **Sole-member organizations:** deleted and restored with the personal account
- **Platform admins:** can't delete their own account while they hold the role
- **`audit_events.user_id`:** a plain column, not a foreign key; account deletion replaces anonymisation

## Open questions

- **Telling Checklog's call apart from a direct one:** the hook that refuses `/admin/impersonate-user` over HTTP has to let Checklog's own `auth.api.impersonateUser` call through. Better Auth normally sets `ctx.request` only for HTTP requests, so the hook refuses when it's set. Confirm that holds in the version in use, and pin it with a test.

Sources: [Better Auth admin plugin docs](https://better-auth.com/docs/plugins/admin.md)
