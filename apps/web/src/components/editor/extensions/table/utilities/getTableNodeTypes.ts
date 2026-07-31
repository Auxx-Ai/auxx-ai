// apps/web/src/components/editor/extensions/table/utilities/getTableNodeTypes.ts

import type { NodeType, Schema } from '@tiptap/pm/model'

/**
 * Node types in a schema keyed by their `tableRole`. Every role is optional:
 * a schema that never registered the table extension has none of them, and a
 * partial schema (cells but no header cells) is legal too — callers must check
 * the roles they need.
 */
export interface TableNodeTypes {
  table?: NodeType
  row?: NodeType
  cell?: NodeType
  header_cell?: NodeType
  [role: string]: NodeType | undefined
}

export function getTableNodeTypes(schema: Schema): TableNodeTypes {
  if (schema.cached.tableNodeTypes) {
    return schema.cached.tableNodeTypes
  }

  const roles: TableNodeTypes = {}

  for (const nodeType of Object.values(schema.nodes)) {
    const role = nodeType.spec.tableRole
    if (typeof role === 'string') {
      roles[role] = nodeType
    }
  }

  schema.cached.tableNodeTypes = roles

  return roles
}
