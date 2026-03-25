// packages/lib/src/field-values/resolvers/index.ts

export { batchFetchSystemRelationships } from './system-relationship-resolver'
export { resolveSystemTableFields, type SystemFieldDescriptor } from './system-table-resolver'
export { resolveThreadVirtualFields } from './thread-virtual-fields'
export { isVirtualField, resolveVirtualFields } from './virtual-field-registry'
