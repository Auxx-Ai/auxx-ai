// packages/seed/src/generators/analytics.generator.ts
// Helpers for crafting analytics metrics during seeding

/** AnalyticsGenerator crafts synthetic metrics for dashboards. */
export class AnalyticsGenerator {
  /**
   * customerSatisfaction returns a canned satisfaction score set.
   * @returns Object describing satisfaction metrics.
   */
  static customerSatisfaction(): { score: number; trend: 'up' | 'down' | 'flat' } {
    return { score: 94, trend: 'up' }
  }

  /**
   * responseTime returns a seeded average response time metric.
   * @returns Object describing response time performance in minutes.
   */
  static responseTime(): { averageMinutes: number; percentile90: number } {
    return { averageMinutes: 12, percentile90: 25 }
  }
}
