// packages/seed/src/builders/relational-domain-builder.ts
// Relational domain builder that creates drizzle-seed refinements with proper foreign key relationships

import { createId } from '@paralleldrive/cuid2'
import type { SeedingContext, SeedingScenario } from '../types'
import type { IdPoolManager } from '../utils/id-pool-manager'
import { BusinessDistributions } from '../utils/business-distributions'
import { ContentEngine } from '../generators/content-engine'

/** RelationalDomainBuilder creates domain refinements with proper foreign key relationships. */
export class RelationalDomainBuilder {
  /** scenario stores the seeding configuration */
  private readonly scenario: SeedingScenario
  /** idPoolManager provides foreign key ID pools */
  private readonly idPoolManager: IdPoolManager
  /** distributions provides realistic business data patterns */
  private readonly distributions: BusinessDistributions
  /** content generates realistic business content */
  private readonly content: ContentEngine

  /**
   * Creates a new RelationalDomainBuilder instance.
   * @param scenario - Seeding scenario configuration
   * @param idPoolManager - ID pool manager for foreign keys
   */
  constructor(scenario: SeedingScenario, idPoolManager: IdPoolManager) {
    this.scenario = scenario
    this.idPoolManager = idPoolManager
    this.distributions = new BusinessDistributions(scenario.dataQuality)
    this.content = new ContentEngine(scenario.dataQuality)
  }

  // ---- Phase 1: Foundation Entities ----

  /** buildUserRefinements creates User table refinements */
  buildUserRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('👤 Building User refinements')
      const userIds = this.idPoolManager.generateUserIds()

      return {
        User: {
          count: this.scenario.scales.users,
          columns: {
            id: helpers.valuesFromArray({ values: userIds }),
            firstName: helpers.valuesFromArray({ values: this.generateFirstNames() }),
            lastName: helpers.valuesFromArray({ values: this.generateLastNames() }),
            email: helpers.valuesFromArray({ values: this.generateUserEmails() }),
            emailVerified: helpers.valuesFromArray({ values: this.generateEmailVerifiedFlags() }),
          },
        },
      }
    }
  }

  // ---- Phase 2: Organization Foundation ----

  /** buildOrganizationRefinements creates Organization and OrganizationSetting refinements */
  buildOrganizationRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('🏢 Building Organization refinements')
      const orgIds = this.idPoolManager.generateOrganizationIds()

      return {
        Organization: {
          count: this.scenario.scales.organizations,
          columns: {
            id: helpers.valuesFromArray({ values: orgIds }),
            name: helpers.valuesFromArray({ values: this.generateOrganizationNames() }),
            website: helpers.valuesFromArray({ values: this.generateWebsites() }),
            about: helpers.valuesFromArray({ values: this.generateAboutDescriptions() }),
            emailDomain: helpers.valuesFromArray({ values: this.generateEmailDomains() }),
            type: helpers.valuesFromArray({ values: this.generateOrganizationTypes() }),
            handle: helpers.valuesFromArray({ values: this.generateHandles() }),
            createdById: helpers.valuesFromArray({
              values: this.idPoolManager.generateCreatedByIds(this.scenario.scales.organizations)
            }),
            systemUserId: helpers.valuesFromArray({
              values: this.idPoolManager.generateCreatedByIds(this.scenario.scales.organizations)
            }),
          },
        },
        OrganizationSetting: {
          count: this.calculateSettingsCount(),
          columns: {
            organizationId: helpers.valuesFromArray({
              values: this.idPoolManager.generateDistributedOrganizationIds(this.calculateSettingsCount())
            }),
            key: helpers.valuesFromArray({ values: this.generateSettingKeys() }),
            value: helpers.valuesFromArray({ values: this.generateSettingValues() }),
            allowUserOverride: helpers.valuesFromArray({ values: this.generateUserOverrideFlags() }),
            scope: helpers.valuesFromArray({ values: this.generateSettingScopes() }),
          },
        },
      }
    }
  }

  // ---- Phase 3: Integration Layer ----

  /** buildIntegrationRefinements creates integration refinements */
  buildIntegrationRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('🔗 Building Integration refinements')
      const integrationIds = this.idPoolManager.generateIntegrationIds()
      const templateIds = this.idPoolManager.generateTemplateIds()

      return {
        EmailIntegration: {
          count: this.scenario.scales.organizations * 2, // 2 email integrations per org
          columns: {
            id: helpers.valuesFromArray({ values: integrationIds.slice(0, this.scenario.scales.organizations * 2) }),
            organizationId: helpers.valuesFromArray({
              values: this.idPoolManager.generateDistributedOrganizationIds(this.scenario.scales.organizations * 2)
            }),
            type: helpers.valuesFromArray({ values: this.generateIntegrationTypes() }),
            status: helpers.valuesFromArray({ values: this.generateIntegrationStatuses() }),
            settings: helpers.valuesFromArray({ values: this.generateIntegrationSettings() }),
          },
        },
        MessageTemplate: {
          count: this.calculateTemplateCount(),
          columns: {
            id: helpers.valuesFromArray({ values: templateIds }),
            organizationId: helpers.valuesFromArray({
              values: this.idPoolManager.generateDistributedOrganizationIds(this.calculateTemplateCount())
            }),
            name: helpers.valuesFromArray({ values: this.generateTemplateNames() }),
            content: helpers.valuesFromArray({ values: this.generateTemplateContent() }),
            type: helpers.valuesFromArray({ values: this.generateTemplateTypes() }),
          },
        },
      }
    }
  }

  // ---- Phase 4: Business Entities ----

  /** buildCommerceRefinements creates commerce entity refinements */
  buildCommerceRefinements(context?: SeedingContext): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('🛒 Building Commerce refinements')

      const customerAssignments = this.generateCommerceAssignments(
        this.scenario.scales.customers,
        context,
      )
      const customerIds = this.generateCustomerIds()
      const productAssignments = this.generateCommerceAssignments(
        this.scenario.scales.products,
        context,
      )
      const productIds = this.generateProductIds()
      const customerTimestamps = this.generateTimestampPairs(this.scenario.scales.customers)
      const productTimestamps = this.generateTimestampPairs(this.scenario.scales.products)

      return {
        shopify_customers: {
          count: this.scenario.scales.customers,
          columns: {
            id: helpers.valuesFromArray({ values: customerIds }),
            firstName: helpers.valuesFromArray({ values: this.generateFirstNames() }),
            lastName: helpers.valuesFromArray({ values: this.generateLastNames() }),
            email: helpers.valuesFromArray({ values: this.generateCustomerEmails() }),
            phone: helpers.valuesFromArray({ values: this.generatePhoneNumbers() }),
            numberOfOrders: helpers.valuesFromArray({ values: this.generateOrderCounts() }),
            state: helpers.valuesFromArray({ values: this.generateCustomerStates() }),
            amountSpent: helpers.valuesFromArray({ values: this.generateAmountSpent() }),
            verifiedEmail: helpers.valuesFromArray({ values: this.generateVerifiedFlags() }),
            tags: helpers.valuesFromArray({ values: this.generateCustomerTags() }),
            createdAt: helpers.valuesFromArray({ values: customerTimestamps.createdAt }),
            updatedAt: helpers.valuesFromArray({ values: customerTimestamps.updatedAt }),
            organizationId: helpers.valuesFromArray({
              values: customerAssignments.map((assignment) => assignment.organizationId),
            }),
            integrationId: helpers.valuesFromArray({
              values: customerAssignments.map((assignment) => assignment.integrationId),
            }),
          },
        },
        Product: {
          count: this.scenario.scales.products,
          columns: {
            id: helpers.valuesFromArray({ values: productIds }),
            title: helpers.valuesFromArray({ values: this.generateProductTitles() }),
            descriptionHtml: helpers.valuesFromArray({ values: this.generateProductDescriptions() }),
            vendor: helpers.valuesFromArray({ values: this.generateVendors() }),
            productType: helpers.valuesFromArray({ values: this.generateProductTypes() }),
            handle: helpers.valuesFromArray({ values: this.generateProductHandles() }),
            status: helpers.valuesFromArray({ values: this.generateProductStatuses() }),
            hasOnlyDefaultVariant: helpers.valuesFromArray({ values: this.generateDefaultVariantFlags() }),
            tracksInventory: helpers.valuesFromArray({ values: this.generateInventoryTrackingFlags() }),
            totalInventory: helpers.valuesFromArray({ values: this.generateTotalInventory() }),
            tags: helpers.valuesFromArray({ values: this.generateProductTags() }),
            createdAt: helpers.valuesFromArray({ values: productTimestamps.createdAt }),
            updatedAt: helpers.valuesFromArray({ values: productTimestamps.updatedAt }),
            organizationId: helpers.valuesFromArray({
              values: productAssignments.map((assignment) => assignment.organizationId),
            }),
            integrationId: helpers.valuesFromArray({
              values: productAssignments.map((assignment) => assignment.integrationId),
            }),
            publishedAt: helpers.valuesFromArray({
              values: this.generatePublishedAtDates(productTimestamps.createdAt),
            }),
          },
        },
      }
    }
  }

  /** buildCommunicationRefinements creates communication entity refinements */
  buildCommunicationRefinements(context?: SeedingContext): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('💬 Building Communication refinements')

      const threadAssignments = this.generateThreadAssignments(this.scenario.scales.threads, context)
      const participantSets = this.generateThreadParticipantSets(this.scenario.scales.threads, context)
      const threadIds = this.generateThreadIds()
      const createdAt = this.generateThreadCreatedAt()
      const firstMessageAt = this.generateThreadFirstMessageAt(createdAt)
      const lastMessageAt = this.generateThreadLastMessageAt(firstMessageAt)
      const assignees = this.generateThreadAssigneeIds(this.scenario.scales.threads, context)
      const inboxIds = this.generateThreadInboxIds(this.scenario.scales.threads, context)
      const metadata = this.generateThreadMetadata(this.scenario.scales.threads)

      return {
        Thread: {
          count: this.scenario.scales.threads,
          columns: {
            id: helpers.valuesFromArray({ values: threadIds }),
            subject: helpers.valuesFromArray({ values: this.generateThreadSubjects() }),
            participantIds: helpers.valuesFromArray({ values: participantSets }),
            organizationId: helpers.valuesFromArray({ values: threadAssignments.map(item => item.organizationId) }),
            integrationId: helpers.valuesFromArray({ values: threadAssignments.map(item => item.integrationId) }),
            assigneeId: helpers.valuesFromArray({ values: assignees }),
            messageType: helpers.valuesFromArray({ values: this.generateMessageTypes() }),
            integrationType: helpers.valuesFromArray({ values: this.generateIntegrationTypes() }),
            status: helpers.valuesFromArray({ values: this.generateThreadStatuses() }),
            messageCount: helpers.valuesFromArray({ values: this.generateMessageCounts() }),
            participantCount: helpers.valuesFromArray({ values: participantSets.map(set => set.length) }),
            type: helpers.valuesFromArray({ values: this.generateThreadTypes() }),
            createdAt: helpers.valuesFromArray({ values: createdAt }),
            firstMessageAt: helpers.valuesFromArray({ values: firstMessageAt }),
            lastMessageAt: helpers.valuesFromArray({ values: lastMessageAt }),
            inboxId: helpers.valuesFromArray({ values: inboxIds }),
            metadata: helpers.valuesFromArray({ values: metadata }),
          },
        },
      }
    }
  }

  // ---- Phase 5: Analytics & Automation ----

  /** buildAiRefinements creates AI usage refinements */
  buildAiRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      if (!this.scenario.features.aiAnalysis) {
        return {}
      }

      console.log('🤖 Building AI refinements')

      return {
        AiUsage: {
          count: this.calculateAiUsageCount(),
          columns: {
            organizationId: helpers.valuesFromArray({
              values: this.idPoolManager.generateDistributedOrganizationIds(this.calculateAiUsageCount())
            }),
            userId: helpers.valuesFromArray({
              values: this.idPoolManager.generateDistributedUserIds(this.calculateAiUsageCount())
            }),
            provider: helpers.valuesFromArray({ values: this.generateProviders() }),
            model: helpers.valuesFromArray({ values: this.generateAiModels() }),
            totalTokens: helpers.valuesFromArray({ values: this.generateTokenCounts() }),
            inputTokens: helpers.valuesFromArray({ values: this.generateInputTokens() }),
            cost: helpers.valuesFromArray({ values: this.generateCosts() }),
            endpoint: helpers.valuesFromArray({ values: this.generateEndpoints() }),
          },
        },
      }
    }
  }

  /** buildWorkflowRefinements creates workflow automation refinements */
  buildWorkflowRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('⚡ Building Workflow refinements')

      return {
        AutoResponseRule: {
          count: this.calculateAutoResponseRuleCount(),
          columns: {
            organizationId: helpers.valuesFromArray({
              values: this.idPoolManager.generateDistributedOrganizationIds(this.calculateAutoResponseRuleCount())
            }),
            name: helpers.valuesFromArray({ values: this.generateRuleNames() }),
            description: helpers.valuesFromArray({ values: this.generateRuleDescriptions() }),
            isActive: helpers.valuesFromArray({ values: this.generateEnabledFlags() }),
            priority: helpers.valuesFromArray({ values: this.generateRulePriorities() }),
            conditions: helpers.valuesFromArray({ values: this.generateConditions() }),
            responseType: helpers.valuesFromArray({ values: this.generateResponseTypes() }),
            templateId: helpers.valuesFromArray({
              values: this.generateRuleTemplateIds()
            }),
          },
        },
      }
    }
  }

  // ---- Generator Methods ----

  private generateFirstNames(): string[] {
    const names = [
      'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Jessica',
      'William', 'Ashley', 'Christopher', 'Amanda', 'Matthew', 'Stephanie', 'Joshua',
      'Jennifer', 'Andrew', 'Elizabeth', 'Daniel', 'Lauren', 'Joseph', 'Rachel',
      'Ryan', 'Megan', 'Brandon', 'Nicole', 'Jason', 'Samantha', 'Justin', 'Katherine'
    ]
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.users; i++) {
      result.push(names[i % names.length]!)
    }
    return result
  }

  private generateLastNames(): string[] {
    const names = [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
      'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
      'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
      'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark'
    ]
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.users; i++) {
      result.push(names[i % names.length]!)
    }
    return result
  }

  private generateUserEmails(): string[] {
    const firstNames = this.generateFirstNames()
    const lastNames = this.generateLastNames()
    const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com']
    const emails: string[] = []
    for (let i = 0; i < this.scenario.scales.users; i++) {
      const first = firstNames[i]!.toLowerCase()
      const last = lastNames[i]!.toLowerCase()
      const domain = domains[i % domains.length]!
      emails.push(`${first}.${last}${i > 10 ? i : ''}@${domain}`)
    }
    return emails
  }

  private generateEmailVerifiedFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.users; i++) {
      flags.push(i % 10 !== 0) // 90% verified
    }
    return flags
  }

  private generateOrganizationNames(): string[] {
    const businessTypes = [
      'Solutions', 'Technologies', 'Innovations', 'Systems', 'Digital',
      'Commerce', 'Enterprises', 'Group', 'Partners', 'Consulting'
    ]
    const bases = [
      'Auxx', 'TechFlow', 'DataSync', 'CloudPro', 'MarketEdge',
      'SalesHub', 'BusinessCore', 'ServiceLink', 'CustomerFirst'
    ]
    const names: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]
      const type = businessTypes[i % businessTypes.length]
      names.push(`${base} ${type}`)
    }
    return names
  }

  private generateWebsites(): string[] {
    const websites: string[] = []
    const bases = [
      'Auxx', 'TechFlow', 'DataSync', 'CloudPro', 'MarketEdge',
      'SalesHub', 'BusinessCore', 'ServiceLink', 'CustomerFirst'
    ]
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]!.toLowerCase()
      websites.push(`https://www.${base}.com`)
    }
    return websites
  }

  private generateAboutDescriptions(): string[] {
    const descriptions = [
      'We provide innovative solutions to help businesses grow and thrive in the digital economy.',
      'A leading provider of customer support automation and AI-powered business tools.',
      'Empowering teams with cutting-edge technology to deliver exceptional customer experiences.',
      'Transforming how businesses interact with customers through intelligent automation.',
    ]
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      result.push(descriptions[i % descriptions.length]!)
    }
    return result
  }

  private generateEmailDomains(): string[] {
    const bases = [
      'auxx', 'techflow', 'datasync', 'cloudpro', 'marketedge',
      'saleshub', 'businesscore', 'servicelink', 'customerfirst'
    ]
    const domains: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]
      domains.push(`${base}.com`)
    }
    return domains
  }

  private generateOrganizationTypes(): ('INDIVIDUAL' | 'TEAM')[] {
    const types: ('INDIVIDUAL' | 'TEAM')[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      types.push(i % 5 === 0 ? 'INDIVIDUAL' : 'TEAM') // 20% individual, 80% team
    }
    return types
  }

  private generateHandles(): string[] {
    const bases = [
      'auxx', 'techflow', 'datasync', 'cloudpro', 'marketedge',
      'saleshub', 'businesscore', 'servicelink', 'customerfirst'
    ]
    const handles: string[] = []
    for (let i = 0; i < this.scenario.scales.organizations; i++) {
      const base = bases[i % bases.length]
      handles.push(`${base}-${i + 1}`)
    }
    return handles
  }

  private calculateSettingsCount(): number {
    return this.scenario.scales.organizations * 15 // 15 settings per org
  }

  private generateSettingKeys(): string[] {
    const settingKeys = [
      'email_notifications', 'auto_reply_enabled', 'response_time_sla',
      'escalation_rules', 'working_hours', 'timezone', 'language',
      'signature_template', 'ai_analysis_enabled', 'spam_filtering',
      'thread_assignment', 'priority_routing', 'customer_tags',
      'integration_webhooks', 'data_retention_days'
    ]
    const keys: string[] = []
    const count = this.calculateSettingsCount()
    for (let i = 0; i < count; i++) {
      keys.push(settingKeys[i % settingKeys.length]!)
    }
    return keys
  }

  private generateSettingValues(): Record<string, any>[] {
    const values: Record<string, any>[] = []
    const count = this.calculateSettingsCount()
    for (let i = 0; i < count; i++) {
      values.push({ enabled: true, value: 'default_setting' })
    }
    return values
  }

  private generateUserOverrideFlags(): boolean[] {
    const flags: boolean[] = []
    const count = this.calculateSettingsCount()
    for (let i = 0; i < count; i++) {
      flags.push(i % 5 !== 0) // 80% allow override
    }
    return flags
  }

  private generateSettingScopes(): string[] {
    const scopes = ['GENERAL', 'EMAIL', 'AI', 'AUTOMATION', 'SECURITY']
    const result: string[] = []
    const count = this.calculateSettingsCount()
    for (let i = 0; i < count; i++) {
      result.push(scopes[i % scopes.length]!)
    }
    return result
  }

  private generateIntegrationTypes(): string[] {
    const types = ['GMAIL', 'OUTLOOK', 'EXCHANGE', 'IMAP']
    const result: string[] = []
    const count = this.scenario.scales.organizations * 2
    for (let i = 0; i < count; i++) {
      if (i % 100 < 60) result.push('GMAIL')
      else if (i % 100 < 85) result.push('OUTLOOK')
      else if (i % 100 < 95) result.push('EXCHANGE')
      else result.push('IMAP')
    }
    return result
  }

  private generateIntegrationStatuses(): string[] {
    const statuses = ['ACTIVE', 'PENDING', 'ERROR', 'DISABLED']
    const result: string[] = []
    const count = this.scenario.scales.organizations * 2
    for (let i = 0; i < count; i++) {
      if (i % 100 < 80) result.push('ACTIVE')
      else if (i % 100 < 90) result.push('PENDING')
      else if (i % 100 < 95) result.push('ERROR')
      else result.push('DISABLED')
    }
    return result
  }

  private generateIntegrationSettings(): Record<string, any>[] {
    const settings: Record<string, any>[] = []
    const count = this.scenario.scales.organizations * 2
    for (let i = 0; i < count; i++) {
      settings.push({
        server: 'imap.gmail.com',
        port: 993,
        ssl: true,
        username: 'user@example.com'
      })
    }
    return settings
  }

  private calculateTemplateCount(): number {
    return this.scenario.scales.organizations * 8 // 8 templates per org
  }

  private generateTemplateNames(): string[] {
    const names = [
      'Welcome Message', 'Order Confirmation', 'Shipping Notification',
      'Return Acknowledgment', 'Technical Support', 'Billing Inquiry',
      'After Hours Response', 'Escalation Notice'
    ]
    const result: string[] = []
    const count = this.calculateTemplateCount()
    for (let i = 0; i < count; i++) {
      result.push(names[i % names.length]!)
    }
    return result
  }

  private generateTemplateContent(): string[] {
    const content = [
      'Welcome to our service! We\'re excited to have you.',
      'Your order has been confirmed and is being processed.',
      'Your order has shipped and is on its way to you.',
      'We\'ve received your return request and will process it soon.',
      'Thank you for contacting technical support. We\'ll help you resolve this issue.',
      'Regarding your billing inquiry, please find the information below.',
      'Thank you for contacting us. Our office hours are 9 AM to 5 PM EST.',
      'Your request has been escalated to our management team.'
    ]
    const result: string[] = []
    const count = this.calculateTemplateCount()
    for (let i = 0; i < count; i++) {
      result.push(content[i % content.length]!)
    }
    return result
  }

  private generateTemplateTypes(): string[] {
    const types = ['AUTO_REPLY', 'NOTIFICATION', 'ESCALATION', 'CONFIRMATION']
    const result: string[] = []
    const count = this.calculateTemplateCount()
    for (let i = 0; i < count; i++) {
      result.push(types[i % types.length]!)
    }
    return result
  }

  // Commerce generators (simplified for brevity)
  private generateCustomerEmails(): string[] {
    const emails: string[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      emails.push(`customer${i}@example.com`)
    }
    return emails
  }

  private generatePhoneNumbers(): (string | null)[] {
    const phones: (string | null)[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      if (i % 3 === 0) {
        phones.push(null)
      } else {
        phones.push(`+1555${String(i).padStart(7, '0')}`)
      }
    }
    return phones
  }

  private generateOrderCounts(): number[] {
    const counts: number[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      counts.push(Math.floor(Math.random() * 20) + 1)
    }
    return counts
  }

  private generateCustomerStates(): string[] {
    const states = ['enabled', 'disabled', 'invited', 'declined']
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      result.push(states[i % states.length]!)
    }
    return result
  }

  private generateAmountSpent(): number[] {
    const amounts: number[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      amounts.push(Math.floor(Math.random() * 100000) + 1000) // $10 to $1000
    }
    return amounts
  }

  private generateVerifiedFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      flags.push(i % 10 !== 0) // 90% verified
    }
    return flags
  }

  private generateCustomerTags(): string[][] {
    const availableTags = ['vip', 'wholesale', 'retail', 'new_customer', 'returning_customer']
    const tagSets: string[][] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      const numTags = (i % 3) + 1
      const tags: string[] = []
      for (let j = 0; j < numTags; j++) {
        tags.push(availableTags[(i + j) % availableTags.length]!)
      }
      tagSets.push(tags)
    }
    return tagSets
  }

  private generateProductTitles(): string[] {
    const products = this.content.generateProductDescriptions(this.scenario.scales.products)
    return products.map(p => p.name)
  }

  private generateProductDescriptions(): string[] {
    const products = this.content.generateProductDescriptions(this.scenario.scales.products)
    return products.map(p => `<p>${p.description}</p>`)
  }

  private generateVendors(): string[] {
    const vendors = ['Acme Corp', 'Global Supplies', 'Premium Brands', 'Elite Manufacturing']
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      result.push(vendors[i % vendors.length]!)
    }
    return result
  }

  private generateProductTypes(): string[] {
    const categories = this.distributions.getProductCategoryMix()
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const category = this.distributions.selectWeightedValue(categories, i)
      result.push(category)
    }
    return result
  }

  private generateProductHandles(): string[] {
    const handles: string[] = []
    const products = this.content.generateProductDescriptions(this.scenario.scales.products)
    products.forEach((product, i) => {
      const handle = product.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50)
      handles.push(`${handle}-${i + 1}`)
    })
    return handles
  }

  private generateProductStatuses(): ('ACTIVE' | 'ARCHIVED' | 'DRAFT')[] {
    const statuses: ('ACTIVE' | 'ARCHIVED' | 'DRAFT')[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      if (i % 20 === 0) statuses.push('DRAFT')
      else if (i % 15 === 0) statuses.push('ARCHIVED')
      else statuses.push('ACTIVE')
    }
    return statuses
  }

  private generateDefaultVariantFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      flags.push(i % 3 === 0) // 33% have only default variant
    }
    return flags
  }

  private generateInventoryTrackingFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      flags.push(i % 5 !== 0) // 80% track inventory
    }
    return flags
  }

  private generateTotalInventory(): number[] {
    const inventory: number[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const level = this.distributions.selectWeightedValue(
        this.distributions.getInventoryLevels(),
        i
      )
      inventory.push(level.quantity)
    }
    return inventory
  }

  private generateProductTags(): string[][] {
    const availableTags = ['new-arrival', 'bestseller', 'sale', 'featured', 'limited-edition']
    const tagSets: string[][] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const numTags = (i % 3) + 1
      const tags: string[] = []
      for (let j = 0; j < numTags; j++) {
        tags.push(availableTags[(i + j) % availableTags.length]!)
      }
      tagSets.push(tags)
    }
    return tagSets
  }

  /** generateCustomerIds produces deterministic bigint identifiers for Shopify customers. */
  private generateCustomerIds(): bigint[] {
    const base = BigInt(10_000_000_000)
    const ids: Array<bigint> = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      ids.push(base + BigInt(i))
    }
    return ids
  }

  /** generateProductIds produces deterministic bigint identifiers for products. */
  private generateProductIds(): bigint[] {
    const base = BigInt(20_000_000_000)
    const ids: Array<bigint> = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      ids.push(base + BigInt(i))
    }
    return ids
  }

  /** generateCommerceAssignments pairs organization and integration IDs for commerce entities. */
  private generateCommerceAssignments(
    count: number,
    context?: SeedingContext,
  ): Array<{ organizationId: string; integrationId: string }> {
    const contextualIntegrations = context?.services.shopifyIntegrations ?? []
    if (contextualIntegrations.length > 0) {
      return Array.from({ length: count }, (_, index) => {
        const integration = contextualIntegrations[index % contextualIntegrations.length]!
        return { organizationId: integration.organizationId, integrationId: integration.id }
      })
    }

    const orgIds = this.idPoolManager.getOrganizationIds()
    const integrationIds = this.idPoolManager.getIntegrationIds()

    if (orgIds.length === 0 || integrationIds.length === 0) {
      throw new Error('Commerce refinements require organization and integration ID pools')
    }

    return Array.from({ length: count }, (_, index) => ({
      organizationId: orgIds[index % orgIds.length]!,
      integrationId: integrationIds[index % integrationIds.length]!,
    }))
  }

  /** generateTimestampPairs produces deterministic createdAt/updatedAt pairs. */
  private generateTimestampPairs(count: number): { createdAt: Date[]; updatedAt: Date[] } {
    const createdAt: Date[] = []
    const updatedAt: Date[] = []
    const base = Date.now() - count * 60000

    for (let i = 0; i < count; i++) {
      const created = new Date(base + i * 60000)
      createdAt.push(created)
      updatedAt.push(new Date(created.getTime() + 5 * 60000))
    }

    return { createdAt, updatedAt }
  }

  /** generatePublishedAtDates derives optional published timestamps from created dates. */
  private generatePublishedAtDates(created: Date[]): Array<Date | null> {
    return created.map((date, index) => (index % 5 === 0 ? null : new Date(date.getTime() + 60 * 60000)))
  }

  // Communication generators
  private generateThreadSubjects(): string[] {
    const emails = this.content.generateRealisticEmails(this.scenario.scales.threads)
    return emails.map(email => email.subject)
  }

  private generateMessageTypes(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      if (i % 100 < 85) result.push('EMAIL')
      else if (i % 100 < 93) result.push('SMS')
      else if (i % 100 < 98) result.push('CHAT')
      else result.push('PHONE')
    }
    return result
  }

  private generateThreadStatuses(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      if (i % 100 < 40) result.push('OPEN')
      else if (i % 100 < 65) result.push('CLOSED')
      else if (i % 100 < 85) result.push('RESOLVED')
      else result.push('PENDING')
    }
    return result
  }

  private generateMessageCounts(): number[] {
    const counts: number[] = []
    for (let i = 0; i < this.scenario.scales.threads; i++) {
      const complexity = this.distributions.selectWeightedValue(
        this.distributions.getThreadComplexityDistribution(),
        i
      )
      counts.push(complexity.messageCount)
    }
    return counts
  }

  private generateThreadTypes(): string[] {
    return Array(this.scenario.scales.threads).fill('EMAIL')
  }

  private generateThreadAssignments(
    count: number,
    context?: SeedingContext,
  ): Array<{ organizationId: string; integrationId: string; inboxId: string | null }> {
    const serviceOrgs = context?.services.organizations ?? []
    const serviceIntegrations = context?.services.integrations ?? []
    const serviceInboxes = context?.services.inboxes ?? []

    if (serviceOrgs.length > 0 && serviceIntegrations.length > 0) {
      return Array.from({ length: count }, (_, index) => ({
        organizationId: serviceOrgs[index % serviceOrgs.length]!.id,
        integrationId: serviceIntegrations[index % serviceIntegrations.length]!.id,
        inboxId:
          serviceInboxes.length === 0 || index % 4 === 0
            ? null
            : serviceInboxes[index % serviceInboxes.length]!.id,
      }))
    }

    const orgIds = this.idPoolManager.getOrganizationIds()
    const integrationIds = this.idPoolManager.getIntegrationIds()
    if (orgIds.length === 0 || integrationIds.length === 0) {
      throw new Error('Communication refinements require organization and integration ID pools')
    }

    return Array.from({ length: count }, (_, index) => ({
      organizationId: orgIds[index % orgIds.length]!,
      integrationId: integrationIds[index % integrationIds.length]!,
      inboxId: null,
    }))
  }

  private generateThreadIds(): string[] {
    return Array.from({ length: this.scenario.scales.threads }, () => createId())
  }

  private generateThreadParticipantSets(
    count: number,
    context?: SeedingContext,
  ): string[][] {
    const participants: string[][] = []
    const serviceOrgs = context?.services.organizations ?? []
    const userPool = this.collectUserIds(context)

    for (let i = 0; i < count; i++) {
      const set: string[] = []
      const org = serviceOrgs.length > 0 ? serviceOrgs[i % serviceOrgs.length] : undefined
      if (org) {
        set.push(org.ownerId)
      }
      const user = userPool[i % userPool.length]
      if (user) {
        set.push(user)
      }
      participants.push(set)
    }
    return participants
  }

  private generateThreadAssigneeIds(count: number, context?: SeedingContext): Array<string | null> {
    const userPool = this.collectUserIds(context)
    return Array.from({ length: count }, (_, index) => {
      if (index % 5 === 0) return null
      return userPool[index % userPool.length]!
    })
  }

  private generateThreadCreatedAt(): Date[] {
    const base = Date.now() - this.scenario.scales.threads * 120000
    return Array.from({ length: this.scenario.scales.threads }, (_, index) =>
      new Date(base + index * 120000)
    )
  }

  private generateThreadFirstMessageAt(createdAt: Date[]): Date[] {
    return createdAt.map(date => new Date(date))
  }

  private generateThreadLastMessageAt(firstMessageAt: Date[]): Date[] {
    return firstMessageAt.map((date, index) => new Date(date.getTime() + (index % 10) * 60000))
  }

  private generateThreadInboxIds(count: number, context?: SeedingContext): Array<string | null> {
    const serviceInboxes = context?.services.inboxes ?? []
    if (serviceInboxes.length === 0) {
      return Array(count).fill(null)
    }
    return Array.from({ length: count }, (_, index) =>
      index % 4 === 0 ? null : serviceInboxes[index % serviceInboxes.length]!.id
    )
  }

  private generateThreadMetadata(count: number): Record<string, unknown>[] {
    return Array.from({ length: count }, (_, index) => ({
      importance: index % 10 === 0 ? 'high' : 'normal',
    }))
  }

  private collectUserIds(context?: SeedingContext): string[] {
    if (context) {
      const ids = new Set<string>()
      context.auth.testUsers.forEach(user => ids.add(user.id))
      context.auth.randomUsers.forEach(user => ids.add(user.id))
      if (ids.size > 0) {
        return Array.from(ids)
      }
    }

    const pool = this.idPoolManager.getUserIds()
    if (pool.length === 0) {
      throw new Error('Communication refinements require user ID pools or seeded users')
    }
    return pool
  }

  // AI generators
  private calculateAiUsageCount(): number {
    return this.scenario.scales.organizations * 100
  }

  private generateProviders(): string[] {
    const providers = ['openai', 'anthropic', 'azure']
    const result: string[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      if (i % 100 < 60) result.push('openai')
      else if (i % 100 < 85) result.push('anthropic')
      else result.push('azure')
    }
    return result
  }

  private generateAiModels(): string[] {
    const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3', 'claude-2']
    const result: string[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      result.push(models[i % models.length]!)
    }
    return result
  }

  private generateTokenCounts(): number[] {
    const tokens: number[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      tokens.push(Math.floor(Math.random() * 4000) + 100)
    }
    return tokens
  }

  private generateInputTokens(): number[] {
    const tokens: number[] = []
    const totalTokens = this.generateTokenCounts()
    for (let i = 0; i < totalTokens.length; i++) {
      const total = totalTokens[i]!
      tokens.push(Math.floor(total * 0.7)) // 70% input ratio
    }
    return tokens
  }

  private generateCosts(): number[] {
    const costs: number[] = []
    const tokens = this.generateTokenCounts()
    for (let i = 0; i < tokens.length; i++) {
      const tokenCount = tokens[i]!
      const cost = Math.round((tokenCount / 1000) * 2 * 100) // $0.002 per 1k tokens
      costs.push(cost)
    }
    return costs
  }

  private generateEndpoints(): string[] {
    const endpoints = ['/v1/chat/completions', '/v1/completions', '/v1/embeddings', '/v1/messages']
    const result: string[] = []
    const count = this.calculateAiUsageCount()
    for (let i = 0; i < count; i++) {
      result.push(endpoints[i % endpoints.length]!)
    }
    return result
  }

  // Workflow generators
  private calculateAutoResponseRuleCount(): number {
    return this.scenario.scales.organizations * 5
  }

  private generateRuleNames(): string[] {
    const ruleTypes = [
      'Welcome New Customers', 'Order Confirmation Auto-Reply', 'Shipping Update Notification',
      'Return Request Acknowledgment', 'Technical Support Escalation'
    ]
    const names: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      names.push(ruleTypes[i % ruleTypes.length]!)
    }
    return names
  }

  private generateRuleDescriptions(): string[] {
    const descriptions = [
      'Automatically send welcome message to first-time customers',
      'Send order confirmation and tracking information',
      'Notify customers when their order ships',
      'Acknowledge return requests and provide next steps',
      'Escalate technical issues to specialized support team'
    ]
    const result: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      result.push(descriptions[i % descriptions.length]!)
    }
    return result
  }

  private generateEnabledFlags(): boolean[] {
    const flags: boolean[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      flags.push(i % 8 !== 0) // 87.5% enabled
    }
    return flags
  }

  private generateRulePriorities(): number[] {
    const priorities: number[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      priorities.push(this.distributions.generateValueInRange(1, 10, i))
    }
    return priorities
  }

  private generateConditions(): Record<string, any>[] {
    const conditions: Record<string, any>[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      conditions.push({ type: 'keyword', keywords: ['billing', 'support', 'urgent'] })
    }
    return conditions
  }

  private generateResponseTypes(): string[] {
    const types = ['AUTO_REPLY', 'ESCALATION', 'ASSIGNMENT', 'NOTIFICATION']
    const result: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      result.push(types[i % types.length]!)
    }
    return result
  }

  private generateRuleTemplateIds(): string[] {
    const templateIds = this.idPoolManager.getTemplateIds()
    const result: string[] = []
    const count = this.calculateAutoResponseRuleCount()
    for (let i = 0; i < count; i++) {
      result.push(templateIds[i % templateIds.length]!)
    }
    return result
  }
}
