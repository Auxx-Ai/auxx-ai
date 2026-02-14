// packages/seed/src/generators/content.generator.ts
// Utilities for generating domain-specific narrative content used during seeding

/** ContentGenerator exposes helper routines for crafting rich textual content. */
export class ContentGenerator {
  /**
   * supportConversation returns templated support conversation snippets.
   * @param scenario - Scenario identifier describing the conversation type.
   * @returns Conversation message sequence templates.
   */
  static supportConversation(scenario: 'order' | 'product' | 'return' | 'billing'): string[] {
    const templates: Record<typeof scenario, string[]> = {
      order: [
        'Hi, I have not received order #{{orderNumber}} yet. Could you help me track it?',
        "Thank you for contacting us! I've located your order and will share the tracking details shortly.",
        'Great, thanks for the update! I will watch for the email.',
        'Happy to help! Please let me know if anything else comes up.',
      ],
      product: [
        "I'm having trouble with the {{productName}} I just received.",
        "I'm sorry to hear that. Let me walk you through a few troubleshooting steps for the {{productName}}.",
        'The feature still is not working as expected.',
        'Thanks for checking. I am escalating this for a replacement immediately.',
      ],
      return: [
        "I'd like to return order #{{orderNumber}}. It did not fit correctly.",
        'I can help with that! I will send you a prepaid return label right away.',
        'Thanks! When will the refund arrive?',
        'Refunds typically process within 3-5 business days after the item is scanned in.',
      ],
      billing: [
        'I noticed a duplicate charge on my last invoice.',
        'Thanks for flagging that. I will review the transaction history and get back to you shortly.',
        'Appreciate it. Please let me know when it is resolved.',
        'Absolutely! I will follow up by the end of the day.',
      ],
    }

    return templates[scenario]
  }

  /**
   * productDescription builds a rich HTML snippet describing a product.
   * @param category - Product category used to tailor features and benefits.
   * @param productName - Product name surfaced within the snippet.
   * @returns HTML string representing a product description block.
   */
  static productDescription(category: string, productName: string): string {
    const features = ContentGenerator.getProductFeatures(category)
    const benefits = ContentGenerator.getProductBenefits(category)

    return `
      <div class="product-description">
        <h3>${productName}</h3>
        <p>Experience the perfect blend of ${features.join(', ')} in this premium ${category.toLowerCase()}.</p>
        <h4>Key Features:</h4>
        <ul>
          ${features
            .slice(0, 4)
            .map((feature) => `<li>${feature}</li>`)
            .join('')}
        </ul>
        <h4>Benefits:</h4>
        <ul>
          ${benefits
            .slice(0, 3)
            .map((benefit) => `<li>${benefit}</li>`)
            .join('')}
        </ul>
        <p class="warranty">Includes 1-year warranty and 30-day money-back guarantee.</p>
      </div>
    `.trim()
  }

  /**
   * getProductFeatures returns feature bullet candidates per category.
   * @param category - Product category key.
   * @returns Array of feature phrases.
   */
  private static getProductFeatures(category: string): string[] {
    const normalized = category.toLowerCase()
    const featureMap: Record<string, string[]> = {
      electronics: [
        'Advanced technology',
        'Energy efficient',
        'User-friendly interface',
        'Durable construction',
      ],
      clothing: [
        'Premium materials',
        'Comfortable fit',
        'Stylish design',
        'Easy care instructions',
      ],
      home: [
        'Space-saving design',
        'Easy installation',
        'Long-lasting materials',
        'Aesthetic appeal',
      ],
    }

    return featureMap[normalized] ?? ['High quality', 'Reliable performance', 'Great value']
  }

  /**
   * getProductBenefits returns benefit bullet candidates per category.
   * @param category - Product category key.
   * @returns Array of benefit phrases.
   */
  private static getProductBenefits(category: string): string[] {
    const normalized = category.toLowerCase()
    const benefitMap: Record<string, string[]> = {
      electronics: [
        'Boost productivity',
        'Stay connected on the go',
        'Seamless integration with existing tools',
      ],
      clothing: [
        'Feel confident all day',
        'Versatile styling options',
        'Designed for everyday comfort',
      ],
      home: ['Enhance your living space', 'Reduce maintenance costs', 'Built to last for years'],
    }

    return (
      benefitMap[normalized] ?? [
        'Enhance daily workflows',
        'Trusted by modern teams',
        'Delivers consistent value',
      ]
    )
  }
}
