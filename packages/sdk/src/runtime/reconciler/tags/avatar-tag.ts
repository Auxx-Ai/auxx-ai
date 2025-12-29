// packages/sdk/src/runtime/reconciler/tags/avatar-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Avatar component.
 */
export class AvatarTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'Avatar'
  }

  getAttributes(_props: Record<string, any>): Record<string, any> {
    // Avatar has no custom props
    return {}
  }
}
