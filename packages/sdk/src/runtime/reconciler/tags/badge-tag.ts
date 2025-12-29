// packages/sdk/src/runtime/reconciler/tags/badge-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Badge component.
 */
export class BadgeTag extends BaseTag {
  getTagName(): string {
    return 'span'
  }

  getComponentName(): string {
    return 'Badge'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant } = props
    return { variant }
  }
}
