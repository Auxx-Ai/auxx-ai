// packages/lib/src/seed/entity-seeder.ts

import { type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'

const logger = createScopedLogger('entity-seeder')

/**
 * System field definition for seeding
 */
interface SystemFieldDef {
  name: string
  type: string
  systemAttribute: string
  required?: boolean
  isUnique?: boolean
  isCreatable?: boolean
  isUpdatable?: boolean
  isComputed?: boolean
  isSortable?: boolean
  isFilterable?: boolean
  options?: {
    options?: Array<{ id: string; label: string; value: string; color?: string }>
    [key: string]: unknown
  }
  position?: number
}

/**
 * System entity definition for seeding
 */
interface SystemEntityDef {
  entityType: string
  apiSlug: string
  singular: string
  plural: string
  icon: string
  color: string
  fields: SystemFieldDef[]
}

/**
 * Generate a stable option ID
 */
function optId(): string {
  return generateId('opt')
}

/**
 * Contact system fields
 */
const CONTACT_FIELDS: SystemFieldDef[] = [
  {
    name: 'Email',
    type: 'EMAIL',
    systemAttribute: 'primary_email',
    required: true,
    isUnique: true,
  },
  { name: 'First Name', type: 'TEXT', systemAttribute: 'first_name' },
  { name: 'Last Name', type: 'TEXT', systemAttribute: 'last_name' },
  { name: 'Phone', type: 'PHONE_INTL', systemAttribute: 'phone' },
  {
    name: 'Status',
    type: 'SINGLE_SELECT',
    systemAttribute: 'contact_status',
    options: {
      options: [
        { id: optId(), label: 'Active', value: 'ACTIVE', color: 'green' },
        { id: optId(), label: 'Inactive', value: 'INACTIVE', color: 'gray' },
        { id: optId(), label: 'Spam', value: 'SPAM', color: 'red' },
      ],
    },
  },
  { name: 'Tags', type: 'TAGS', systemAttribute: 'contact_tags' },
  { name: 'Notes', type: 'RICH_TEXT', systemAttribute: 'contact_notes' },
]

/**
 * Ticket system fields
 */
const TICKET_FIELDS: SystemFieldDef[] = [
  {
    name: 'Number',
    type: 'NUMBER',
    systemAttribute: 'ticket_number',
    isUnique: true,
    isCreatable: false,
    isUpdatable: false,
    isComputed: true,
  },
  { name: 'Title', type: 'TEXT', systemAttribute: 'ticket_title', required: true },
  { name: 'Description', type: 'RICH_TEXT', systemAttribute: 'ticket_description' },
  {
    name: 'Type',
    type: 'SINGLE_SELECT',
    systemAttribute: 'ticket_type',
    isUpdatable: false,
    options: {
      options: [
        { id: optId(), label: 'Question', value: 'QUESTION', color: 'blue' },
        { id: optId(), label: 'Problem', value: 'PROBLEM', color: 'red' },
        { id: optId(), label: 'Feature Request', value: 'FEATURE_REQUEST', color: 'purple' },
        { id: optId(), label: 'Refund', value: 'REFUND', color: 'orange' },
        { id: optId(), label: 'Other', value: 'OTHER', color: 'gray' },
      ],
    },
  },
  {
    name: 'Priority',
    type: 'SINGLE_SELECT',
    systemAttribute: 'ticket_priority',
    options: {
      options: [
        { id: optId(), label: 'Low', value: 'LOW', color: 'gray' },
        { id: optId(), label: 'Medium', value: 'MEDIUM', color: 'yellow' },
        { id: optId(), label: 'High', value: 'HIGH', color: 'orange' },
        { id: optId(), label: 'Urgent', value: 'URGENT', color: 'red' },
      ],
    },
  },
  {
    name: 'Status',
    type: 'SINGLE_SELECT',
    systemAttribute: 'ticket_status',
    options: {
      options: [
        { id: optId(), label: 'Open', value: 'OPEN', color: 'blue' },
        { id: optId(), label: 'In Progress', value: 'IN_PROGRESS', color: 'yellow' },
        { id: optId(), label: 'Waiting', value: 'WAITING', color: 'orange' },
        { id: optId(), label: 'Resolved', value: 'RESOLVED', color: 'green' },
        { id: optId(), label: 'Closed', value: 'CLOSED', color: 'gray' },
      ],
    },
  },
  {
    name: 'Contact',
    type: 'RELATIONSHIP',
    systemAttribute: 'ticket_contact',
    isUpdatable: false,
    options: { targetEntityType: 'contact', cardinality: 'many-to-one' },
  },
  {
    name: 'Assignee',
    type: 'RELATIONSHIP',
    systemAttribute: 'ticket_assignee',
    options: { targetEntityType: 'user', cardinality: 'many-to-one' },
  },
  { name: 'Due Date', type: 'DATETIME', systemAttribute: 'ticket_due_date' },
  {
    name: 'Created At',
    type: 'DATETIME',
    systemAttribute: 'created_at',
    isCreatable: false,
    isUpdatable: false,
    isComputed: true,
  },
  {
    name: 'Updated At',
    type: 'DATETIME',
    systemAttribute: 'updated_at',
    isCreatable: false,
    isUpdatable: false,
    isComputed: true,
  },
]

/**
 * Part system fields
 */
const PART_FIELDS: SystemFieldDef[] = [
  { name: 'Title', type: 'TEXT', systemAttribute: 'part_title', required: true },
  { name: 'SKU', type: 'TEXT', systemAttribute: 'part_sku', isUnique: true },
  { name: 'Description', type: 'RICH_TEXT', systemAttribute: 'part_description' },
  {
    name: 'Category',
    type: 'SINGLE_SELECT',
    systemAttribute: 'part_category',
    options: {
      options: [
        { id: optId(), label: 'Electronics', value: 'ELECTRONICS', color: 'blue' },
        { id: optId(), label: 'Mechanical', value: 'MECHANICAL', color: 'gray' },
        { id: optId(), label: 'Consumable', value: 'CONSUMABLE', color: 'green' },
        { id: optId(), label: 'Accessory', value: 'ACCESSORY', color: 'purple' },
      ],
    },
  },
  { name: 'Cost', type: 'CURRENCY', systemAttribute: 'part_cost' },
]

/**
 * System entity definitions
 */
const SYSTEM_ENTITIES: SystemEntityDef[] = [
  {
    entityType: 'contact',
    apiSlug: 'contacts',
    singular: 'Contact',
    plural: 'Contacts',
    icon: 'User',
    color: 'blue',
    fields: CONTACT_FIELDS,
  },
  {
    entityType: 'ticket',
    apiSlug: 'tickets',
    singular: 'Ticket',
    plural: 'Tickets',
    icon: 'Ticket',
    color: 'orange',
    fields: TICKET_FIELDS,
  },
  {
    entityType: 'part',
    apiSlug: 'parts',
    singular: 'Part',
    plural: 'Parts',
    icon: 'Package',
    color: 'green',
    fields: PART_FIELDS,
  },
]

/**
 * EntitySeeder seeds system EntityDefinitions and CustomFields for a new organization.
 */
export class EntitySeeder {
  constructor(
    private db: Database,
    private organizationId: string
  ) {}

  /**
   * Seed all system entities (Contact, Ticket, Part) for the organization
   */
  async seedSystemEntities(): Promise<void> {
    logger.info('Seeding system entities', { organizationId: this.organizationId })

    for (const entityDef of SYSTEM_ENTITIES) {
      await this.seedEntity(entityDef)
    }

    logger.info('Successfully seeded system entities', { organizationId: this.organizationId })
  }

  /**
   * Seed a single system entity and its fields
   */
  private async seedEntity(entityDef: SystemEntityDef): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Create EntityDefinition
      const [createdDef] = await tx
        .insert(schema.EntityDefinition)
        .values({
          organizationId: this.organizationId,
          entityType: entityDef.entityType,
          apiSlug: entityDef.apiSlug,
          singular: entityDef.singular,
          plural: entityDef.plural,
          icon: entityDef.icon,
          color: entityDef.color,
        })
        .returning()

      if (!createdDef) {
        throw new Error(`Failed to create EntityDefinition for ${entityDef.entityType}`)
      }

      logger.info(`Created EntityDefinition: ${entityDef.entityType}`, {
        organizationId: this.organizationId,
        entityDefinitionId: createdDef.id,
      })

      // Create CustomFields
      const fieldValues = entityDef.fields.map((field, index) => ({
        organizationId: this.organizationId,
        entityDefinitionId: createdDef.id,
        name: field.name,
        type: field.type,
        systemAttribute: field.systemAttribute,
        required: field.required ?? false,
        isUnique: field.isUnique ?? false,
        isCreatable: field.isCreatable ?? true,
        isUpdatable: field.isUpdatable ?? true,
        isComputed: field.isComputed ?? false,
        isSortable: field.isSortable ?? true,
        isFilterable: field.isFilterable ?? true,
        options: field.options ?? null,
        position: field.position ?? index,
      }))

      await tx.insert(schema.CustomField).values(fieldValues)

      logger.info(`Created ${fieldValues.length} CustomFields for ${entityDef.entityType}`, {
        organizationId: this.organizationId,
        entityDefinitionId: createdDef.id,
      })
    })
  }
}
