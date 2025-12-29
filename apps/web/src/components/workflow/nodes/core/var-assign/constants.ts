// apps/web/src/components/workflow/nodes/core/var-assign/constants.ts

import { BaseType } from '~/components/workflow/types/unified-types'

/**
 * Display labels for variable types
 * @deprecated Use getVarTypeName() from icon-helper instead
 * Will be removed in next major version
 */
export const VAR_TYPE_LABELS: Record<BaseType, string> = {
  [BaseType.STRING]: 'String',
  [BaseType.NUMBER]: 'Number',
  [BaseType.BOOLEAN]: 'Boolean',
  [BaseType.OBJECT]: 'Object',
  [BaseType.ARRAY]: 'Array',
  [BaseType.DATE]: 'Date',
  [BaseType.DATETIME]: 'DateTime',
  [BaseType.TIME]: 'Time',
  [BaseType.FILE]: 'File',
  [BaseType.REFERENCE]: 'Reference',
  [BaseType.EMAIL]: 'Email',
  [BaseType.URL]: 'URL',
  [BaseType.PHONE]: 'Phone',
  [BaseType.ENUM]: 'Enum',
  [BaseType.JSON]: 'JSON',
  [BaseType.RELATION]: 'Relation',
  [BaseType.SECRET]: 'Secret',
  [BaseType.ANY]: 'Any',
  [BaseType.NULL]: 'Null',
}

/**
 * Variable types allowed for user creation in VAR_ASSIGN node
 * Note: Arrays are created via the isArray toggle, not as a separate type
 */
export const ALLOWED_VAR_TYPES = [
  BaseType.STRING,
  BaseType.NUMBER,
  BaseType.BOOLEAN,
  BaseType.OBJECT,
  BaseType.DATE,
  BaseType.DATETIME,
]
