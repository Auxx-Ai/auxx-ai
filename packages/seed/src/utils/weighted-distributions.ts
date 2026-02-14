// packages/seed/src/utils/weighted-distributions.ts
// Utility helpers that describe weighted distributions for realistic synthetic data

/** WeightedDistributionEntry describes a weighted value entry. */
export interface WeightedDistributionEntry<T> {
  /** weight is the relative probability weight. */
  weight: number
  /** value holds either a scalar or structured bucket definition. */
  value: T
}

/** WeightedDistributions centralizes common probability distributions used by generators. */
export class WeightedDistributions {
  /** customerSpending models realistic e-commerce customer lifetime spend buckets. */
  static customerSpending(): Array<
    WeightedDistributionEntry<{ minValue: number; maxValue: number }>
  > {
    return [
      { weight: 0.4, value: { minValue: 0, maxValue: 5000 } },
      { weight: 0.3, value: { minValue: 5000, maxValue: 20000 } },
      { weight: 0.2, value: { minValue: 20000, maxValue: 50000 } },
      { weight: 0.08, value: { minValue: 50000, maxValue: 100000 } },
      { weight: 0.02, value: { minValue: 100000, maxValue: 500000 } },
    ]
  }

  /** ticketPriority models the distribution of support ticket urgency. */
  static ticketPriority(): Array<WeightedDistributionEntry<string>> {
    return [
      { weight: 0.6, value: 'low' },
      { weight: 0.25, value: 'medium' },
      { weight: 0.12, value: 'high' },
      { weight: 0.03, value: 'urgent' },
    ]
  }

  /** userActivity describes how recently users interact with the platform. */
  static userActivity(): Array<WeightedDistributionEntry<string>> {
    return [
      { weight: 0.3, value: 'today' },
      { weight: 0.25, value: 'this_week' },
      { weight: 0.2, value: 'this_month' },
      { weight: 0.15, value: 'last_month' },
      { weight: 0.1, value: 'older' },
    ]
  }

  /** aiConfidence models typical AI confidence scores for predictions. */
  static aiConfidence(): Array<WeightedDistributionEntry<{ minValue: number; maxValue: number }>> {
    return [
      { weight: 0.1, value: { minValue: 0.5, maxValue: 0.65 } },
      { weight: 0.2, value: { minValue: 0.65, maxValue: 0.8 } },
      { weight: 0.5, value: { minValue: 0.8, maxValue: 0.95 } },
      { weight: 0.2, value: { minValue: 0.95, maxValue: 1 } },
    ]
  }
}
