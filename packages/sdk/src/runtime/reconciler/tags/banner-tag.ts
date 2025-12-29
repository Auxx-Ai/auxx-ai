// packages/sdk/src/runtime/reconciler/tags/banner-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Banner component.
 */
export class BannerTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'Banner'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant } = props
    return { variant }
  }
}
