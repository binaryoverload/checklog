// Prefixes are part of every stored ID, so never change one once rows exist.
// TypeID prefixes may only use lowercase a-z and underscores.
const tableToPrefix: Record<string, string> = {
  // Better Auth, keyed by the model name it passes to advanced.database.generateId
  user: "user",
  session: "sess",
  account: "acct",
  verification: "verif",
  organization: "org",
  member: "mem",
  invitation: "inv",
  team: "team",
  teamMember: "tmem",
  organizationRole: "orole",

  // Checklog tables
  template: "tmpl",
  template_version: "tver",
  template_step: "tstep",
  template_field: "tfield",
  template_access: "tacc",
  schedule: "sched",
  run: "run",
  run_step: "rstep",
  run_field_value: "fval",
  step_note: "note",
  approval_request: "apreq",
  approval_decision: "apdec",
  audit_chain: "achain",
  audit_event: "aevt",
  notification: "notif",
}

export function prefixForTable(tableName: string) {
  const prefix = tableToPrefix[tableName]
  if (!prefix) {
    throw new Error(`No typeid prefix found for table: ${tableName}`)
  }
  return prefix
}
