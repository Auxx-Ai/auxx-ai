// packages/sdk/src/runtime/reconciler/tags/typography-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag for Typography component (titles/headings).
 */
export class TypographyTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'Typography'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant } = props
    return { variant }
  }
}

/**
 * Tag for Typography.Body component.
 */
export class TypographyBodyTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'TypographyBody'
  }

  getAttributes(props: Record<string, any>): Record<string, any> {
    const { variant } = props
    return { variant }
  }
}

/**
 * Tag for Typography.Caption component.
 */
export class TypographyCaptionTag extends BaseTag {
  getTagName(): string {
    return 'div'
  }

  getComponentName(): string {
    return 'TypographyCaption'
  }

  getAttributes(_props: Record<string, any>): Record<string, any> {
    return {}
  }
}
