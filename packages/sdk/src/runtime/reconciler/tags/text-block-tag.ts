// packages/sdk/src/runtime/reconciler/tags/text-block-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for TextBlock component.
 */
export class TextBlockTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'TextBlock'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { align } = props
    return { align }
  }
}
