// packages/seed/src/domains/crm.domain.ts
// CRM domain refinements for contacts and participants via UnifiedCrudHandler

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import type { SeedingContext, SeedingScenario } from '../types'

/** CrmDomain encapsulates contact and participant refinements. */
export class CrmDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** context stores the seeding context with foreign key references. */
  private readonly context: SeedingContext
  /** organizationId targets seeding to a specific organization. */
  private readonly organizationId?: string
  /** organizations caches filtered organization references. */
  private readonly organizations: Array<{ id: string; ownerId: string }>

  /**
   * Creates a new CrmDomain instance.
   * @param scenario - Scenario definition to align entity counts with.
   * @param context - Cross-domain seeding context with foreign key references.
   * @param options - Optional configuration for organization-scoped seeding.
   */
  constructor(
    scenario: SeedingScenario,
    context: SeedingContext,
    options?: { organizationId?: string }
  ) {
    this.scenario = scenario
    this.context = context
    this.organizationId = options?.organizationId

    // Filter organizations by organizationId if specified
    this.organizations = this.organizationId
      ? context.services.organizations.filter((o) => o.id === this.organizationId)
      : context.services.organizations

    if (this.organizations.length === 0) {
      throw new Error(
        `CrmDomain requires at least one organization${
          this.organizationId ? ` for organization ${this.organizationId}` : ''
        } in the seeding context`
      )
    }
  }

  /**
   * insertDirectly creates contacts via UnifiedCrudHandler and participants via direct inserts.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { UnifiedCrudHandler } = await import('@auxx/lib/resources')

    // Seed for each target organization
    for (const org of this.organizations) {
      // Create contacts via UnifiedCrudHandler
      await this.seedContacts(db, org.id, org.ownerId, UnifiedCrudHandler)

      // Create participants (direct insert, not an entity type)
      await this.seedParticipants(db, schema, org.id)
    }
  }

  /**
   * seedContacts generates and creates contact records via UnifiedCrudHandler.
   * @param db - Drizzle database instance
   * @param organizationId - Organization ID to associate contacts with
   * @param userId - User ID for the handler (system user / owner)
   * @param UnifiedCrudHandler - The handler class
   */
  private async seedContacts(
    db: any,
    organizationId: string,
    userId: string,
    UnifiedCrudHandler: any
  ): Promise<void> {
    console.log('📇 Generating contacts via UnifiedCrudHandler...')

    const handler = new UnifiedCrudHandler(organizationId, userId, db)
    const contactCount = this.scenario.scales.customers

    const contactValues = []
    for (let i = 0; i < contactCount; i++) {
      const firstName = this.generateFirstName(i)
      const lastName = this.generateLastName(i)

      contactValues.push({
        primary_email: this.generateEmail(firstName, lastName, i),
        first_name: firstName,
        last_name: lastName,
        phone: this.generatePhone(i),
        contact_status: 'ACTIVE',
      })
    }

    if (contactValues.length > 0) {
      const { created, errors } = await handler.bulkCreate('contact', contactValues, {
        skipEvents: true,
      })

      if (errors.length > 0) {
        console.log(`⚠️  ${errors.length} contact creation errors:`)
        errors.slice(0, 5).forEach((e: any) => console.log(`    [${e.index}] ${e.error}`))
      }

      console.log(`✅ Created ${created.length} contacts via UnifiedCrudHandler`)
    }
  }

  /**
   * seedParticipants generates and inserts participant records linked to contact EntityInstances.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate participants with
   */
  private async seedParticipants(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('👥 Generating participants...')

    // Query contact EntityInstances with their field values for email/name
    const contactInstances = await db
      .select({
        id: schema.EntityInstance.id,
        displayName: schema.EntityInstance.displayName,
        secondaryDisplayValue: schema.EntityInstance.secondaryDisplayValue,
      })
      .from(schema.EntityInstance)
      .innerJoin(
        schema.EntityDefinition,
        sql`${schema.EntityInstance.entityDefinitionId} = ${schema.EntityDefinition.id}`
      )
      .where(
        sql`${schema.EntityDefinition.entityType} = 'contact' AND ${schema.EntityInstance.organizationId} = ${organizationId}`
      )

    // Get email field values for each contact
    const contactEmails = await db
      .select({
        entityId: schema.FieldValue.entityId,
        valueText: schema.FieldValue.valueText,
      })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, sql`${schema.FieldValue.fieldId} = ${schema.CustomField.id}`)
      .where(
        sql`${schema.CustomField.systemAttribute} = 'primary_email' AND ${schema.CustomField.organizationId} = ${organizationId}`
      )

    // Build email lookup
    const emailMap = new Map<string, string>()
    contactEmails.forEach((row: any) => {
      if (row.valueText) emailMap.set(row.entityId, row.valueText)
    })

    const participants: any[] = []

    contactInstances.forEach((contact: any, index: number) => {
      const email = emailMap.get(contact.id)
      if (!email) return

      participants.push({
        id: createId(),
        identifier: email,
        identifierType: 'EMAIL',
        name: contact.displayName || '',
        organizationId: organizationId,
        entityInstanceId: contact.id,
        createdAt: new Date(Date.now() - (contactInstances.length - index) * 3600000),
        updatedAt: new Date(),
      })
    })

    console.log(
      `  📊 Creating ${participants.length} customer participants linked to ${contactInstances.length} contacts`
    )

    if (participants.length > 0) {
      const BATCH_SIZE = 2000

      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        const batch = participants.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.Participant)
          .values(batch)
          .onConflictDoUpdate({
            target: [
              schema.Participant.organizationId,
              schema.Participant.identifier,
              schema.Participant.identifierType,
            ],
            set: {
              name: sql`excluded.name`,
              entityInstanceId: sql`excluded."entityInstanceId"`,
              updatedAt: sql`excluded."updatedAt"`,
            },
          })
      }

      console.log(`✅ Upserted ${participants.length} participants`)
    }
  }

  // ---- Generator Methods ----

  /** generateFirstName creates realistic first names. */
  private generateFirstName(index: number): string {
    const names = [
      'John',
      'Jane',
      'Michael',
      'Sarah',
      'David',
      'Emily',
      'Robert',
      'Jessica',
      'William',
      'Ashley',
      'Christopher',
      'Amanda',
      'Matthew',
      'Stephanie',
      'Joshua',
      'Jennifer',
      'Andrew',
      'Elizabeth',
      'Daniel',
      'Lauren',
      'Joseph',
      'Rachel',
      'Ryan',
      'Megan',
      'Brandon',
      'Nicole',
      'Jason',
      'Samantha',
      'Justin',
      'Katherine',
    ]
    return names[index % names.length]!
  }

  /** generateLastName creates realistic last names. */
  private generateLastName(index: number): string {
    const names = [
      'Smith',
      'Johnson',
      'Williams',
      'Brown',
      'Jones',
      'Garcia',
      'Miller',
      'Davis',
      'Rodriguez',
      'Martinez',
      'Hernandez',
      'Lopez',
      'Gonzalez',
      'Wilson',
      'Anderson',
      'Thomas',
      'Taylor',
      'Moore',
      'Jackson',
      'Martin',
      'Lee',
      'Perez',
      'Thompson',
      'White',
      'Harris',
      'Sanchez',
      'Clark',
    ]
    return names[index % names.length]!
  }

  /** generateEmail creates realistic email addresses. */
  private generateEmail(firstName: string, lastName: string, index: number): string {
    const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com']
    const domain = domains[index % domains.length]!
    const first = firstName.toLowerCase()
    const last = lastName.toLowerCase()
    const suffix = index > 10 ? index : ''
    return `${first}.${last}${suffix}@${domain}`
  }

  /** generatePhone creates realistic phone numbers. */
  private generatePhone(index: number): string | null {
    if (index % 3 === 0) {
      return null // 33% no phone
    }
    const areaCode = 200 + (index % 800)
    const exchange = 200 + (index % 800)
    const number = 1000 + (index % 9000)
    return `+1${areaCode}${exchange}${number}`
  }
}
