// packages/lib/src/workflow-engine/catalog/type-icons.ts

import { BaseType } from '../core/types'

/**
 * Icon NAME per `BaseType` — the vocabulary a manifest's `icon` / `getIcon`
 * speaks. Names only: apps/web resolves the actual component
 * (`utils/icon-helper.tsx` → `@auxx/ui/components/icons`), which is why this
 * can live server-side at all.
 *
 * Moved here from apps/web `utils/icon-helper.tsx` (which now re-exports it) so
 * `form-input`'s `getIcon` — the first manifest to carry one — reads the same
 * map the builder does instead of opening a second copy.
 */
export const VAR_TYPE_ICON_MAP: Record<BaseType, string> = {
  [BaseType.STRING]: 'type',
  [BaseType.NUMBER]: 'hash',
  [BaseType.BOOLEAN]: 'toggle-left',
  [BaseType.OBJECT]: 'braces',
  [BaseType.ARRAY]: 'list',
  [BaseType.DATE]: 'calendar',
  [BaseType.DATETIME]: 'clock',
  [BaseType.TIME]: 'clock',
  [BaseType.FILE]: 'file',
  [BaseType.REFERENCE]: 'link',
  [BaseType.RELATION]: 'link',
  [BaseType.ACTOR]: 'user',
  [BaseType.EMAIL]: 'mail',
  [BaseType.URL]: 'link',
  [BaseType.PHONE]: 'phone',
  [BaseType.ENUM]: 'list-filter',
  [BaseType.JSON]: 'file-text',
  [BaseType.SECRET]: 'lock',
  [BaseType.ANY]: 'box',
  [BaseType.NULL]: 'minus',
  [BaseType.CURRENCY]: 'dollar-sign',
  [BaseType.ADDRESS]: 'map-pin',
  [BaseType.TAGS]: 'tags',
}
