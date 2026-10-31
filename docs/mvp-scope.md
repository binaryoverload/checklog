# MVP scope

The MVP is a self-hosted template-to-run loop with approvals and an audit trail. Proof upload, branching and integrations follow in v1.

## MVP

- Templates with ordered steps, instructions and input fields (text, date, dropdown, checkbox)
- Runs launched ad hoc or on a schedule (daily, weekly, monthly, custom)
- Run snapshots: a run keeps the template version it started from
- Assignees per step (user or role) and due dates relative to run start
- Notes on any step
- Required fields and halt steps that block completion
- Approvals: a named approver or role signs off a step or run, with a comment and timestamp in the audit log
- Append-only, hash-chained audit log per run
- Overdue flags and email notifications
- Self-hostable from day one: Docker Compose deployment with Postgres; REST API

## v1

- Proof upload: files and photos on steps, camera capture on mobile web, S3-compatible storage
- Conditional logic
- Guest links for external assignees and approvers
- Evidence pack export (PDF report plus ZIP of files and log)
- Webhooks and OIDC sign-in
- Linked checklists started from a step

## Later

- Offline-capable PWA with sync
- Dashboards and completion analytics
- Import from other checklist tools' exports
