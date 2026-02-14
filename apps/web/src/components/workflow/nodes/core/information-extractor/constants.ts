// apps/web/src/components/workflow/nodes/core/information-extractor/constants.ts

import type { SchemaRoot } from './types'

/**
 * Pre-built extraction templates for common use cases
 */
export const EXTRACTION_TEMPLATES: Record<
  string,
  {
    name: string
    description: string
    schema: SchemaRoot
  }
> = {
  customer: {
    name: 'Customer Information',
    description: 'Extract customer contact details and basic information',
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Customer full name',
        },
        email: {
          type: 'string',
          description: 'Email address',
          format: 'email',
        },
        phone: {
          type: 'string',
          description: 'Phone number',
        },
        company: {
          type: 'string',
          description: 'Company or organization name',
        },
        address: {
          type: 'object',
          description: 'Physical address',
          properties: {
            street: { type: 'string', description: 'Street address' },
            city: { type: 'string', description: 'City' },
            state: { type: 'string', description: 'State or province' },
            country: { type: 'string', description: 'Country' },
            postalCode: { type: 'string', description: 'ZIP or postal code' },
          },
        },
      },
      required: ['name'],
    },
  },
  order: {
    name: 'Order Details',
    description: 'Extract e-commerce order information',
    schema: {
      type: 'object',
      properties: {
        orderNumber: {
          type: 'string',
          description: 'Order ID or number',
        },
        orderDate: {
          type: 'string',
          description: 'Order date',
          format: 'date',
        },
        customerEmail: {
          type: 'string',
          description: 'Customer email address',
          format: 'email',
        },
        shippingMethod: {
          type: 'string',
          description: 'Shipping or delivery method',
        },
        items: {
          type: 'array',
          description: 'List of ordered items',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Product name' },
              sku: { type: 'string', description: 'Product SKU or code' },
              quantity: { type: 'number', description: 'Quantity ordered' },
              price: { type: 'number', description: 'Unit price' },
              total: { type: 'number', description: 'Line total' },
            },
          },
        },
        subtotal: {
          type: 'number',
          description: 'Order subtotal before tax and shipping',
        },
        tax: {
          type: 'number',
          description: 'Tax amount',
        },
        shipping: {
          type: 'number',
          description: 'Shipping cost',
        },
        total: {
          type: 'number',
          description: 'Total order amount',
        },
      },
      required: ['orderNumber'],
    },
  },
  sentiment: {
    name: 'Sentiment Analysis',
    description: 'Extract sentiment and emotional tone from text',
    schema: {
      type: 'object',
      properties: {
        sentiment: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral', 'mixed'],
          description: 'Overall sentiment classification',
        },
        confidence: {
          type: 'number',
          description: 'Confidence score (0-1)',
          minimum: 0,
          maximum: 1,
        },
        emotions: {
          type: 'array',
          description: 'Detected emotions',
          items: {
            type: 'string',
            enum: [
              'joy',
              'anger',
              'sadness',
              'fear',
              'surprise',
              'disgust',
              'trust',
              'anticipation',
            ],
          },
        },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key phrases indicating sentiment',
        },
        summary: {
          type: 'string',
          description: 'Brief summary of the sentiment analysis',
        },
      },
      required: ['sentiment', 'confidence'],
    },
  },
  product: {
    name: 'Product Information',
    description: 'Extract product details and specifications',
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Product name or title',
        },
        brand: {
          type: 'string',
          description: 'Brand or manufacturer',
        },
        category: {
          type: 'string',
          description: 'Product category',
        },
        price: {
          type: 'number',
          description: 'Product price',
        },
        currency: {
          type: 'string',
          description: 'Price currency (USD, EUR, etc.)',
        },
        description: {
          type: 'string',
          description: 'Product description',
        },
        features: {
          type: 'array',
          items: { type: 'string' },
          description: 'Key product features',
        },
        specifications: {
          type: 'object',
          description: 'Technical specifications',
          additionalProperties: { type: 'string' },
        },
        availability: {
          type: 'string',
          enum: ['in_stock', 'out_of_stock', 'preorder', 'discontinued'],
          description: 'Stock availability status',
        },
      },
      required: ['name'],
    },
  },
  support_ticket: {
    name: 'Support Ticket',
    description: 'Extract customer support ticket information',
    schema: {
      type: 'object',
      properties: {
        issue_type: {
          type: 'string',
          description: 'Type of issue (technical, billing, general inquiry, etc.)',
        },
        priority: {
          type: 'string',
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Issue priority level',
        },
        product_mentioned: {
          type: 'string',
          description: 'Product or service mentioned',
        },
        problem_description: {
          type: 'string',
          description: 'Summary of the problem',
        },
        customer_sentiment: {
          type: 'string',
          enum: ['satisfied', 'neutral', 'frustrated', 'angry'],
          description: 'Customer emotional state',
        },
        requested_action: {
          type: 'string',
          description: 'What the customer wants done',
        },
        order_reference: {
          type: 'string',
          description: 'Any order or reference number mentioned',
        },
      },
      required: ['issue_type', 'problem_description'],
    },
  },
  event: {
    name: 'Event Information',
    description: 'Extract event details from text',
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Event name or title',
        },
        date: {
          type: 'string',
          description: 'Event date',
          format: 'date',
        },
        time: {
          type: 'string',
          description: 'Event time',
        },
        location: {
          type: 'object',
          properties: {
            venue: { type: 'string', description: 'Venue name' },
            address: { type: 'string', description: 'Street address' },
            city: { type: 'string', description: 'City' },
            online_link: { type: 'string', description: 'Online meeting link if virtual' },
          },
        },
        description: {
          type: 'string',
          description: 'Event description',
        },
        attendees: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of attendees or participants',
        },
        organizer: {
          type: 'string',
          description: 'Event organizer',
        },
      },
      required: ['name', 'date'],
    },
  },
}

/**
 * Get template by key
 */
export function getExtractionTemplate(key: string) {
  return EXTRACTION_TEMPLATES[key]
}

/**
 * Get all template keys
 */
export function getTemplateKeys(): string[] {
  return Object.keys(EXTRACTION_TEMPLATES)
}

/**
 * Get all templates as array
 */
export function getTemplatesArray() {
  return Object.entries(EXTRACTION_TEMPLATES).map(([key, template]) => ({
    key,
    ...template,
  }))
}
