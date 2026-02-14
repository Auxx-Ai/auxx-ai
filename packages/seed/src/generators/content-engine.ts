// packages/seed/src/generators/content-engine.ts
// Advanced content generation engine for realistic business data

import type { ScenarioDataQuality } from '../types'

/** EmailContent represents a generated email with realistic business context. */
export interface EmailContent {
  /** subject line for the email */
  subject: string
  /** body content of the email */
  body: string
  /** tone/sentiment of the email */
  tone: 'urgent' | 'neutral' | 'positive' | 'frustrated' | 'grateful'
  /** business category this email belongs to */
  category:
    | 'order_inquiry'
    | 'shipping'
    | 'returns'
    | 'product_question'
    | 'complaint'
    | 'compliment'
}

/** CustomerInquiry represents a realistic customer support request. */
export interface CustomerInquiry {
  /** main inquiry text */
  inquiry: string
  /** urgency level */
  priority: 'low' | 'medium' | 'high' | 'urgent'
  /** type of inquiry */
  type: 'pre_sale' | 'post_sale' | 'technical' | 'billing' | 'general'
  /** expected response complexity */
  complexity: 'simple' | 'moderate' | 'complex'
}

/** ProductDescription represents realistic e-commerce product data. */
export interface ProductDescription {
  /** product name */
  name: string
  /** detailed description */
  description: string
  /** short marketing tagline */
  tagline: string
  /** product category */
  category: string
  /** price range tier */
  priceRange: 'budget' | 'mid' | 'premium' | 'luxury'
}

/** SupportResponse represents a realistic customer service reply. */
export interface SupportResponse {
  /** response text */
  response: string
  /** tone of the response */
  tone: 'helpful' | 'apologetic' | 'informative' | 'escalation'
  /** estimated resolution time */
  resolutionTime: 'immediate' | 'same_day' | 'next_day' | 'week'
}

/** ContentEngine generates realistic business content based on scenario requirements. */
export class ContentEngine {
  /** quality settings for content generation */
  private readonly quality: ScenarioDataQuality

  /**
   * Creates a new ContentEngine instance.
   * @param quality - Quality settings controlling content realism.
   */
  constructor(quality: ScenarioDataQuality) {
    this.quality = quality
  }

  /**
   * generateRealisticEmails creates email content for various business scenarios.
   * @param count - Number of emails to generate.
   * @returns Array of realistic email content.
   */
  generateRealisticEmails(count: number): EmailContent[] {
    const emails: EmailContent[] = []

    for (let i = 0; i < count; i++) {
      const category = this.selectEmailCategory()
      const tone = this.selectEmailTone(category)
      const template = this.getEmailTemplate(category, tone)

      emails.push({
        subject: this.generateSubject(category, tone),
        body: this.generateEmailBody(template, category),
        tone,
        category,
      })
    }

    return emails
  }

  /**
   * generateCustomerInquiries creates realistic support requests.
   * @param count - Number of inquiries to generate.
   * @returns Array of customer inquiries.
   */
  generateCustomerInquiries(count: number): CustomerInquiry[] {
    const inquiries: CustomerInquiry[] = []

    for (let i = 0; i < count; i++) {
      const type = this.selectInquiryType()
      const priority = this.selectInquiryPriority(type)
      const complexity = this.selectInquiryComplexity(type, priority)

      inquiries.push({
        inquiry: this.generateInquiryText(type, priority, complexity),
        priority,
        type,
        complexity,
      })
    }

    return inquiries
  }

  /**
   * generateProductDescriptions creates realistic product catalog content.
   * @param count - Number of products to generate.
   * @returns Array of product descriptions.
   */
  generateProductDescriptions(count: number): ProductDescription[] {
    const products: ProductDescription[] = []

    for (let i = 0; i < count; i++) {
      const category = this.selectProductCategory()
      const priceRange = this.selectPriceRange()
      const name = this.generateProductName(category, priceRange)

      products.push({
        name,
        description: this.generateProductDescription(name, category, priceRange),
        tagline: this.generateProductTagline(name, category),
        category,
        priceRange,
      })
    }

    return products
  }

  /**
   * generateSupportResponses creates realistic customer service replies.
   * @param inquiries - Customer inquiries to respond to.
   * @returns Array of support responses.
   */
  generateSupportResponses(inquiries: CustomerInquiry[]): SupportResponse[] {
    return inquiries.map((inquiry) => {
      const tone = this.selectResponseTone(inquiry.priority, inquiry.type)
      const resolutionTime = this.selectResolutionTime(inquiry.complexity, inquiry.priority)

      return {
        response: this.generateResponseText(inquiry, tone),
        tone,
        resolutionTime,
      }
    })
  }

  /** selectEmailCategory chooses appropriate email categories based on business context. */
  private selectEmailCategory(): EmailContent['category'] {
    const categories: EmailContent['category'][] = [
      'order_inquiry',
      'shipping',
      'returns',
      'product_question',
      'complaint',
      'compliment',
    ]
    const weights = [0.25, 0.2, 0.15, 0.2, 0.15, 0.05] // Realistic distribution

    return this.weightedSelect(categories, weights)
  }

  /** selectEmailTone chooses appropriate tone based on email category. */
  private selectEmailTone(category: EmailContent['category']): EmailContent['tone'] {
    const toneMap: Record<EmailContent['category'], EmailContent['tone'][]> = {
      order_inquiry: ['neutral', 'urgent'],
      shipping: ['neutral', 'frustrated', 'urgent'],
      returns: ['frustrated', 'neutral'],
      product_question: ['neutral', 'positive'],
      complaint: ['frustrated', 'urgent'],
      compliment: ['positive', 'grateful'],
    }

    const tones = toneMap[category]
    return tones[Math.floor(Math.random() * tones.length)]!
  }

  /** generateSubject creates realistic email subject lines. */
  private generateSubject(category: EmailContent['category'], tone: EmailContent['tone']): string {
    const subjectTemplates: Record<EmailContent['category'], string[]> = {
      order_inquiry: [
        'Question about my recent order #{{orderNumber}}',
        'Order status update needed',
        'When will my order ship?',
        'Order #{{orderNumber}} - delivery question',
      ],
      shipping: [
        'Shipping delay notification',
        'Package delivery issue',
        'Tracking number not working',
        'Expected delivery date passed',
      ],
      returns: [
        'Return request for order #{{orderNumber}}',
        'Product return - defective item',
        'Refund request',
        'Return label needed',
      ],
      product_question: [
        'Product compatibility question',
        'Sizing information needed',
        'Product specifications inquiry',
        'Is this product available?',
      ],
      complaint: [
        'Urgent: Poor customer service experience',
        'Complaint about recent order',
        'Disappointed with product quality',
        'Billing issue needs immediate attention',
      ],
      compliment: [
        'Excellent customer service!',
        'Thank you for the quick resolution',
        'Great product quality',
        'Impressed with your service',
      ],
    }

    const templates = subjectTemplates[category]
    const template = templates[Math.floor(Math.random() * templates.length)]!

    return template.replace(
      '{{orderNumber}}',
      `ORD-${Math.floor(Math.random() * 10000)
        .toString()
        .padStart(4, '0')}`
    )
  }

  /** getEmailTemplate selects appropriate email template structure. */
  private getEmailTemplate(category: EmailContent['category'], tone: EmailContent['tone']): string {
    const templates: Record<string, string[]> = {
      order_inquiry_neutral: [
        'Hi there,\n\nI placed an order recently and wanted to check on the status. Could you please provide an update?\n\nThanks!',
        "Hello,\n\nI'm writing to inquire about my recent order. When can I expect it to ship?\n\nBest regards,",
      ],
      shipping_frustrated: [
        "Hello,\n\nI'm frustrated that my package hasn't arrived yet. The tracking shows it was supposed to be delivered yesterday. What's going on?\n\nPlease resolve this quickly.",
        'Hi,\n\nThis is unacceptable. My order is now 3 days late and I need it urgently. Please explain what happened and when I can expect delivery.',
      ],
      complaint_urgent: [
        'URGENT: I need to speak with a manager immediately. The customer service I received today was completely unacceptable.',
        "This is urgent. I've been trying to resolve this issue for weeks and no one seems to care about helping customers.",
      ],
      compliment_positive: [
        'I just wanted to take a moment to say how impressed I am with your customer service. Thank you!',
        'Excellent service! The representative I spoke with went above and beyond to help me.',
      ],
    }

    const key = `${category}_${tone}`
    const templateSet = templates[key] || templates['order_inquiry_neutral']!
    return templateSet[Math.floor(Math.random() * templateSet.length)]!
  }

  /** generateEmailBody creates full email content from templates. */
  private generateEmailBody(template: string, category: EmailContent['category']): string {
    return template
  }

  /** selectInquiryType chooses realistic inquiry types. */
  private selectInquiryType(): CustomerInquiry['type'] {
    const types: CustomerInquiry['type'][] = [
      'pre_sale',
      'post_sale',
      'technical',
      'billing',
      'general',
    ]
    const weights = [0.2, 0.35, 0.2, 0.15, 0.1]

    return this.weightedSelect(types, weights)
  }

  /** selectInquiryPriority determines priority based on inquiry type. */
  private selectInquiryPriority(type: CustomerInquiry['type']): CustomerInquiry['priority'] {
    const priorityMap: Record<CustomerInquiry['type'], CustomerInquiry['priority'][]> = {
      pre_sale: ['low', 'medium'],
      post_sale: ['medium', 'high'],
      technical: ['medium', 'high', 'urgent'],
      billing: ['high', 'urgent'],
      general: ['low', 'medium'],
    }

    const priorities = priorityMap[type]
    return priorities[Math.floor(Math.random() * priorities.length)]!
  }

  /** selectInquiryComplexity determines complexity based on type and priority. */
  private selectInquiryComplexity(
    type: CustomerInquiry['type'],
    priority: CustomerInquiry['priority']
  ): CustomerInquiry['complexity'] {
    if (priority === 'urgent') return 'complex'
    if (type === 'technical') return Math.random() > 0.5 ? 'complex' : 'moderate'
    if (type === 'general') return 'simple'

    return Math.random() > 0.7 ? 'complex' : 'moderate'
  }

  /** generateInquiryText creates realistic inquiry content. */
  private generateInquiryText(
    type: CustomerInquiry['type'],
    priority: CustomerInquiry['priority'],
    complexity: CustomerInquiry['complexity']
  ): string {
    const inquiryTemplates: Record<CustomerInquiry['type'], string[]> = {
      pre_sale: [
        "I'm interested in purchasing your product but have some questions about compatibility.",
        'Can you help me choose the right size/model for my needs?',
        "What's the difference between these two products?",
      ],
      post_sale: [
        "I received my order but it's not what I expected. Can we discuss options?",
        'The product I received seems to be defective. What are my next steps?',
        'I need help setting up the product I just purchased.',
      ],
      technical: [
        "I'm having trouble with the technical setup and need guidance.",
        "The product isn't working as described in the manual.",
        'There seems to be a compatibility issue with my system.',
      ],
      billing: [
        'I was charged twice for the same order. Please review my account.',
        "The amount on my credit card doesn't match what I expected to pay.",
        'I need a detailed breakdown of the charges on my account.',
      ],
      general: [
        'I have a general question about your company policies.',
        'When do you typically restock popular items?',
        "I'd like to provide some feedback about my experience.",
      ],
    }

    const templates = inquiryTemplates[type]
    return templates[Math.floor(Math.random() * templates.length)]!
  }

  /** selectProductCategory chooses realistic product categories. */
  private selectProductCategory(): string {
    const categories = [
      'Electronics',
      'Clothing & Apparel',
      'Home & Garden',
      'Sports & Outdoor',
      'Books & Media',
      'Health & Beauty',
      'Automotive',
      'Pet Supplies',
      'Office Supplies',
      'Jewelry & Accessories',
    ]

    return categories[Math.floor(Math.random() * categories.length)]!
  }

  /** selectPriceRange chooses appropriate pricing tier. */
  private selectPriceRange(): ProductDescription['priceRange'] {
    const ranges: ProductDescription['priceRange'][] = ['budget', 'mid', 'premium', 'luxury']
    const weights = [0.4, 0.35, 0.2, 0.05] // Realistic market distribution

    return this.weightedSelect(ranges, weights)
  }

  /** generateProductName creates realistic product names. */
  private generateProductName(
    category: string,
    priceRange: ProductDescription['priceRange']
  ): string {
    const prefixes: Record<ProductDescription['priceRange'], string[]> = {
      budget: ['Essential', 'Basic', 'Value', 'Economy'],
      mid: ['Premium', 'Professional', 'Advanced', 'Elite'],
      premium: ['Deluxe', 'Superior', 'Pro', 'Ultra'],
      luxury: ['Platinum', 'Diamond', 'Executive', 'Signature'],
    }

    const productTypes: Record<string, string[]> = {
      Electronics: ['Smartphone', 'Laptop', 'Headphones', 'Tablet', 'Speaker'],
      'Clothing & Apparel': ['T-Shirt', 'Jeans', 'Dress', 'Jacket', 'Sneakers'],
      'Home & Garden': ['Coffee Maker', 'Garden Tool', 'Lamp', 'Vase', 'Pillow'],
      'Sports & Outdoor': ['Running Shoes', 'Backpack', 'Water Bottle', 'Tent', 'Bike'],
    }

    const prefix = prefixes[priceRange][Math.floor(Math.random() * prefixes[priceRange].length)]
    const types = productTypes[category] || ['Product', 'Item', 'Device']
    const type = types[Math.floor(Math.random() * types.length)]

    return `${prefix} ${type}`
  }

  /** generateProductDescription creates detailed product descriptions. */
  private generateProductDescription(
    name: string,
    category: string,
    priceRange: ProductDescription['priceRange']
  ): string {
    const qualityDescriptors: Record<ProductDescription['priceRange'], string[]> = {
      budget: ['affordable', 'practical', 'reliable', 'value-focused'],
      mid: ['high-quality', 'durable', 'feature-rich', 'well-designed'],
      premium: ['exceptional', 'cutting-edge', 'premium-grade', 'top-tier'],
      luxury: ['exquisite', 'handcrafted', 'exclusive', 'world-class'],
    }

    const descriptor =
      qualityDescriptors[priceRange][
        Math.floor(Math.random() * qualityDescriptors[priceRange].length)
      ]

    return `This ${descriptor} ${name.toLowerCase()} combines style and functionality to deliver an outstanding experience. Perfect for those who demand quality and performance in their ${category.toLowerCase()}.`
  }

  /** generateProductTagline creates marketing taglines. */
  private generateProductTagline(name: string, category: string): string {
    const taglines = [
      'Where quality meets affordability',
      'Engineered for excellence',
      'Your perfect companion',
      'Experience the difference',
      'Setting new standards',
    ]

    return taglines[Math.floor(Math.random() * taglines.length)]!
  }

  /** selectResponseTone chooses appropriate response tone. */
  private selectResponseTone(
    priority: CustomerInquiry['priority'],
    type: CustomerInquiry['type']
  ): SupportResponse['tone'] {
    if (priority === 'urgent' || type === 'billing') return 'apologetic'
    if (type === 'technical') return 'informative'
    if (priority === 'high') return 'helpful'

    return 'helpful'
  }

  /** selectResolutionTime determines realistic resolution timeframes. */
  private selectResolutionTime(
    complexity: CustomerInquiry['complexity'],
    priority: CustomerInquiry['priority']
  ): SupportResponse['resolutionTime'] {
    if (priority === 'urgent') return 'immediate'
    if (complexity === 'simple') return 'same_day'
    if (complexity === 'complex') return 'week'

    return 'next_day'
  }

  /** generateResponseText creates realistic support responses. */
  private generateResponseText(inquiry: CustomerInquiry, tone: SupportResponse['tone']): string {
    const responseTemplates: Record<SupportResponse['tone'], string[]> = {
      helpful: [
        "Thank you for reaching out! I'd be happy to help you with this.",
        "I understand your concern and I'm here to assist you.",
        'Let me help you resolve this issue right away.',
      ],
      apologetic: [
        'I sincerely apologize for the inconvenience this has caused.',
        "I'm very sorry about this issue. Let me make it right.",
        "I apologize for the trouble you've experienced.",
      ],
      informative: [
        "Based on your description, here's what I recommend:",
        'Let me walk you through the solution step by step.',
        "Here's the information you requested:",
      ],
      escalation: [
        "I'm escalating this to our specialized team for immediate attention.",
        "This requires additional expertise, so I'm connecting you with our senior support team.",
        'Let me transfer this to someone who can provide more detailed assistance.',
      ],
    }

    const templates = responseTemplates[tone]
    return templates[Math.floor(Math.random() * templates.length)]!
  }

  /** weightedSelect performs weighted random selection from array. */
  private weightedSelect<T>(items: T[], weights: number[]): T {
    const random = Math.random()
    let weightSum = 0

    for (let i = 0; i < items.length; i++) {
      weightSum += weights[i]!
      if (random <= weightSum) {
        return items[i]!
      }
    }

    return items[items.length - 1]!
  }
}
