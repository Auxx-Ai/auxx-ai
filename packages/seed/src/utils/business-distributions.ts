// packages/seed/src/utils/business-distributions.ts
// Realistic business data distributions based on industry patterns

import type { ScenarioDataQuality } from '../types'

/** WeightedDistribution represents a value with its probability weight. */
export interface WeightedDistribution<T = string | number> {
  value: T
  weight: number
  description?: string
}

/** BusinessDistributions provides realistic data distributions for business scenarios. */
export class BusinessDistributions {
  /** quality settings control distribution realism */
  private readonly quality: ScenarioDataQuality

  /**
   * Creates a new BusinessDistributions instance.
   * @param quality - Quality settings controlling distribution complexity.
   */
  constructor(quality: ScenarioDataQuality) {
    this.quality = quality
  }

  /**
   * getCustomerOrderFrequency returns realistic customer ordering patterns.
   * @returns Distribution of order frequencies in days.
   */
  getCustomerOrderFrequency(): WeightedDistribution<number>[] {
    return [
      { value: 7, weight: 0.05, description: 'Weekly (power users)' },
      { value: 14, weight: 0.1, description: 'Bi-weekly (frequent)' },
      { value: 30, weight: 0.25, description: 'Monthly (regular)' },
      { value: 60, weight: 0.3, description: 'Bi-monthly (typical)' },
      { value: 90, weight: 0.2, description: 'Quarterly (occasional)' },
      { value: 180, weight: 0.1, description: 'Semi-annual (rare)' },
    ]
  }

  /**
   * getSupportTicketPriorities returns realistic support ticket priority distribution.
   * @returns Distribution of ticket priorities.
   */
  getSupportTicketPriorities(): WeightedDistribution<'low' | 'medium' | 'high' | 'urgent'>[] {
    return [
      { value: 'low', weight: 0.4, description: 'General inquiries, non-urgent' },
      { value: 'medium', weight: 0.35, description: 'Standard issues, needs attention' },
      { value: 'high', weight: 0.2, description: 'Important issues, quick response needed' },
      { value: 'urgent', weight: 0.05, description: 'Critical issues, immediate attention' },
    ]
  }

  /**
   * getProductCategoryMix returns realistic product category distribution for e-commerce.
   * @returns Distribution of product categories.
   */
  getProductCategoryMix(): WeightedDistribution<string>[] {
    return [
      { value: 'Electronics', weight: 0.2, description: 'Tech products, gadgets' },
      { value: 'Clothing & Apparel', weight: 0.25, description: 'Fashion, accessories' },
      { value: 'Home & Garden', weight: 0.15, description: 'Home improvement, decor' },
      { value: 'Sports & Outdoor', weight: 0.1, description: 'Fitness, outdoor gear' },
      { value: 'Books & Media', weight: 0.08, description: 'Books, entertainment' },
      { value: 'Health & Beauty', weight: 0.12, description: 'Personal care, wellness' },
      { value: 'Automotive', weight: 0.05, description: 'Car parts, accessories' },
      { value: 'Pet Supplies', weight: 0.05, description: 'Pet food, toys, accessories' },
    ]
  }

  /**
   * getSeasonalOrderPatterns returns monthly order volume multipliers.
   * @returns Distribution of seasonal ordering patterns.
   */
  getSeasonalOrderPatterns(): WeightedDistribution<{ month: number; multiplier: number }>[] {
    return [
      {
        value: { month: 1, multiplier: 0.8 },
        weight: 1,
        description: 'January - Post-holiday lull',
      },
      {
        value: { month: 2, multiplier: 0.9 },
        weight: 1,
        description: "February - Valentine's boost",
      },
      {
        value: { month: 3, multiplier: 1.0 },
        weight: 1,
        description: 'March - Spring preparation',
      },
      { value: { month: 4, multiplier: 1.1 }, weight: 1, description: 'April - Spring shopping' },
      {
        value: { month: 5, multiplier: 1.2 },
        weight: 1,
        description: "May - Mother's Day, graduation",
      },
      { value: { month: 6, multiplier: 1.1 }, weight: 1, description: 'June - Summer preparation' },
      { value: { month: 7, multiplier: 1.0 }, weight: 1, description: 'July - Mid-summer steady' },
      { value: { month: 8, multiplier: 1.1 }, weight: 1, description: 'August - Back-to-school' },
      {
        value: { month: 9, multiplier: 1.2 },
        weight: 1,
        description: 'September - Fall preparation',
      },
      {
        value: { month: 10, multiplier: 1.3 },
        weight: 1,
        description: 'October - Halloween, pre-holiday',
      },
      {
        value: { month: 11, multiplier: 1.8 },
        weight: 1,
        description: 'November - Black Friday, Thanksgiving',
      },
      { value: { month: 12, multiplier: 2.0 }, weight: 1, description: 'December - Holiday peak' },
    ]
  }

  /**
   * getOrderValueDistribution returns realistic order value patterns.
   * @returns Distribution of order values in USD.
   */
  getOrderValueDistribution(): WeightedDistribution<{ min: number; max: number }>[] {
    return [
      { value: { min: 5, max: 25 }, weight: 0.2, description: 'Small purchases' },
      { value: { min: 25, max: 75 }, weight: 0.35, description: 'Typical orders' },
      { value: { min: 75, max: 150 }, weight: 0.25, description: 'Medium orders' },
      { value: { min: 150, max: 300 }, weight: 0.15, description: 'Large orders' },
      { value: { min: 300, max: 1000 }, weight: 0.04, description: 'Premium orders' },
      { value: { min: 1000, max: 5000 }, weight: 0.01, description: 'Enterprise/bulk orders' },
    ]
  }

  /**
   * getCustomerSegmentDistribution returns realistic customer segment breakdown.
   * @returns Distribution of customer types.
   */
  getCustomerSegmentDistribution(): WeightedDistribution<{
    segment: 'new' | 'occasional' | 'regular' | 'loyal' | 'vip'
    orderFrequency: number
    avgOrderValue: number
  }>[] {
    return [
      {
        value: { segment: 'new', orderFrequency: 365, avgOrderValue: 45 },
        weight: 0.3,
        description: 'First-time customers',
      },
      {
        value: { segment: 'occasional', orderFrequency: 180, avgOrderValue: 65 },
        weight: 0.25,
        description: 'Infrequent purchasers',
      },
      {
        value: { segment: 'regular', orderFrequency: 60, avgOrderValue: 85 },
        weight: 0.25,
        description: 'Regular customers',
      },
      {
        value: { segment: 'loyal', orderFrequency: 30, avgOrderValue: 120 },
        weight: 0.15,
        description: 'Loyal repeat customers',
      },
      {
        value: { segment: 'vip', orderFrequency: 14, avgOrderValue: 250 },
        weight: 0.05,
        description: 'VIP high-value customers',
      },
    ]
  }

  /**
   * getSupportResolutionTimes returns realistic support resolution patterns.
   * @returns Distribution of resolution times in hours.
   */
  getSupportResolutionTimes(): WeightedDistribution<number>[] {
    return [
      { value: 0.5, weight: 0.15, description: 'Immediate (< 30 min)' },
      { value: 2, weight: 0.25, description: 'Same day (< 2 hours)' },
      { value: 8, weight: 0.3, description: 'Within business day' },
      { value: 24, weight: 0.2, description: 'Next business day' },
      { value: 72, weight: 0.08, description: 'Within 3 days' },
      { value: 168, weight: 0.02, description: 'Within a week' },
    ]
  }

  /**
   * getThreadComplexityDistribution returns realistic support thread complexity.
   * @returns Distribution of thread complexity levels.
   */
  getThreadComplexityDistribution(): WeightedDistribution<{
    complexity: 'simple' | 'moderate' | 'complex'
    messageCount: number
    resolutionTime: number
  }>[] {
    return [
      {
        value: { complexity: 'simple', messageCount: 3, resolutionTime: 2 },
        weight: 0.5,
        description: 'Quick FAQ-style questions',
      },
      {
        value: { complexity: 'moderate', messageCount: 6, resolutionTime: 8 },
        weight: 0.35,
        description: 'Standard troubleshooting',
      },
      {
        value: { complexity: 'complex', messageCount: 12, resolutionTime: 24 },
        weight: 0.15,
        description: 'Multi-step problem solving',
      },
    ]
  }

  /**
   * getProductPopularityDistribution returns realistic product demand patterns.
   * @returns Distribution of product popularity levels.
   */
  getProductPopularityDistribution(): WeightedDistribution<{
    tier: 'bestseller' | 'popular' | 'average' | 'niche'
    salesMultiplier: number
    viewsMultiplier: number
  }>[] {
    return [
      {
        value: { tier: 'bestseller', salesMultiplier: 5.0, viewsMultiplier: 10.0 },
        weight: 0.05,
        description: 'Top 5% high-demand products',
      },
      {
        value: { tier: 'popular', salesMultiplier: 2.5, viewsMultiplier: 4.0 },
        weight: 0.2,
        description: 'Popular items with good sales',
      },
      {
        value: { tier: 'average', salesMultiplier: 1.0, viewsMultiplier: 1.0 },
        weight: 0.6,
        description: 'Standard catalog items',
      },
      {
        value: { tier: 'niche', salesMultiplier: 0.3, viewsMultiplier: 0.5 },
        weight: 0.15,
        description: 'Specialized or slow-moving items',
      },
    ]
  }

  /**
   * getEmailResponseTimes returns realistic email response patterns.
   * @returns Distribution of email response times in hours.
   */
  getEmailResponseTimes(): WeightedDistribution<number>[] {
    return [
      { value: 0.25, weight: 0.1, description: 'Immediate (< 15 min)' },
      { value: 1, weight: 0.2, description: 'Within an hour' },
      { value: 4, weight: 0.3, description: 'Same business day' },
      { value: 24, weight: 0.25, description: 'Next business day' },
      { value: 48, weight: 0.1, description: 'Within 2 days' },
      { value: 72, weight: 0.05, description: 'Within 3 days' },
    ]
  }

  /**
   * getInventoryLevels returns realistic inventory distribution patterns.
   * @returns Distribution of inventory levels.
   */
  getInventoryLevels(): WeightedDistribution<{
    level: 'out_of_stock' | 'low' | 'medium' | 'high' | 'overstocked'
    quantity: number
    reorderPoint: number
  }>[] {
    return [
      {
        value: { level: 'out_of_stock', quantity: 0, reorderPoint: 5 },
        weight: 0.05,
        description: 'Temporarily out of stock',
      },
      {
        value: { level: 'low', quantity: 8, reorderPoint: 10 },
        weight: 0.15,
        description: 'Low stock, needs reorder',
      },
      {
        value: { level: 'medium', quantity: 45, reorderPoint: 20 },
        weight: 0.5,
        description: 'Healthy stock levels',
      },
      {
        value: { level: 'high', quantity: 150, reorderPoint: 50 },
        weight: 0.25,
        description: 'Well-stocked items',
      },
      {
        value: { level: 'overstocked', quantity: 500, reorderPoint: 100 },
        weight: 0.05,
        description: 'Excess inventory',
      },
    ]
  }

  /**
   * getWorkflowExecutionPatterns returns realistic automation patterns.
   * @returns Distribution of workflow execution frequencies.
   */
  getWorkflowExecutionPatterns(): WeightedDistribution<{
    frequency: 'high' | 'medium' | 'low'
    executionsPerDay: number
    successRate: number
  }>[] {
    return [
      {
        value: { frequency: 'high', executionsPerDay: 50, successRate: 0.95 },
        weight: 0.2,
        description: 'High-frequency automations',
      },
      {
        value: { frequency: 'medium', executionsPerDay: 15, successRate: 0.92 },
        weight: 0.5,
        description: 'Regular workflow executions',
      },
      {
        value: { frequency: 'low', executionsPerDay: 3, successRate: 0.88 },
        weight: 0.3,
        description: 'Occasional or complex workflows',
      },
    ]
  }

  /**
   * selectWeightedValue performs weighted random selection from distribution.
   * @param distribution - Array of weighted values to select from.
   * @param seed - Optional seed for deterministic selection.
   * @returns Selected value from distribution.
   */
  selectWeightedValue<T>(distribution: WeightedDistribution<T>[], seed?: number): T {
    const random = seed !== undefined ? this.seededRandom(seed) : Math.random()
    let weightSum = 0
    const totalWeight = distribution.reduce((sum, item) => sum + item.weight, 0)

    for (const item of distribution) {
      weightSum += item.weight
      if (random <= weightSum / totalWeight) {
        return item.value
      }
    }

    // Fallback to last item
    return distribution[distribution.length - 1]!.value
  }

  /**
   * generateValueInRange generates a value within the specified range.
   * @param min - Minimum value.
   * @param max - Maximum value.
   * @param seed - Optional seed for deterministic generation.
   * @returns Generated value within range.
   */
  generateValueInRange(min: number, max: number, seed?: number): number {
    const random = seed !== undefined ? this.seededRandom(seed) : Math.random()
    return Math.floor(random * (max - min + 1)) + min
  }

  /**
   * applyBusinessSeasonality applies seasonal adjustments to values.
   * @param baseValue - Base value to adjust.
   * @param month - Month (0-11) for seasonal adjustment.
   * @returns Seasonally adjusted value.
   */
  applyBusinessSeasonality(baseValue: number, month: number): number {
    const seasonalPattern = this.getSeasonalOrderPatterns()
    const seasonalData = seasonalPattern.find((p) => p.value.month === month + 1)
    const multiplier = seasonalData?.value.multiplier || 1.0

    return Math.round(baseValue * multiplier)
  }

  /**
   * generateRealisticTimestamp creates business-hours-weighted timestamps.
   * @param baseDate - Base date for timestamp generation.
   * @param businessHoursOnly - Whether to restrict to business hours.
   * @returns Generated timestamp.
   */
  generateRealisticTimestamp(baseDate: Date, businessHoursOnly = false): Date {
    const date = new Date(baseDate)

    if (businessHoursOnly) {
      // Business hours: 9 AM - 5 PM, Monday-Friday
      const businessStart = 9
      const businessEnd = 17
      const hour = this.generateValueInRange(businessStart, businessEnd - 1)

      date.setHours(hour, Math.floor(Math.random() * 60), Math.floor(Math.random() * 60))

      // Ensure weekday
      while (date.getDay() === 0 || date.getDay() === 6) {
        date.setDate(date.getDate() + 1)
      }
    } else {
      // 24/7 with business hours bias (70% during business hours)
      const duringBusinessHours = Math.random() < 0.7

      if (duringBusinessHours) {
        const hour = this.generateValueInRange(9, 17)
        date.setHours(hour, Math.floor(Math.random() * 60))
      } else {
        const hour = this.generateValueInRange(0, 23)
        date.setHours(hour, Math.floor(Math.random() * 60))
      }
    }

    return date
  }

  /** seededRandom generates deterministic random numbers based on seed. */
  private seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000
    return x - Math.floor(x)
  }
}
