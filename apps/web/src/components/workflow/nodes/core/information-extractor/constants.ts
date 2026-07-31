// apps/web/src/components/workflow/nodes/core/information-extractor/constants.ts

import { type SchemaRoot, Type } from '~/components/workflow/ui/json-schema-types'

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
      type: Type.object,
      properties: {
        name: {
          type: Type.string,
          description: 'Customer full name',
        },
        email: {
          type: Type.string,
          description: 'Email address',
          format: 'email',
        },
        phone: {
          type: Type.string,
          description: 'Phone number',
        },
        company: {
          type: Type.string,
          description: 'Company or organization name',
        },
        address: {
          type: Type.object,
          description: 'Physical address',
          properties: {
            street1: { type: Type.string, description: 'Street address line 1' },
            street2: { type: Type.string, description: 'Street address line 2 (apt, suite, etc.)' },
            city: { type: Type.string, description: 'City' },
            state: { type: Type.string, description: 'State or province' },
            zipCode: { type: Type.string, description: 'ZIP or postal code' },
            country: { type: Type.string, description: 'Country' },
          },
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  order: {
    name: 'Order Details',
    description: 'Extract e-commerce order information',
    schema: {
      type: Type.object,
      properties: {
        orderNumber: {
          type: Type.string,
          description: 'Order ID or number',
        },
        orderDate: {
          type: Type.string,
          description: 'Order date',
          format: 'date',
        },
        customerEmail: {
          type: Type.string,
          description: 'Customer email address',
          format: 'email',
        },
        shippingMethod: {
          type: Type.string,
          description: 'Shipping or delivery method',
        },
        items: {
          type: Type.array,
          description: 'List of ordered items',
          items: {
            type: Type.object,
            properties: {
              name: { type: Type.string, description: 'Product name' },
              sku: { type: Type.string, description: 'Product SKU or code' },
              quantity: { type: Type.number, description: 'Quantity ordered' },
              price: { type: Type.number, description: 'Unit price' },
              total: { type: Type.number, description: 'Line total' },
            },
          },
        },
        subtotal: {
          type: Type.number,
          description: 'Order subtotal before tax and shipping',
        },
        tax: {
          type: Type.number,
          description: 'Tax amount',
        },
        shipping: {
          type: Type.number,
          description: 'Shipping cost',
        },
        total: {
          type: Type.number,
          description: 'Total order amount',
        },
      },
      required: ['orderNumber'],
      additionalProperties: false,
    },
  },
  sentiment: {
    name: 'Sentiment Analysis',
    description: 'Extract sentiment and emotional tone from text',
    schema: {
      type: Type.object,
      properties: {
        sentiment: {
          type: Type.string,
          enum: ['positive', 'negative', 'neutral', 'mixed'],
          description: 'Overall sentiment classification',
        },
        confidence: {
          type: Type.number,
          description: 'Confidence score (0-1)',
          minimum: 0,
          maximum: 1,
        },
        emotions: {
          type: Type.array,
          description: 'Detected emotions',
          items: {
            type: Type.string,
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
          type: Type.array,
          items: { type: Type.string },
          description: 'Key phrases indicating sentiment',
        },
        summary: {
          type: Type.string,
          description: 'Brief summary of the sentiment analysis',
        },
      },
      required: ['sentiment', 'confidence'],
      additionalProperties: false,
    },
  },
  product: {
    name: 'Product Information',
    description: 'Extract product details and specifications',
    schema: {
      type: Type.object,
      properties: {
        name: {
          type: Type.string,
          description: 'Product name or title',
        },
        brand: {
          type: Type.string,
          description: 'Brand or manufacturer',
        },
        category: {
          type: Type.string,
          description: 'Product category',
        },
        price: {
          type: Type.number,
          description: 'Product price',
        },
        currency: {
          type: Type.string,
          description: 'Price currency (USD, EUR, etc.)',
        },
        description: {
          type: Type.string,
          description: 'Product description',
        },
        features: {
          type: Type.array,
          items: { type: Type.string },
          description: 'Key product features',
        },
        specifications: {
          type: Type.object,
          description: 'Technical specifications',
          additionalProperties: { type: Type.string },
        },
        availability: {
          type: Type.string,
          enum: ['in_stock', 'out_of_stock', 'preorder', 'discontinued'],
          description: 'Stock availability status',
        },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  support_ticket: {
    name: 'Support Ticket',
    description: 'Extract customer support ticket information',
    schema: {
      type: Type.object,
      properties: {
        issue_type: {
          type: Type.string,
          description: 'Type of issue (technical, billing, general inquiry, etc.)',
        },
        priority: {
          type: Type.string,
          enum: ['low', 'medium', 'high', 'urgent'],
          description: 'Issue priority level',
        },
        product_mentioned: {
          type: Type.string,
          description: 'Product or service mentioned',
        },
        problem_description: {
          type: Type.string,
          description: 'Summary of the problem',
        },
        customer_sentiment: {
          type: Type.string,
          enum: ['satisfied', 'neutral', 'frustrated', 'angry'],
          description: 'Customer emotional state',
        },
        requested_action: {
          type: Type.string,
          description: 'What the customer wants done',
        },
        order_reference: {
          type: Type.string,
          description: 'Any order or reference number mentioned',
        },
      },
      required: ['issue_type', 'problem_description'],
      additionalProperties: false,
    },
  },
  event: {
    name: 'Event Information',
    description: 'Extract event details from text',
    schema: {
      type: Type.object,
      properties: {
        name: {
          type: Type.string,
          description: 'Event name or title',
        },
        date: {
          type: Type.string,
          description: 'Event date',
          format: 'date',
        },
        time: {
          type: Type.string,
          description: 'Event time',
        },
        location: {
          type: Type.object,
          properties: {
            venue: { type: Type.string, description: 'Venue name' },
            address: { type: Type.string, description: 'Street address' },
            city: { type: Type.string, description: 'City' },
            online_link: { type: Type.string, description: 'Online meeting link if virtual' },
          },
        },
        description: {
          type: Type.string,
          description: 'Event description',
        },
        attendees: {
          type: Type.array,
          items: { type: Type.string },
          description: 'List of attendees or participants',
        },
        organizer: {
          type: Type.string,
          description: 'Event organizer',
        },
      },
      required: ['name', 'date'],
      additionalProperties: false,
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
