// packages/seed/src/domains/crm.domain.ts
// CRM domain refinements for contacts, companies, and participants via UnifiedCrudHandler

import { createId } from '@paralleldrive/cuid2'
import { and, eq, sql } from 'drizzle-orm'
import type { SeedingContext, SeedingScenario } from '../types'

/** CompanyRoster describes the curated companies seeded for demo/screenshot scenarios. */
interface CompanyRoster {
  name: string
  domain: string
  industry: string
  size: string
  revenue: number
  headquarters: { street: string; city: string; state: string; country: string }
}

/**
 * COMPANY_ROSTER is a hand-picked set of fictional SMBs used for demo seeding.
 * Entries are consumed in order — scenarios with `scales.companies = N` take the
 * first N rows. Keep entries business-appropriate and distinct by domain.
 */
const COMPANY_ROSTER: readonly CompanyRoster[] = [
  {
    name: 'Northwind Trading',
    domain: 'northwindtrading.com',
    industry: 'wholesale',
    size: '11-50',
    revenue: 4_200_000,
    headquarters: { street: '100 Harbor Way', city: 'Seattle', state: 'WA', country: 'US' },
  },
  {
    name: 'Acme Retail',
    domain: 'acme-retail.com',
    industry: 'retail',
    size: '51-200',
    revenue: 18_500_000,
    headquarters: { street: '500 Market St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Orbit Labs',
    domain: 'orbitlabs.io',
    industry: 'saas',
    size: '11-50',
    revenue: 6_800_000,
    headquarters: { street: '12 Elm Ave', city: 'Austin', state: 'TX', country: 'US' },
  },
  {
    name: 'Haven Furniture',
    domain: 'havenfurniture.com',
    industry: 'e-commerce',
    size: '11-50',
    revenue: 3_100_000,
    headquarters: { street: '88 Cedar Ln', city: 'Portland', state: 'OR', country: 'US' },
  },
  {
    name: 'Peak Manufacturing',
    domain: 'peakmfg.com',
    industry: 'manufacturing',
    size: '201-500',
    revenue: 42_000_000,
    headquarters: { street: '2200 Industry Rd', city: 'Detroit', state: 'MI', country: 'US' },
  },
  {
    name: 'Clearwater Supply',
    domain: 'clearwatersupply.com',
    industry: 'wholesale',
    size: '1-10',
    revenue: 1_400_000,
    headquarters: { street: '17 Lake Dr', city: 'Minneapolis', state: 'MN', country: 'US' },
  },
  {
    name: 'Summit Outfitters',
    domain: 'summitoutfitters.com',
    industry: 'retail',
    size: '11-50',
    revenue: 5_600_000,
    headquarters: { street: '301 Alpine Way', city: 'Denver', state: 'CO', country: 'US' },
  },
  {
    name: 'Beacon Analytics',
    domain: 'beaconanalytics.io',
    industry: 'saas',
    size: '51-200',
    revenue: 14_300_000,
    headquarters: { street: '45 Lighthouse Ct', city: 'Boston', state: 'MA', country: 'US' },
  },
]

/** CrmDomain encapsulates contact, company, and participant refinements. */
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
   * insertDirectly seeds companies, contacts, participants, and links contacts to companies.
   * @param db - Drizzle database instance
   */
  async insertDirectly(db: any): Promise<void> {
    const { schema } = await import('@auxx/database')
    const { UnifiedCrudHandler } = await import('@auxx/lib/resources')

    // Seed for each target organization
    for (const org of this.organizations) {
      const handler = new UnifiedCrudHandler(org.id, org.ownerId, db)

      // Companies first (contacts reference company domains via email).
      const companiesByDomain = await this.seedCompanies(handler)

      // Contacts — some emails use company domains so linking has signal.
      await this.seedContacts(handler, Array.from(companiesByDomain.keys()))

      // Participants (direct insert, mirrors contact EntityInstances)
      await this.seedParticipants(db, schema, org.id)

      // Link contacts to companies via contact_employer / company_primary_contact.
      // RecordIds must use the entityDefinition CUID (not the type string), otherwise
      // the frontend record-store can't match the requested ID to server responses
      // and displays 'Unknown'.
      if (companiesByDomain.size > 0) {
        const [contactDef, companyDef] = await Promise.all([
          handler.resolveEntityDefinition('contact'),
          handler.resolveEntityDefinition('company'),
        ])
        await this.linkContactsToCompanies(
          db,
          schema,
          handler,
          org.id,
          contactDef.id,
          companyDef.id,
          companiesByDomain
        )
      }
    }
  }

  /**
   * seedCompanies creates company EntityInstances via UnifiedCrudHandler.
   * Returns a map of lowercase domain → companyId for downstream linking.
   */
  private async seedCompanies(handler: any): Promise<Map<string, string>> {
    const domainToId = new Map<string, string>()
    const count = this.scenario.scales.companies ?? 0
    if (count <= 0) return domainToId

    console.log(`🏢 Generating ${count} companies via UnifiedCrudHandler...`)

    const roster = COMPANY_ROSTER.slice(0, Math.min(count, COMPANY_ROSTER.length))
    const values = roster.map((c) => ({
      company_name: c.name,
      company_domain: c.domain,
      company_website: `https://${c.domain}`,
      company_industry: c.industry,
      company_size: c.size,
      company_annual_revenue: c.revenue,
      company_headquarters: c.headquarters,
    }))

    const { created, errors } = await handler.bulkCreate('company', values, { skipEvents: true })

    if (errors.length > 0) {
      console.log(`⚠️  ${errors.length} company creation errors:`)
      errors.slice(0, 5).forEach((e: any) => console.log(`    [${e.index}] ${e.error}`))
    }

    created.forEach((instance: any, idx: number) => {
      const entry = roster[idx]
      if (entry) domainToId.set(entry.domain.toLowerCase(), instance.id)
    })

    console.log(`✅ Created ${created.length} companies via UnifiedCrudHandler`)
    return domainToId
  }

  /**
   * seedContacts generates and creates contact records via UnifiedCrudHandler.
   * When company domains are available, ~60% of contacts get business-domain emails
   * distributed round-robin across companies; the rest use personal email domains.
   */
  private async seedContacts(handler: any, companyDomains: string[]): Promise<void> {
    console.log('📇 Generating contacts via UnifiedCrudHandler...')

    const contactCount = this.scenario.scales.customers
    const businessCount =
      companyDomains.length > 0 ? Math.min(contactCount, Math.ceil(contactCount * 0.6)) : 0

    const contactValues = []
    for (let i = 0; i < contactCount; i++) {
      const firstName = this.generateFirstName(i)
      const lastName = this.generateLastName(i)
      const domain =
        i < businessCount ? companyDomains[i % companyDomains.length]! : this.personalDomain(i)

      contactValues.push({
        primary_email: this.buildEmail(firstName, lastName, i, domain),
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

    // Deduplicate by email to avoid "ON CONFLICT DO UPDATE cannot affect row a second time"
    // (re-seeding can produce multiple contacts with the same email)
    const seenEmails = new Set<string>()
    const participants: any[] = []

    contactInstances.forEach((contact: any, index: number) => {
      const email = emailMap.get(contact.id)
      if (!email || seenEmails.has(email)) return
      seenEmails.add(email)

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

  /**
   * linkContactsToCompanies sets `contact_employer` on contacts whose email domain
   * matches a seeded company, and `company_primary_contact` on each company pointing
   * at the first matching employee. Idempotent: re-seeding overwrites the same links.
   */
  private async linkContactsToCompanies(
    db: any,
    schema: any,
    handler: any,
    organizationId: string,
    contactDefId: string,
    companyDefId: string,
    companiesByDomain: Map<string, string>
  ): Promise<void> {
    console.log('🔗 Linking contacts to companies...')

    // Fetch email FieldValues for all contacts in this org.
    const emailRows = await db
      .select({
        entityId: schema.FieldValue.entityId,
        valueText: schema.FieldValue.valueText,
      })
      .from(schema.FieldValue)
      .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          eq(schema.CustomField.systemAttribute, 'primary_email')
        )
      )

    const firstContactByCompany = new Map<string, string>()
    let linkedEmployers = 0

    for (const row of emailRows) {
      const email = row.valueText as string | null
      if (!email) continue
      const atIdx = email.lastIndexOf('@')
      if (atIdx < 0) continue
      const domain = email.slice(atIdx + 1).toLowerCase()
      const companyId = companiesByDomain.get(domain)
      if (!companyId) continue

      await handler.update(
        `${contactDefId}:${row.entityId}` as never,
        { contact_employer: `${companyDefId}:${companyId}` },
        { skipEvents: true, skipSnapshotInvalidation: true }
      )
      linkedEmployers++

      if (!firstContactByCompany.has(companyId)) {
        firstContactByCompany.set(companyId, row.entityId as string)
      }
    }

    let primaryContactsSet = 0
    for (const [companyId, contactId] of firstContactByCompany) {
      await handler.update(
        `${companyDefId}:${companyId}` as never,
        { company_primary_contact: `${contactDefId}:${contactId}` },
        { skipEvents: true, skipSnapshotInvalidation: true }
      )
      primaryContactsSet++
    }

    console.log(
      `✅ Linked ${linkedEmployers} contacts to ${firstContactByCompany.size} companies (${primaryContactsSet} primary contacts set)`
    )
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

  /** personalDomain returns a free-email-provider domain for unaffiliated contacts. */
  private personalDomain(index: number): string {
    const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com']
    return domains[index % domains.length]!
  }

  /** buildEmail composes a deterministic email address from name + domain. */
  private buildEmail(firstName: string, lastName: string, index: number, domain: string): string {
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
