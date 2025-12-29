// packages/seed/src/utils/relationship-builder.ts
// Helper for building relationships between seeded entities

/** RelationshipBuilder offers convenience helpers for associating seeded entities. */
export class RelationshipBuilder {
  /** rng is the random number generator function. */
  private readonly rng: () => number

  /**
   * Creates a new relationship builder.
   * @param rng - Optional random function to support deterministic seeding.
   */
  constructor(rng: () => number = Math.random) {
    this.rng = rng
  }

  /**
   * pickOne selects a random element from the provided list.
   * @param values - Candidate values to choose from.
   * @returns The chosen value or undefined when the list is empty.
   */
  pickOne<T>(values: T[]): T | undefined {
    if (values.length === 0) return undefined
    const index = Math.floor(this.rng() * values.length)
    return values[index]
  }

  /**
   * pickMany selects a subset of values up to the specified maximum.
   * @param values - Candidate values to sample from.
   * @param max - Maximum number of elements to return.
   * @returns Sampled values without replacement.
   */
  pickMany<T>(values: T[], max: number): T[] {
    if (values.length === 0 || max <= 0) return []
    const pool = [...values]
    const count = Math.min(max, pool.length)
    const selected: T[] = []

    for (let i = 0; i < count; i++) {
      const index = Math.floor(this.rng() * pool.length)
      selected.push(pool.splice(index, 1)[0])
    }

    return selected
  }
}
