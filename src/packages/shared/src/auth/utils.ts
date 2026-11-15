export function memberRoles(member: { role: string }): string[] {
  return member.role.split(",").map(r => r.trim())
}
