// packages/seed/src/domains/workflow.domain.ts
// Workflow automation domain refinements for drizzle-seed with comprehensive workflow seeding

import { createId } from '@paralleldrive/cuid2'
import type { SeedingScenario } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'

/** WorkflowDomain encapsulates workflow and automation refinements. */
export class WorkflowDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions

  /**
   * Creates a new WorkflowDomain instance.
   * @param scenario - Scenario definition governing scale.
   */
  constructor(scenario: SeedingScenario) {
    this.scenario = scenario
    this.distributions = new BusinessDistributions(scenario.dataQuality)
  }

  /** buildRefinements returns drizzle-seed refinements for workflow entities. */
  buildRefinements(): (helpers: unknown) => Record<string, unknown> {
    return () => {
      console.log('⚙️ Workflow domain refinements skipped (handled elsewhere)')
      return {}
    }
  }

  // ---- Workflow Generator Methods ----

  /** calculateAutoResponseRuleCount determines total auto-response rules needed. */
  private calculateAutoResponseRuleCount(): number {
    return this.scenario.scales.organizations * 5 // 5 rules per org
  }

  /** generateRuleNames creates realistic automation rule names. */
  private generateRuleNames(): string[] {
    const ruleTypes = [
      'Welcome New Customers',
      'Order Confirmation Auto-Reply',
      'Shipping Update Notification',
      'Return Request Acknowledgment',
      'Technical Support Escalation',
      'VIP Customer Priority Routing',
      'After Hours Auto Response',
      'Billing Inquiry Auto-Reply',
      'Product Question Router',
      'Complaint Escalation Rule'
    ]
    const names: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      names.push(ruleTypes[i % ruleTypes.length]!)
    }
    return names
  }

  /** generateRuleDescriptions creates realistic rule descriptions. */
  private generateRuleDescriptions(): string[] {
    const descriptions = [
      'Automatically send welcome message to first-time customers',
      'Send order confirmation and tracking information',
      'Notify customers when their order ships',
      'Acknowledge return requests and provide next steps',
      'Escalate technical issues to specialized support team',
      'Route VIP customers to priority support queue',
      'Send auto-reply during non-business hours',
      'Provide billing information and escalate if needed',
      'Route product questions to appropriate department',
      'Escalate complaints to management team'
    ]
    const result: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      result.push(descriptions[i % descriptions.length]!)
    }
    return result
  }

  /** generateEnabledFlags creates realistic rule enabled status. */
  private generateEnabledFlags(): boolean[] {
    const flags: boolean[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      flags.push(i % 8 !== 0) // 87.5% enabled
    }
    return flags
  }

  /** generateRulePriorities creates realistic rule priority levels. */
  private generateRulePriorities(): number[] {
    const priorities: number[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      priorities.push(this.distributions.generateValueInRange(1, 10, i))
    }
    return priorities
  }

  /** generateConditions creates realistic rule conditions. */
  private generateConditions(): Record<string, any>[] {
    const conditions: Record<string, any>[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      const conditionType = i % 4
      if (conditionType === 0) {
        conditions.push({ type: 'keyword', keywords: ['billing', 'payment', 'invoice'] })
      } else if (conditionType === 1) {
        conditions.push({ type: 'sender_domain', domains: ['@gmail.com', '@yahoo.com'] })
      } else if (conditionType === 2) {
        conditions.push({ type: 'subject_contains', text: 'urgent' })
      } else {
        conditions.push({ type: 'time_range', hours: { start: 18, end: 9 } })
      }
    }
    return conditions
  }

  /** generateResponseTypes creates realistic response type distribution. */
  private generateResponseTypes(): string[] {
    const types = ['AUTO_REPLY', 'ESCALATION', 'ASSIGNMENT', 'NOTIFICATION']
    const result: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      if (i % 100 < 50) result.push('AUTO_REPLY')
      else if (i % 100 < 75) result.push('ASSIGNMENT')
      else if (i % 100 < 90) result.push('ESCALATION')
      else result.push('NOTIFICATION')
    }
    return result
  }

  /** getSeededStartDate returns a consistent start date for seeded data. */
  private getSeededStartDate(): Date {
    const now = new Date()
    return new Date(now.getFullYear() - 1, 0, 1) // One year ago
  }
}
