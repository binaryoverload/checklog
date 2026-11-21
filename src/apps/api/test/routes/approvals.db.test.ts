import { describe, expect, test } from "vitest"

import { db } from "@/db/index.ts"
import type { Member, Organization } from "@/util/types.ts"
import type { ApprovalRequestDetailDto, PageResult, RunWithDetailsDto } from "@checklog/shared/api"
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

describe("GET /api/approvals", () => {
  const listApprovals = (query: Record<string, string | number> = {}) => api().get("/api/approvals").query(query)

  const idsOf = (response: { body: PageResult<ApprovalRequestDetailDto> }) => response.body.items.map(item => item.id)

  test("returns a page of the requests the member can decide, with their run, step and decisions", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { run, step, request } = await pendingApproval(organization, assignedTo(member), { run: { name: "Monday checks" }, request: { status: "rejected" } })
    await insertApprovalDecision(request, "rejected", "The pressure readings are missing")

    const response = await listApprovals()

    expectStatus(response, 200)
    const body = response.body as PageResult<ApprovalRequestDetailDto>
    expect(body).toMatchObject({ total: 1, page: 1, limit: 100 })
    expect(body.items).toHaveLength(1)
    const [item] = body.items
    expect(item).toMatchObject({
      id: request.id,
      runStepId: step.id,
      status: "rejected",
      run: { id: run.id, name: "Monday checks" },
      step: { id: step.id, title: "Step 1" },
    })
    expect(item!.decisions).toMatchObject([{ decision: "rejected", comment: "The pressure readings are missing" }])
    expect(item).not.toHaveProperty("organizationId")
  })

  test("lists requests on steps assigned to a group the member is in, or to one of their roles", async () => {
    const { organization, member } = await signedInMember("viewer")
    const teamId = await createGroup(db, organization, [member])
    const { request: byGroup } = await pendingApproval(organization, { assigneeType: "team", assigneeTeamId: teamId })
    const { request: byRole } = await pendingApproval(organization, { assigneeType: "role", assigneeRole: "viewer" })

    expect(idsOf(await listApprovals()).sort()).toEqual([byGroup.id, byRole.id].sort())
  })

  test("leaves out requests on steps assigned to someone else, even for an owner with access to the template", async () => {
    const { organization } = await signedInMember("owner")
    const other = await createMember(db, organization, "viewer")
    await pendingApproval(organization, assignedTo(other.member))
    await pendingApproval(organization, { assigneeType: "role", assigneeRole: "editor" })

    expect(idsOf(await listApprovals())).toEqual([])
  })

  test.each([
    ["member", { assigneeType: "member" as const, assigneeMemberId: null }],
    ["group", { assigneeType: "team" as const, assigneeTeamId: null }],
  ])("leaves out a request whose assigned %s has been removed", async (_kind, assignee) => {
    const { organization } = await signedInMember("owner")
    await pendingApproval(organization, assignee)

    expect(idsOf(await listApprovals())).toEqual([])
  })

  // An approved request, on a step the approval resolved
  async function approvedApproval(organization: Organization, member: Member) {
    const { version, templateSteps: [approvalTemplateStep] } = await publishedTemplate(organization, [{ kind: "approval", ...assignedTo(member) }])
    const run = await insertRun(version)
    const step = await insertRunStep(run, approvalTemplateStep!, { status: "completed", completedAt: new Date(), completedBy: member.userId })
    return insertApprovalRequest(step, { status: "approved" })
  }

  test("lists pending and rejected requests, but not approved ones", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { request: pending } = await pendingApproval(organization, assignedTo(member))
    const { request: rejected } = await pendingApproval(organization, assignedTo(member), { request: { status: "rejected" } })
    await approvedApproval(organization, member)

    expect(idsOf(await listApprovals()).sort()).toEqual([pending.id, rejected.id].sort())
  })

  test("lists the same requests for status=pending as with no status", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { request: pending } = await pendingApproval(organization, assignedTo(member))
    const { request: rejected } = await pendingApproval(organization, assignedTo(member), { request: { status: "rejected" } })
    await approvedApproval(organization, member)
    await pendingApproval(organization, assignedTo(member), { run: { status: "cancelled" } })

    expect(idsOf(await listApprovals({ status: "pending" })).sort()).toEqual([pending.id, rejected.id].sort())
  })

  test("lists approved requests and requests on completed and cancelled runs for status=all", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { request: pending } = await pendingApproval(organization, assignedTo(member))
    const { request: rejected } = await pendingApproval(organization, assignedTo(member), { request: { status: "rejected" } })
    const approved = await approvedApproval(organization, member)
    const { request: onCompleted } = await pendingApproval(organization, assignedTo(member), { run: { status: "completed", completedAt: new Date() } })
    const { request: onCancelled } = await pendingApproval(organization, assignedTo(member), { run: { status: "cancelled" } })

    const response = await listApprovals({ status: "all" })

    expectStatus(response, 200)
    expect(idsOf(response).sort()).toEqual([pending.id, rejected.id, approved.id, onCompleted.id, onCancelled.id].sort())
    expect(response.body).toMatchObject({ total: 5 })
  })

  test("still leaves out requests on steps assigned to someone else, and other organizations' requests, for status=all", async () => {
    const { organization } = await signedInMember("owner")
    const other = await createMember(db, organization, "viewer")
    await approvedApproval(organization, other.member)
    await pendingApproval(organization, { assigneeType: "role", assigneeRole: "editor" })
    await pendingApproval(await createOrganization(db), { assigneeType: "role", assigneeRole: "owner" })

    expect(idsOf(await listApprovals({ status: "all" }))).toEqual([])
  })

  test.each([
    ["completed", { status: "completed" as const, completedAt: new Date() }],
    ["cancelled", { status: "cancelled" as const }],
  ])("leaves out requests on a %s run", async (_status, values) => {
    const { organization, member } = await signedInMember("viewer")
    await pendingApproval(organization, assignedTo(member), { run: values })

    expect(idsOf(await listApprovals())).toEqual([])
  })

  test("leaves out another organization's requests", async () => {
    await pendingApproval(await createOrganization(db), { assigneeType: "role", assigneeRole: "owner" })
    await signedInMember("owner")

    expect(idsOf(await listApprovals())).toEqual([])
  })

  test("returns the requests oldest first, in pages", async () => {
    const { organization, member } = await signedInMember("viewer")
    // Created out of order, so the order can only come from createdAt
    const { request: newest } = await pendingApproval(organization, assignedTo(member), { request: { createdAt: new Date("2026-11-03T09:00:00Z") } })
    const { request: oldest } = await pendingApproval(organization, assignedTo(member), { request: { createdAt: new Date("2026-11-01T09:00:00Z") } })
    const { request: middle } = await pendingApproval(organization, assignedTo(member), { request: { createdAt: new Date("2026-11-02T09:00:00Z") } })

    const firstPage = await listApprovals({ page: 1, limit: 2 })
    const secondPage = await listApprovals({ page: 2, limit: 2 })

    expect(firstPage.body).toMatchObject({ total: 3, page: 1, limit: 2 })
    expect(idsOf(firstPage)).toEqual([oldest.id, middle.id])
    expect(secondPage.body).toMatchObject({ total: 3, page: 2, limit: 2 })
    expect(idsOf(secondPage)).toEqual([newest.id])
  })

  // Created out of order, so the order can only come from createdAt
  async function threeRequests(organization: Organization, member: Member) {
    const { request: newest } = await pendingApproval(organization, assignedTo(member), { request: { createdAt: new Date("2026-11-03T09:00:00Z") } })
    const { request: oldest } = await pendingApproval(organization, assignedTo(member), { request: { createdAt: new Date("2026-11-01T09:00:00Z") } })
    const { request: middle } = await pendingApproval(organization, assignedTo(member), { request: { createdAt: new Date("2026-11-02T09:00:00Z") } })
    return { oldest, middle, newest }
  }

  test("returns the requests oldest first for order=asc", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { oldest, middle, newest } = await threeRequests(organization, member)

    expect(idsOf(await listApprovals({ order: "asc" }))).toEqual([oldest.id, middle.id, newest.id])
  })

  test("returns the requests newest first for order=desc, in pages", async () => {
    const { organization, member } = await signedInMember("viewer")
    const { oldest, middle, newest } = await threeRequests(organization, member)

    const firstPage = await listApprovals({ order: "desc", page: 1, limit: 2 })
    const secondPage = await listApprovals({ order: "desc", page: 2, limit: 2 })

    expect(firstPage.body).toMatchObject({ total: 3, page: 1, limit: 2 })
    expect(idsOf(firstPage)).toEqual([newest.id, middle.id])
    expect(idsOf(secondPage)).toEqual([oldest.id])
  })

  test("breaks ties on the request ID, in the same direction as the order", async () => {
    const { organization, member } = await signedInMember("viewer")
    const createdAt = new Date("2026-11-01T09:00:00Z")
    const ids = []
    for (let i = 0; i < 3; i++) ids.push((await pendingApproval(organization, assignedTo(member), { request: { createdAt } })).request.id)
    const ascending = [...ids].sort()

    expect(idsOf(await listApprovals({ order: "asc" }))).toEqual(ascending)
    expect(idsOf(await listApprovals({ order: "desc" }))).toEqual([...ascending].reverse())
  })

  test("returns an empty page past the end, with the total", async () => {
    const { organization, member } = await signedInMember("viewer")
    await pendingApproval(organization, assignedTo(member))

    const response = await listApprovals({ page: 3, limit: 2 })

    expectStatus(response, 200)
    expect(response.body).toEqual({ items: [], total: 1, page: 3, limit: 2 })
  })

  test.each([
    ["a limit of 0", { limit: 0 }],
    ["a page of 0", { page: 0 }],
    ["a page that isn't a whole number", { page: 1.5 }],
    ["a status that isn't pending or all", { status: "approved" }],
    ["an order that isn't asc or desc", { order: "newest" }],
  ])("refuses %s with validation_failed", async (_description, query) => {
    await signedInMember("owner")

    expectError(await listApprovals(query), 400, "validation_failed")
  })

  test("refuses a signed-out request with unauthorized", async () => {
    expectError(await listApprovals(), 401, "unauthorized")
  })
})
