import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { Member, Organization } from "@/util/types.ts"
import type { RunWithDetailsDto } from "@checklog/shared/api"
import { typeIdForTable } from "@checklog/shared/utils"
import { approvalRequestsOf, decisionsOf, insertApprovalDecision, insertApprovalRequest, storedApprovalRequest } from "@test/support/approvals.ts"
import { createGroup, createMember, createOrganization, expectCreationKept, grant } from "@test/support/database.ts"
import { api, expectError, expectStatus } from "@test/support/http.ts"
import { insertRun, insertRunStep, publishedTemplate, storedRun, storedRunStep } from "@test/support/runs.ts"
import type { StepSpec } from "@test/support/runs.ts"
import { signedInMember, stubSessions } from "@test/support/session.ts"

// Route handlers use the shared connection rather than a test transaction, so these tests commit their rows.
// Each test creates its own organization, so they can't see each other's templates or runs.

stubSessions()

type AssigneeSpec = Pick<StepSpec, "assigneeType" | "assigneeMemberId" | "assigneeTeamId" | "assigneeRole">

const assignedTo = (member: Member): AssigneeSpec => ({ assigneeType: "member", assigneeMemberId: member.id })

const decide = (approvalId: string, body: object) => api().post(`/api/approvals/${approvalId}/decisions`).send(body)
const approve = { decision: "approved" }
const reject = { decision: "rejected", comment: "The pressure readings are missing" }

// A run whose first step is an approval step with a pending request, followed by pending run steps for `after`
async function pendingApproval(
  organization: Organization,
  assignee: AssigneeSpec,
  options: { after?: StepSpec[], run?: Parameters<typeof insertRun>[1], request?: Parameters<typeof insertApprovalRequest>[1] } = {},
) {
  const { template, version, templateSteps: [approvalTemplateStep, ...laterTemplateSteps] } = await publishedTemplate(organization, [
    { kind: "approval", ...assignee },
    ...(options.after ?? []),
  ])
  const run = await insertRun(version, options.run)
  const step = await insertRunStep(run, approvalTemplateStep!)
  const later = []
  for (const templateStep of laterTemplateSteps) later.push(await insertRunStep(run, templateStep))
  const request = await insertApprovalRequest(step, options.request)
  return { template, run, step, request, later }
}

describe("POST /api/approvals/:approvalId/decisions", () => {
  describe("approving", () => {
    test("completes the step as the approver, approves the request, records the decision and returns the run", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, step, request } = await pendingApproval(organization, assignedTo(member), { after: [{}] })
      const before = Date.now()

      const response = await decide(request.id, approve)

      expectStatus(response, 200)
      const body = response.body as RunWithDetailsDto
      expect(body.id).toBe(run.id)
      expect(body.steps[0]).toMatchObject({ id: step.id, status: "completed", completedBy: member.userId })
      const stored = (await storedRunStep(step.id))!
      expect(stored).toMatchObject({ status: "completed", completedBy: member.userId, skipReason: null })
      expect(stored.completedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000)
      expect((await storedApprovalRequest(request.id))!.status).toBe("approved")
      expect(await decisionsOf(request)).toMatchObject([{ decision: "approved", comment: null, createdBy: member.userId }])
    })

    test("stores the comment given with an approval", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { request } = await pendingApproval(organization, assignedTo(member))

      expectStatus(await decide(request.id, { decision: "approved", comment: "Checked on site" }), 200)

      expect(await decisionsOf(request)).toMatchObject([{ decision: "approved", comment: "Checked on site" }])
    })

    test("completes the run when the approval step is the last step to resolve", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, request } = await pendingApproval(organization, assignedTo(member))

      const response = await decide(request.id, approve)

      expectStatus(response, 200)
      expect(response.body).toMatchObject({ status: "completed" })
      const stored = (await storedRun(run.id))!
      expect(stored.status).toBe("completed")
      expect(stored.completedAt).not.toBeNull()
    })

    test("leaves the run in progress while other steps are pending", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, request } = await pendingApproval(organization, assignedTo(member), { after: [{}] })

      const response = await decide(request.id, approve)

      expect(response.body).toMatchObject({ status: "in_progress", completedAt: null })
      expect((await storedRun(run.id))!.status).toBe("in_progress")
    })

    test("creates a pending request for the next approval step once it's reached", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { request, later: [next] } = await pendingApproval(organization, assignedTo(member), {
        after: [{ kind: "approval", ...assignedTo(member) }],
      })

      expectStatus(await decide(request.id, approve), 200)

      expect(await approvalRequestsOf(next!)).toMatchObject([{ status: "pending", organizationId: organization.id }])
    })

    test("approves a request that was rejected before, keeping both decisions in order", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { step, request } = await pendingApproval(organization, assignedTo(member), { request: { status: "rejected" } })
      await insertApprovalDecision(request, "rejected", "Readings missing")

      expectStatus(await decide(request.id, approve), 200)

      expect((await storedApprovalRequest(request.id))!.status).toBe("approved")
      expect((await storedRunStep(step.id))!.status).toBe("completed")
      expect((await decisionsOf(request)).map(decision => decision.decision)).toEqual(["rejected", "approved"])
    })

    test("keeps who started the run, created the step and created the request, and when", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, step, request } = await pendingApproval(organization, assignedTo(member), { after: [{}] })

      expectStatus(await decide(request.id, approve), 200)

      expectCreationKept(run, await storedRun(run.id))
      expectCreationKept(step, await storedRunStep(step.id))
      expectCreationKept(request, await storedApprovalRequest(request.id))
    })
  })

  describe("rejecting", () => {
    test("rejects the request, keeps the step open, records the decision and returns the run", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, step, request } = await pendingApproval(organization, assignedTo(member))

      const response = await decide(request.id, reject)

      expectStatus(response, 200)
      const body = response.body as RunWithDetailsDto
      expect(body).toMatchObject({ id: run.id, status: "in_progress" })
      expect(body.steps[0]).toMatchObject({ id: step.id, status: "pending", completedBy: null })
      expect(await storedRunStep(step.id)).toEqual(step)
      expect((await storedApprovalRequest(request.id))!.status).toBe("rejected")
      expect(await decisionsOf(request)).toMatchObject([{ decision: "rejected", comment: reject.comment, createdBy: member.userId }])
    })

    test("rejects a request that was rejected before, keeping both decisions in order", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { request } = await pendingApproval(organization, assignedTo(member), { request: { status: "rejected" } })
      await insertApprovalDecision(request, "rejected", "Readings missing")

      expectStatus(await decide(request.id, { decision: "rejected", comment: "Still missing" }), 200)

      expect((await storedApprovalRequest(request.id))!.status).toBe("rejected")
      expect((await decisionsOf(request)).map(decision => decision.comment)).toEqual(["Readings missing", "Still missing"])
    })

    test("keeps who started the run, created the step and created the request, and when", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { run, step, request } = await pendingApproval(organization, assignedTo(member))

      expectStatus(await decide(request.id, reject), 200)

      expectCreationKept(run, await storedRun(run.id))
      expectCreationKept(step, await storedRunStep(step.id))
      expectCreationKept(request, await storedApprovalRequest(request.id))
    })
  })

  describe("the body", () => {
    test.each([
      ["a rejection with no comment", { decision: "rejected" }],
      ["a rejection with an empty comment", { decision: "rejected", comment: "" }],
      ["a rejection with a blank comment", { decision: "rejected", comment: "   " }],
      ["no decision", {}],
      ["a decision that isn't approved or rejected", { decision: "maybe" }],
      ["an unknown key", { decision: "approved", note: "Looks fine" }],
    ])("refuses %s with validation_failed and changes nothing", async (_description, body) => {
      const { organization, member } = await signedInMember("viewer")
      const { step, request } = await pendingApproval(organization, assignedTo(member))

      expectError(await decide(request.id, body), 400, "validation_failed")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await storedApprovalRequest(request.id)).toEqual(request)
      expect(await decisionsOf(request)).toEqual([])
    })
  })

  describe("who can decide", () => {
    test("lets a member of the group the step is assigned to decide", async () => {
      const { organization, member } = await signedInMember("viewer")
      const teamId = await createGroup(db, organization, [member])
      const { request } = await pendingApproval(organization, { assigneeType: "team", assigneeTeamId: teamId })

      expectStatus(await decide(request.id, approve), 200)
    })

    test("lets a member with the role the step is assigned to decide", async () => {
      const { organization } = await signedInMember("editor")
      const { request } = await pendingApproval(organization, { assigneeType: "role", assigneeRole: "editor" })

      expectStatus(await decide(request.id, approve), 200)
    })

    test("refuses an owner the step isn't assigned to with forbidden and changes nothing", async () => {
      const { organization } = await signedInMember("owner")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const { step, request } = await pendingApproval(organization, assignedTo(someoneElse))

      expectError(await decide(request.id, approve), 403, "forbidden")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await storedApprovalRequest(request.id)).toEqual(request)
      expect(await decisionsOf(request)).toEqual([])
    })

    test.each(["run", "edit"] as const)("refuses a member with %s access the step isn't assigned to with forbidden and changes nothing", async (level) => {
      const { organization, member } = await signedInMember("viewer")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const { template, step, request } = await pendingApproval(organization, assignedTo(someoneElse))
      await grant(db, template.id, { organization, memberId: member.id }, level)

      expectError(await decide(request.id, approve), 403, "forbidden")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await decisionsOf(request)).toEqual([])
    })

    test.each([
      ["member", { assigneeType: "member" as const, assigneeMemberId: null }],
      ["group", { assigneeType: "team" as const, assigneeTeamId: null }],
    ])("refuses even an owner when the assigned %s has been removed, and changes nothing", async (_kind, assignee) => {
      const { organization } = await signedInMember("owner")
      const { step, request } = await pendingApproval(organization, assignee)

      expectError(await decide(request.id, approve), 403, "forbidden")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await decisionsOf(request)).toEqual([])
    })

    test("refuses a member with only view access with forbidden, not conflict, when the run is completed", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const { template, request } = await pendingApproval(organization, assignedTo(someoneElse), {
        run: { status: "completed", completedAt: new Date() },
      })
      await grant(db, template.id, { organization, memberId: member.id }, "view")

      expectError(await decide(request.id, approve), 403, "forbidden")
    })
  })

  describe("conflicts", () => {
    test("refuses a request that's already approved with conflict and changes nothing", async () => {
      const { organization, member } = await signedInMember("viewer")
      const { version, templateSteps: [approvalTemplateStep] } = await publishedTemplate(organization, [{ kind: "approval", ...assignedTo(member) }, {}])
      const run = await insertRun(version)
      const step = await insertRunStep(run, approvalTemplateStep!, { status: "completed", completedAt: new Date(), completedBy: member.userId })
      const request = await insertApprovalRequest(step, { status: "approved" })

      expectError(await decide(request.id, reject), 409, "conflict")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await storedApprovalRequest(request.id)).toEqual(request)
      expect(await decisionsOf(request)).toEqual([])
    })

    test.each([
      ["completed", { status: "completed" as const, completedAt: new Date() }],
      ["cancelled", { status: "cancelled" as const }],
    ])("refuses a request on a %s run with conflict and changes nothing", async (_status, values) => {
      const { organization, member } = await signedInMember("viewer")
      const { run, step, request } = await pendingApproval(organization, assignedTo(member), { run: values })

      expectError(await decide(request.id, approve), 409, "conflict")
      expect(await storedRun(run.id)).toEqual(run)
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await storedApprovalRequest(request.id)).toEqual(request)
      expect(await decisionsOf(request)).toEqual([])
    })
  })

  describe("finding the request", () => {
    test("refuses a request in another organization with not_found and changes nothing", async () => {
      const otherOrganization = await createOrganization(db)
      const { member: otherMember } = await createMember(db, otherOrganization, "viewer")
      const { step, request } = await pendingApproval(otherOrganization, assignedTo(otherMember))
      await signedInMember("owner")

      expectError(await decide(request.id, approve), 404, "not_found")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await decisionsOf(request)).toEqual([])
    })

    test("refuses a request on a run the member can't see with not_found and changes nothing", async () => {
      const { organization } = await signedInMember("viewer")
      const { member: someoneElse } = await createMember(db, organization, "viewer")
      const { step, request } = await pendingApproval(organization, assignedTo(someoneElse))

      expectError(await decide(request.id, approve), 404, "not_found")
      expect(await storedRunStep(step.id)).toEqual(step)
      expect(await decisionsOf(request)).toEqual([])
    })

    test("refuses a request ID that doesn't exist with not_found", async () => {
      await signedInMember("owner")

      expectError(await decide(typeIdForTable("approvalRequests").toString(), approve), 404, "not_found")
    })

    test.each([
      ["a request ID that isn't a TypeID", "not-an-id"],
      ["a request ID for another table", typeIdForTable("runSteps").toString()],
    ])("refuses %s with validation_failed", async (_description, requestId) => {
      await signedInMember("owner")

      expectError(await decide(requestId, approve), 400, "validation_failed")
    })

    test("refuses a signed-out request with unauthorized and changes nothing", async () => {
      const organization = await createOrganization(db)
      const { member } = await createMember(db, organization, "viewer")
      const { step, request } = await pendingApproval(organization, assignedTo(member))

      expectError(await decide(request.id, approve), 401, "unauthorized")
      expect(await storedRunStep(step.id)).toEqual(step)
    })
  })
})
