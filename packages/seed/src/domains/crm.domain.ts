// packages/seed/src/domains/crm.domain.ts
// CRM domain refinements for contacts and participants with comprehensive seeding

import { createId } from '@paralleldrive/cuid2'
import { sql } from 'drizzle-orm'
import type { SeedingContext, SeedingScenario } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'
import { ContentEngine } from '../generators/content-engine'

/** CrmDomain encapsulates contact and participant refinements. */
export class CrmDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions
  /** content generates realistic business content. */
  private readonly content: ContentEngine
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
    this.distributions = new BusinessDistributions(scenario.dataQuality)
    this.content = new ContentEngine(scenario.dataQuality)
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
   * insertDirectly performs direct database inserts bypassing drizzle-seed.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    const { schema } = await import('@auxx/database')

    // Seed for each target organization
    for (const org of this.organizations) {
      // Generate and insert Contacts
      await this.seedContacts(db, schema, org.id)

      // Generate and insert Participants
      await this.seedParticipants(db, schema, org.id)
    }
  }

  /**
   * seedContacts generates and inserts contact records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate contacts with
   */
  private async seedContacts(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('📇 Generating contacts...')

    const contactCount = this.scenario.scales.customers
    const contacts = []

    for (let i = 0; i < contactCount; i++) {
      const firstName = this.generateFirstName(i)
      const lastName = this.generateLastName(i)
      const email = this.generateEmail(firstName, lastName, i)

      contacts.push({
        id: createId(),
        email: email,
        firstName: firstName,
        lastName: lastName,
        phone: this.generatePhone(i),
        organizationId: organizationId,
        createdAt: new Date(Date.now() - (contactCount - i) * 3600000),
        updatedAt: new Date(),
        status: 'ACTIVE',
      })
    }

    if (contacts.length > 0) {
      const BATCH_SIZE = 2000

      if (contacts.length > BATCH_SIZE) {
        console.log(`📦 Inserting ${contacts.length} contacts in batches of ${BATCH_SIZE}...`)
      }

      for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
        const batch = contacts.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.Contact)
          .values(batch)
          .onConflictDoUpdate({
            target: [schema.Contact.organizationId, schema.Contact.email],
            set: {
              firstName: sql`excluded."firstName"`,
              lastName: sql`excluded."lastName"`,
              phone: sql`excluded.phone`,
              updatedAt: sql`excluded."updatedAt"`,
            },
          })

        if (contacts.length > BATCH_SIZE) {
          console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(contacts.length / BATCH_SIZE)} complete`)
        }
      }

      console.log(`✅ Upserted ${contacts.length} contacts`)
    }
  }

  /**
   * seedParticipants generates and inserts participant records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   * @param organizationId - Organization ID to associate participants with
   */
  private async seedParticipants(db: any, schema: any, organizationId: string): Promise<void> {
    console.log('👥 Generating participants...')

    // Get existing contacts to link participants to
    const contacts = await db
      .select({ id: schema.Contact.id, email: schema.Contact.email, firstName: schema.Contact.firstName, lastName: schema.Contact.lastName })
      .from(schema.Contact)
      .where(sql`${schema.Contact.organizationId} = ${organizationId}`)

    const participants = []

    // Create one participant per contact (using contact's email)
    contacts.forEach((contact: any, index: number) => {
      participants.push({
        id: createId(),
        identifier: contact.email,
        identifierType: 'EMAIL',
        name: `${contact.firstName} ${contact.lastName}`,
        organizationId: organizationId,
        contactId: contact.id, // Link to the contact
        createdAt: new Date(Date.now() - (contacts.length - index) * 3600000),
        updatedAt: new Date(),
      })
    })

    console.log(`  📊 Creating ${participants.length} customer participants linked to ${contacts.length} contacts`)

    if (participants.length > 0) {
      const BATCH_SIZE = 2000

      if (participants.length > BATCH_SIZE) {
        console.log(`📦 Inserting ${participants.length} participants in batches of ${BATCH_SIZE}...`)
      }

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
              contactId: sql`excluded."contactId"`,
              updatedAt: sql`excluded."updatedAt"`,
            },
          })

        if (participants.length > BATCH_SIZE) {
          console.log(`  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(participants.length / BATCH_SIZE)} complete`)
        }
      }

      console.log(`✅ Upserted ${participants.length} participants`)
    }
  }

  // ---- Generator Methods ----

  /** generateFirstName creates realistic first names. */
  private generateFirstName(index: number): string {
    const names = [
      'John', 'Jane', 'Michael', 'Sarah', 'David', 'Emily', 'Robert', 'Jessica',
      'William', 'Ashley', 'Christopher', 'Amanda', 'Matthew', 'Stephanie', 'Joshua',
      'Jennifer', 'Andrew', 'Elizabeth', 'Daniel', 'Lauren', 'Joseph', 'Rachel',
      'Ryan', 'Megan', 'Brandon', 'Nicole', 'Jason', 'Samantha', 'Justin', 'Katherine',
    ]
    return names[index % names.length]!
  }

  /** generateLastName creates realistic last names. */
  private generateLastName(index: number): string {
    const names = [
      'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
      'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
      'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
      'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
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