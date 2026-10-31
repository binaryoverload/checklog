// Prefixes are part of every stored ID, so never change one once rows exist.

import { typeid } from "typeid-js"

// TypeID prefixes may only use lowercase a-z and underscores.
const tableToPrefix = {
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
  templates: "tmpl",
  templateVersions: "tver",
  templateSteps: "tstep",
  templateFields: "tfield",
  templateAccess: "tacc",
  schedules: "sched",
  runs: "run",
  runSteps: "rstep",
  runFieldValues: "fval",
  stepNotes: "note",
  approvalRequests: "apreq",
  approvalDecisions: "apdec",
  auditEvents: "aevt",
  notifications: "notif",
}

export function typeIdForModel(modelName: string) {
  const prefix = tableToPrefix[modelName as keyof typeof tableToPrefix]
  if (!prefix) {
    throw new Error(`No typeid prefix found for model: ${modelName}`)
  }
  return typeid(prefix)
}

export function prefixForTable(tableName: keyof typeof tableToPrefix) {
  const prefix = tableToPrefix[tableName]
  return prefix
}

export function typeIdForTable(tableName: keyof typeof tableToPrefix) {
  return typeid(prefixForTable(tableName))
}
