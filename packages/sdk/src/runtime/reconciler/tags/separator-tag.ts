// packages/sdk/src/runtime/reconciler/tags/separator-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Separator component.
 */
export class SeparatorTag extends BaseTag {
  getTagName(): string {
    return 'separator'
  }

  getComponentName(): string {
    return 'Separator'
  }

  getAttributes(_props: Record<string, any>): Record<string, any> {
    // Separator has no props
    return {}
  }
}
