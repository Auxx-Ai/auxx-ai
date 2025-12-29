// packages/sdk/src/runtime/reconciler/tags/dialog-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Dialog wrapper component.
 * This is a simplified tag that wraps dialog content.
 */
export class DialogTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'Dialog'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { title, size, dialogId } = props
    return { title, size, dialogId }
  }
}
