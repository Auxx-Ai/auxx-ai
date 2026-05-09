// apps/web/src/components/tags/ui/tag-picker/types.ts

import type { NavigationItem } from '@auxx/ui/components/command'

/** Tag interface used internally by the picker - compatible with TagNode. */
export interface Tag {
  id: string
  title: string
  tag_emoji?: string | null
  tag_color?: string | null
  children: Tag[]
  parentId?: string | null
}

/** Navigation item type that extends Tag with the required label property. */
export type TagNavigationItem = NavigationItem & Tag
