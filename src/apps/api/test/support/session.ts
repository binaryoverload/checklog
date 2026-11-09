import { afterEach, beforeEach, vi } from "vitest"

import { auth } from "@/core/auth.ts"
import { db } from "@/db/index.ts"
import type { UserContext } from "@/util/types.ts"
import type { OrgRole } from "@checklog/shared/auth"
import { createMember, createOrganization } from "@test/support/database.ts"

let getSession: ReturnType<typeof vi.spyOn>

// Call at the top of a test file that makes requests: each test starts signed out, and the stub is removed afterwards
export function stubSessions(): void {
  beforeEach(() => {
    getSession = vi.spyOn(auth.api, "getSession").mockResolvedValue(null as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
}

// Stubs only the session lookup; the membership is loaded from the database as in production
export function signInAs({ organization, member }: UserContext, options: { impersonatedBy?: string } = {}): void {
  getSession.mockResolvedValue({
    user: { id: member.userId, email: `${member.userId}@example.com`, name: "Test user" },
    session: { id: "sess_test", userId: member.userId, activeOrganizationId: organization.id, impersonatedBy: options.impersonatedBy },
  } as never)
}

// A member of a new organization, signed in
export async function signedInMember(role: OrgRole | (string & {}), options: { impersonatedBy?: string } = {}): Promise<UserContext> {
  const organization = await createOrganization(db)
  const context = await createMember(db, organization, role)
  signInAs(context, options)
  return context
}
