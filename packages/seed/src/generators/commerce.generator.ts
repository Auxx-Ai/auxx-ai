// packages/seed/src/generators/commerce.generator.ts
// Commerce-specific helper routines for seed data generation

/** CommerceGenerator exposes helpers for product metadata. */
export class CommerceGenerator {
  /**
   * productTags returns curated product tags suited for e-commerce catalogs.
   * @returns Array of tag arrays representing different combinations.
   */
  static productTags(): string[][] {
    return [
      ['electronics', 'bestseller'],
      ['clothing', 'new-arrival'],
      ['home', 'eco-friendly'],
      ['sports', 'limited-edition'],
      ['holiday', 'gift-guide'],
    ]
  }
}
