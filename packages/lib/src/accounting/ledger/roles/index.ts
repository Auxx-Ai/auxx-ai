// packages/lib/src/accounting/ledger/roles/index.ts

export {
  ENABLED_POSTING_TYPES,
  EXPORT_ROUTE_BY_POSTING_TYPE,
  type ExportRoute,
  findInventoryWriterConflicts,
  findWriterConflicts,
  INVENTORY_ROLES,
  type InventoryWriterConflict,
  SINGLE_WRITER_ROLES,
  SINGLE_WRITER_ROLES_BY_POSTING_TYPE,
  type WriterConflict,
} from './regime'
export {
  loadRoleAccountCodes,
  type ResolvedAccount,
  type RoleSourceScope,
  resolveAccountLines,
  resolveRoles,
} from './resolve-roles'
export {
  listChartAccounts,
  listChartAccountUsage,
  listRoleMap,
  type SaveMappingRow,
  type SetRoleAssignmentOptions,
  saveRoleAssignments,
  setRoleAssignment,
} from './role-map'
// ── task 47: the sources a role map may be scoped to ────────────────────────
export {
  ensureManualSourceAccount,
  listRoleSources,
  MANUAL_SOURCE_EXTERNAL_ID,
  MANUAL_SOURCE_LABEL,
  MANUAL_SOURCE_PROVIDER_KEY,
  type RoleSourceRow,
  readManualSourceAccountId,
} from './source-scope'
