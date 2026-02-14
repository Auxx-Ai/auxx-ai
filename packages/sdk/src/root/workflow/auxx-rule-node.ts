// packages/sdk/src/root/workflow/auxx-rule-node.ts

import { type BaseWorkflowFieldOptions, WorkflowFieldNode } from './base-node.js'
import type { TransformationContext } from './values/types.js'

/**
 * Friendly format: developer writes this
 */
export class AuxxRuleReference {
  constructor(public slug: string) {}

  toJSON() {
    return { __type: 'auxx-rule', slug: this.slug }
  }
}

/**
 * Options for AuxxRule workflow fields
 */
export interface AuxxRuleWorkflowFieldOptions extends BaseWorkflowFieldOptions<AuxxRuleReference> {
  default?: AuxxRuleReference
}

/**
 * AuxxRule workflow field node
 * Handles transformation: slug → UUID → resolved rule object
 */
export class WorkflowAuxxRuleNode extends WorkflowFieldNode<
  'auxx-rule',
  AuxxRuleReference,
  AuxxRuleWorkflowFieldOptions
> {
  get type(): 'auxx-rule' {
    return 'auxx-rule'
  }

  optional(): WorkflowAuxxRuleNode {
    return new WorkflowAuxxRuleNode({
      ...this._options,
      isOptional: true,
    })
  }

  /**
   * Serialize: AuxxRuleReference → { __type, slug }
   */
  serialize(value: AuxxRuleReference): any {
    return {
      __type: 'auxx-rule',
      slug: value.slug,
    }
  }

  /**
   * Deserialize: { __type, slug } → AuxxRuleReference
   */
  deserialize(value: any): AuxxRuleReference {
    return new AuxxRuleReference(value.slug)
  }

  /**
   * To Config: slug → UUID (for database)
   */
  async toConfig(value: AuxxRuleReference | any, context: TransformationContext): Promise<any> {
    const slug = value instanceof AuxxRuleReference ? value.slug : value.slug

    if (!context.getRuleBySlug) {
      throw new Error('TransformationContext.getRuleBySlug is required for auxxRule')
    }

    const rule = await context.getRuleBySlug(slug)

    return {
      type: 'auxx-rule',
      ruleId: rule.id,
    }
  }

  /**
   * To Runtime: UUID → resolved rule object (for Lambda execution)
   */
  async toRuntimeValue(value: any, context: TransformationContext): Promise<any> {
    if (!context.loadRule) {
      throw new Error('TransformationContext.loadRule is required for auxxRule')
    }

    const rule = await context.loadRule(value.ruleId)

    return {
      __type: 'auxx-rule',
      ruleId: value.ruleId,
      rule,
    }
  }
}

/**
 * Factory function to create AuxxRule field
 */
export function auxxRule(options?: AuxxRuleWorkflowFieldOptions): WorkflowAuxxRuleNode {
  return new WorkflowAuxxRuleNode(options)
}
