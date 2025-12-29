// packages/sdk/src/runtime/reconciler/tags/workflow-conditional-render-tag.ts

import { BaseTag } from './base-tag.js'

/**
 * Tag class for ConditionalRender component.
 * Evaluates the condition on SDK side and serializes the boolean result.
 * This avoids the need to serialize functions across iframe boundaries.
 */
export class WorkflowConditionalRenderTag extends BaseTag {
  private shouldRender: boolean

  constructor(props: Record<string, any>) {
    super(props)

    // Evaluate the condition immediately with the provided data
    // This happens on the SDK (iframe) side
    const { when, data } = props
    this.shouldRender = typeof when === 'function' ? when(data) : false
  }

  /**
   * Returns the HTML tag name to render.
   */
  getTagName(): string {
    return 'div'
  }

  /**
   * Returns the component name for registry lookup.
   */
  getComponentName(): string {
    return 'ConditionalRenderInternal'
  }

  /**
   * Extracts and returns serializable attributes.
   * Only sends the boolean result of the condition evaluation.
   */
  getAttributes(_props: Record<string, any>): Record<string, any> {
    return {
      shouldRender: this.shouldRender,
    }
  }
}
