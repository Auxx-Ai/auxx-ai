// packages/seed/src/utils/relationship-engine.ts
// Advanced relationship building engine for realistic business data connections

import { createId } from '@paralleldrive/cuid2'
import type { SeedingScenario } from '../types'

/** OrderHistory represents a customer's ordering patterns and history. */
export interface OrderHistory {
  /** customer identifier */
  customerId: string
  /** array of order identifiers */
  orderIds: string[]
  /** total order value */
  totalValue: number
  /** average order frequency in days */
  orderFrequency: number
  /** preferred product categories */
  preferredCategories: string[]
}

/** Message represents a single message in a support thread. */
export interface Message {
  /** message identifier */
  id: string
  /** thread this message belongs to */
  threadId: string
  /** user who sent the message */
  senderId: string
  /** message content */
  content: string
  /** message timestamp */
  timestamp: Date
  /** whether this is from customer or support */
  isFromCustomer: boolean
  /** message type */
  messageType: 'initial' | 'response' | 'follow_up' | 'resolution'
}

/** ProductVariant represents a product variation with specific attributes. */
export interface ProductVariant {
  /** variant identifier */
  id: string
  /** parent product identifier */
  productId: string
  /** variant name/title */
  title: string
  /** variant price */
  price: number
  /** inventory quantity */
  inventory: number
  /** variant attributes */
  attributes: Record<string, string>
}

/** OrganizationStructure represents a realistic organizational hierarchy. */
export interface OrganizationStructure {
  /** organization identifier */
  organizationId: string
  /** admin users */
  adminUsers: string[]
  /** regular users */
  regularUsers: string[]
  /** customer service agents */
  agents: string[]
  /** departments/teams */
  departments: Array<{
    name: string
    members: string[]
    lead: string
  }>
}

/** RelationshipEngine builds realistic business relationships between entities. */
export class RelationshipEngine {
  /** scenario controls the scale and patterns of relationships */
  private readonly scenario: SeedingScenario

  /**
   * Creates a new RelationshipEngine instance.
   * @param scenario - Scenario definition controlling relationship patterns.
   */
  constructor(scenario: SeedingScenario) {
    this.scenario = scenario
  }

  /**
   * buildCustomerOrderHistory creates realistic ordering patterns for customers.
   * @param customerId - Customer to build history for.
   * @param customerIndex - Index for deterministic patterns.
   * @returns Order history with realistic patterns.
   */
  buildCustomerOrderHistory(customerId: string, customerIndex: number): OrderHistory {
    const customerType = this.determineCustomerType(customerIndex)
    const orderCount = this.getOrderCountForCustomerType(customerType)
    const orderIds: string[] = []

    for (let i = 0; i < orderCount; i++) {
      orderIds.push(createId())
    }

    return {
      customerId,
      orderIds,
      totalValue: this.calculateTotalOrderValue(customerType, orderCount),
      orderFrequency: this.getOrderFrequency(customerType),
      preferredCategories: this.getPreferredCategories(customerType),
    }
  }

  /**
   * buildThreadMessageChain creates a realistic conversation flow for support threads.
   * @param threadId - Thread to build message chain for.
   * @param customerId - Customer involved in the thread.
   * @param agentId - Support agent handling the thread.
   * @param threadType - Type of support issue.
   * @returns Array of messages forming a realistic conversation.
   */
  buildThreadMessageChain(
    threadId: string,
    customerId: string,
    agentId: string,
    threadType: 'simple' | 'moderate' | 'complex'
  ): Message[] {
    const messages: Message[] = []
    const messageCount = this.getMessageCountForThreadType(threadType)
    const baseTime = new Date()

    // Initial customer message
    messages.push({
      id: createId(),
      threadId,
      senderId: customerId,
      content: this.generateInitialCustomerMessage(threadType),
      timestamp: baseTime,
      isFromCustomer: true,
      messageType: 'initial',
    })

    // Build conversation flow
    for (let i = 1; i < messageCount; i++) {
      const isCustomerMessage = i % 2 === 0 // Alternate between customer and agent
      const messageTime = new Date(baseTime.getTime() + i * this.getMessageInterval(threadType))

      messages.push({
        id: createId(),
        threadId,
        senderId: isCustomerMessage ? customerId : agentId,
        content: isCustomerMessage
          ? this.generateCustomerFollowUp(threadType, i)
          : this.generateAgentResponse(threadType, i, messageCount),
        timestamp: messageTime,
        isFromCustomer: isCustomerMessage,
        messageType: this.getMessageType(i, messageCount, isCustomerMessage),
      })
    }

    return messages
  }

  /**
   * buildProductVariantRelations creates realistic product variants.
   * @param productId - Parent product identifier.
   * @param productCategory - Product category for appropriate variants.
   * @param basePrice - Base price for variant pricing.
   * @returns Array of product variants with realistic attributes.
   */
  buildProductVariantRelations(
    productId: string,
    productCategory: string,
    basePrice: number
  ): ProductVariant[] {
    const variants: ProductVariant[] = []
    const variantCount = this.getVariantCount(productCategory)

    for (let i = 0; i < variantCount; i++) {
      const attributes = this.generateVariantAttributes(productCategory, i)
      const priceMultiplier = this.getVariantPriceMultiplier(attributes)

      variants.push({
        id: createId(),
        productId,
        title: this.generateVariantTitle(attributes),
        price: Math.round(basePrice * priceMultiplier * 100) / 100,
        inventory: this.generateVariantInventory(),
        attributes,
      })
    }

    return variants
  }

  /**
   * buildOrganizationHierarchy creates realistic organizational structures.
   * @param organizationId - Organization to build structure for.
   * @param userIds - Available user IDs to assign roles.
   * @returns Organization structure with departments and roles.
   */
  buildOrganizationHierarchy(organizationId: string, userIds: string[]): OrganizationStructure {
    const adminCount = Math.max(1, Math.floor(userIds.length * 0.1))
    const agentCount = Math.floor(userIds.length * 0.4)

    const adminUsers = userIds.slice(0, adminCount)
    const agents = userIds.slice(adminCount, adminCount + agentCount)
    const regularUsers = userIds.slice(adminCount + agentCount)

    const departments = this.createDepartments(agents, regularUsers)

    return {
      organizationId,
      adminUsers,
      regularUsers,
      agents,
      departments,
    }
  }

  /**
   * generateRelatedProducts creates product relationships and recommendations.
   * @param productId - Base product identifier.
   * @param allProductIds - Pool of available product IDs.
   * @param productCategory - Product category for relevant relationships.
   * @returns Array of related product IDs.
   */
  generateRelatedProducts(
    productId: string,
    allProductIds: string[],
    productCategory: string
  ): string[] {
    const relatedCount = Math.min(5, Math.floor(allProductIds.length * 0.1))
    const availableProducts = allProductIds.filter((id) => id !== productId)

    // Shuffle and take first N products for related products
    const shuffled = [...availableProducts].sort(() => Math.random() - 0.5)
    return shuffled.slice(0, relatedCount)
  }

  /** determineCustomerType classifies customers into behavioral segments. */
  private determineCustomerType(
    customerIndex: number
  ): 'occasional' | 'regular' | 'frequent' | 'vip' {
    const typeDistribution = [0.4, 0.35, 0.2, 0.05] // Realistic customer distribution
    const random = ((customerIndex * 17) % 100) / 100 // Deterministic but distributed

    if (random < typeDistribution[0]) return 'occasional'
    if (random < typeDistribution[0] + typeDistribution[1]) return 'regular'
    if (random < typeDistribution[0] + typeDistribution[1] + typeDistribution[2]) return 'frequent'
    return 'vip'
  }

  /** getOrderCountForCustomerType returns realistic order counts per customer type. */
  private getOrderCountForCustomerType(customerType: string): number {
    const orderCounts = {
      occasional: [1, 2, 3],
      regular: [3, 5, 8],
      frequent: [8, 12, 20],
      vip: [20, 35, 50],
    }

    const counts = orderCounts[customerType as keyof typeof orderCounts] || [1, 2, 3]
    return counts[Math.floor(Math.random() * counts.length)]!
  }

  /** calculateTotalOrderValue computes realistic spending patterns. */
  private calculateTotalOrderValue(customerType: string, orderCount: number): number {
    const avgOrderValues = {
      occasional: 45,
      regular: 85,
      frequent: 125,
      vip: 250,
    }

    const baseValue = avgOrderValues[customerType as keyof typeof avgOrderValues] || 45
    const variation = 0.3 // 30% variation
    const randomMultiplier = 1 + (Math.random() - 0.5) * variation

    return Math.round(baseValue * orderCount * randomMultiplier * 100) / 100
  }

  /** getOrderFrequency returns realistic ordering frequency in days. */
  private getOrderFrequency(customerType: string): number {
    const frequencies = {
      occasional: 180, // Every 6 months
      regular: 60, // Every 2 months
      frequent: 30, // Monthly
      vip: 14, // Bi-weekly
    }

    return frequencies[customerType as keyof typeof frequencies] || 180
  }

  /** getPreferredCategories returns realistic category preferences. */
  private getPreferredCategories(customerType: string): string[] {
    const allCategories = [
      'Electronics',
      'Clothing & Apparel',
      'Home & Garden',
      'Sports & Outdoor',
      'Books & Media',
      'Health & Beauty',
      'Automotive',
      'Pet Supplies',
    ]

    const categoryCount = customerType === 'vip' ? 4 : customerType === 'frequent' ? 3 : 2
    return allCategories.slice(0, categoryCount)
  }

  /** getMessageCountForThreadType returns realistic conversation lengths. */
  private getMessageCountForThreadType(threadType: string): number {
    const messageCounts = {
      simple: [2, 3, 4], // Quick resolution
      moderate: [4, 6, 8], // Back and forth
      complex: [8, 12, 16], // Extended troubleshooting
    }

    const counts = messageCounts[threadType as keyof typeof messageCounts] || [2, 3, 4]
    return counts[Math.floor(Math.random() * counts.length)]!
  }

  /** generateInitialCustomerMessage creates realistic opening messages. */
  private generateInitialCustomerMessage(threadType: string): string {
    const messages = {
      simple: [
        'Hi, I have a quick question about my recent order.',
        'Can you help me track my package?',
        'I need to make a small change to my order.',
      ],
      moderate: [
        'I received my order but there seems to be an issue with one of the items.',
        "I'm having trouble with the product I purchased last week.",
        "The item I received doesn't match what I ordered.",
      ],
      complex: [
        "I've been having ongoing issues with my account and need comprehensive help.",
        'This is a complicated situation involving multiple orders and billing issues.',
        "I've tried everything suggested in your FAQ but the problem persists.",
      ],
    }

    const messageSet = messages[threadType as keyof typeof messages] || messages.simple
    return messageSet[Math.floor(Math.random() * messageSet.length)]!
  }

  /** generateCustomerFollowUp creates follow-up customer messages. */
  private generateCustomerFollowUp(threadType: string, messageIndex: number): string {
    const isEarly = messageIndex < 4

    if (isEarly) {
      return 'Thank you for your response. I have a follow-up question about that.'
    } else {
      return 'I appreciate your help with this issue.'
    }
  }

  /** generateAgentResponse creates realistic agent responses. */
  private generateAgentResponse(
    threadType: string,
    messageIndex: number,
    totalMessages: number
  ): string {
    const isLast = messageIndex === totalMessages - 1

    if (isLast) {
      return "I'm glad we could resolve this issue for you. Please don't hesitate to reach out if you need any additional assistance."
    } else if (messageIndex === 1) {
      return "Thank you for contacting us. I'd be happy to help you with this issue."
    } else {
      return 'I understand your concern. Let me look into that for you and provide some additional information.'
    }
  }

  /** getMessageInterval returns realistic time between messages in milliseconds. */
  private getMessageInterval(threadType: string): number {
    const intervals = {
      simple: 15 * 60 * 1000, // 15 minutes
      moderate: 30 * 60 * 1000, // 30 minutes
      complex: 60 * 60 * 1000, // 1 hour
    }

    return intervals[threadType as keyof typeof intervals] || intervals.simple
  }

  /** getMessageType determines the semantic type of a message. */
  private getMessageType(
    messageIndex: number,
    totalMessages: number,
    isCustomerMessage: boolean
  ): Message['messageType'] {
    if (messageIndex === 0) return 'initial'
    if (messageIndex === totalMessages - 1) return 'resolution'
    if (messageIndex < 3) return 'response'
    return 'follow_up'
  }

  /** getVariantCount returns appropriate variant count per product category. */
  private getVariantCount(productCategory: string): number {
    const variantCounts = {
      Electronics: [1, 2, 3],
      'Clothing & Apparel': [3, 5, 8],
      'Home & Garden': [1, 2, 3],
      'Sports & Outdoor': [2, 3, 4],
    }

    const counts = variantCounts[productCategory as keyof typeof variantCounts] || [1, 2, 3]
    return counts[Math.floor(Math.random() * counts.length)]!
  }

  /** generateVariantAttributes creates appropriate attributes per category. */
  private generateVariantAttributes(
    productCategory: string,
    variantIndex: number
  ): Record<string, string> {
    const attributeMap = {
      Electronics: [
        { color: 'Black', storage: '64GB' },
        { color: 'White', storage: '128GB' },
        { color: 'Blue', storage: '256GB' },
      ],
      'Clothing & Apparel': [
        { size: 'S', color: 'Red' },
        { size: 'M', color: 'Blue' },
        { size: 'L', color: 'Black' },
        { size: 'XL', color: 'White' },
        { size: 'S', color: 'Green' },
      ],
      'Home & Garden': [
        { material: 'Wood', finish: 'Natural' },
        { material: 'Metal', finish: 'Black' },
        { material: 'Plastic', finish: 'White' },
      ],
    }

    const attributes = attributeMap[productCategory as keyof typeof attributeMap] || [
      { variant: `Option ${variantIndex + 1}` },
    ]
    return attributes[variantIndex % attributes.length] || attributes[0]!
  }

  /** generateVariantTitle creates descriptive variant names. */
  private generateVariantTitle(attributes: Record<string, string>): string {
    const attributeStrings = Object.entries(attributes)
      .map(([key, value]) => `${value}`)
      .join(' ')
    return attributeStrings || 'Standard'
  }

  /** getVariantPriceMultiplier adjusts price based on variant attributes. */
  private getVariantPriceMultiplier(attributes: Record<string, string>): number {
    let multiplier = 1.0

    // Adjust based on storage
    if (attributes.storage === '128GB') multiplier *= 1.2
    if (attributes.storage === '256GB') multiplier *= 1.5

    // Adjust based on size
    if (attributes.size === 'XL') multiplier *= 1.1

    // Adjust based on material
    if (attributes.material === 'Wood') multiplier *= 1.3
    if (attributes.material === 'Metal') multiplier *= 1.2

    return multiplier
  }

  /** generateVariantInventory creates realistic inventory levels. */
  private generateVariantInventory(): number {
    const inventoryRanges = [
      { min: 0, max: 5, weight: 0.1 }, // Low stock
      { min: 5, max: 25, weight: 0.3 }, // Medium stock
      { min: 25, max: 100, weight: 0.5 }, // Good stock
      { min: 100, max: 500, weight: 0.1 }, // High stock
    ]

    const random = Math.random()
    let weightSum = 0

    for (const range of inventoryRanges) {
      weightSum += range.weight
      if (random <= weightSum) {
        return Math.floor(Math.random() * (range.max - range.min + 1)) + range.min
      }
    }

    return 50 // Fallback
  }

  /** createDepartments builds realistic organizational departments. */
  private createDepartments(
    agents: string[],
    regularUsers: string[]
  ): Array<{
    name: string
    members: string[]
    lead: string
  }> {
    const departments = [
      { name: 'Customer Support', ratio: 0.6 },
      { name: 'Sales', ratio: 0.2 },
      { name: 'Technical', ratio: 0.1 },
      { name: 'Management', ratio: 0.1 },
    ]

    const allUsers = [...agents, ...regularUsers]
    const result: Array<{ name: string; members: string[]; lead: string }> = []
    let userIndex = 0

    for (const dept of departments) {
      const memberCount = Math.max(1, Math.floor(allUsers.length * dept.ratio))
      const members = allUsers.slice(userIndex, userIndex + memberCount)

      if (members.length > 0) {
        result.push({
          name: dept.name,
          members: members.slice(1), // Exclude lead from members
          lead: members[0]!, // First user is department lead
        })
        userIndex += memberCount
      }
    }

    return result
  }
}
