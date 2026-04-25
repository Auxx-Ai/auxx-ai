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
 * COMPANY_ROSTER is a hand-picked set of recognizable real companies used for
 * demo seeding. Entries are consumed in order — scenarios with `scales.companies = N`
 * take the first N rows. Keep entries distinct by domain.
 */
const COMPANY_ROSTER: readonly CompanyRoster[] = [
  {
    name: 'Google',
    domain: 'google.com',
    industry: 'other',
    size: '500+',
    revenue: 307_000_000_000,
    headquarters: {
      street: '1600 Amphitheatre Pkwy',
      city: 'Mountain View',
      state: 'CA',
      country: 'US',
    },
  },
  {
    name: 'Apple',
    domain: 'apple.com',
    industry: 'other',
    size: '500+',
    revenue: 394_000_000_000,
    headquarters: { street: '1 Apple Park Way', city: 'Cupertino', state: 'CA', country: 'US' },
  },
  {
    name: 'Disney',
    domain: 'disney.com',
    industry: 'other',
    size: '500+',
    revenue: 88_900_000_000,
    headquarters: {
      street: '500 S Buena Vista St',
      city: 'Burbank',
      state: 'CA',
      country: 'US',
    },
  },
  {
    name: 'PayPal',
    domain: 'paypal.com',
    industry: 'other',
    size: '500+',
    revenue: 29_800_000_000,
    headquarters: { street: '2211 N First St', city: 'San Jose', state: 'CA', country: 'US' },
  },
  {
    name: 'Microsoft',
    domain: 'microsoft.com',
    industry: 'other',
    size: '500+',
    revenue: 211_900_000_000,
    headquarters: { street: '1 Microsoft Way', city: 'Redmond', state: 'WA', country: 'US' },
  },
  {
    name: 'Amazon',
    domain: 'amazon.com',
    industry: 'e-commerce',
    size: '500+',
    revenue: 574_800_000_000,
    headquarters: { street: '410 Terry Ave N', city: 'Seattle', state: 'WA', country: 'US' },
  },
  {
    name: 'Netflix',
    domain: 'netflix.com',
    industry: 'other',
    size: '500+',
    revenue: 33_700_000_000,
    headquarters: { street: '100 Winchester Cir', city: 'Los Gatos', state: 'CA', country: 'US' },
  },
  {
    name: 'Meta',
    domain: 'meta.com',
    industry: 'other',
    size: '500+',
    revenue: 134_900_000_000,
    headquarters: { street: '1 Hacker Way', city: 'Menlo Park', state: 'CA', country: 'US' },
  },
  {
    name: 'Shopify',
    domain: 'shopify.com',
    industry: 'e-commerce',
    size: '500+',
    revenue: 7_000_000_000,
    headquarters: { street: "151 O'Connor St", city: 'Ottawa', state: 'ON', country: 'CA' },
  },
  {
    name: 'Nike',
    domain: 'nike.com',
    industry: 'retail',
    size: '500+',
    revenue: 51_200_000_000,
    headquarters: { street: '1 Bowerman Dr', city: 'Beaverton', state: 'OR', country: 'US' },
  },
  {
    name: 'Starbucks',
    domain: 'starbucks.com',
    industry: 'retail',
    size: '500+',
    revenue: 36_000_000_000,
    headquarters: { street: '2401 Utah Ave S', city: 'Seattle', state: 'WA', country: 'US' },
  },
  {
    name: 'Target',
    domain: 'target.com',
    industry: 'retail',
    size: '500+',
    revenue: 107_400_000_000,
    headquarters: { street: '1000 Nicollet Mall', city: 'Minneapolis', state: 'MN', country: 'US' },
  },
  {
    name: 'Walmart',
    domain: 'walmart.com',
    industry: 'retail',
    size: '500+',
    revenue: 611_300_000_000,
    headquarters: { street: '702 SW 8th St', city: 'Bentonville', state: 'AR', country: 'US' },
  },
  {
    name: 'Tesla',
    domain: 'tesla.com',
    industry: 'manufacturing',
    size: '500+',
    revenue: 96_800_000_000,
    headquarters: { street: '1 Tesla Rd', city: 'Austin', state: 'TX', country: 'US' },
  },
  {
    name: 'Ford',
    domain: 'ford.com',
    industry: 'manufacturing',
    size: '500+',
    revenue: 158_100_000_000,
    headquarters: { street: '1 American Rd', city: 'Dearborn', state: 'MI', country: 'US' },
  },
  {
    name: 'IBM',
    domain: 'ibm.com',
    industry: 'other',
    size: '500+',
    revenue: 61_800_000_000,
    headquarters: { street: '1 New Orchard Rd', city: 'Armonk', state: 'NY', country: 'US' },
  },
  {
    name: 'Oracle',
    domain: 'oracle.com',
    industry: 'saas',
    size: '500+',
    revenue: 50_000_000_000,
    headquarters: { street: '2300 Oracle Way', city: 'Austin', state: 'TX', country: 'US' },
  },
  {
    name: 'Salesforce',
    domain: 'salesforce.com',
    industry: 'saas',
    size: '500+',
    revenue: 34_900_000_000,
    headquarters: { street: '415 Mission St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Adobe',
    domain: 'adobe.com',
    industry: 'saas',
    size: '500+',
    revenue: 19_400_000_000,
    headquarters: { street: '345 Park Ave', city: 'San Jose', state: 'CA', country: 'US' },
  },
  {
    name: 'Spotify',
    domain: 'spotify.com',
    industry: 'other',
    size: '500+',
    revenue: 14_300_000_000,
    headquarters: { street: '4 World Trade Center', city: 'New York', state: 'NY', country: 'US' },
  },
  {
    name: 'Uber',
    domain: 'uber.com',
    industry: 'other',
    size: '500+',
    revenue: 37_300_000_000,
    headquarters: { street: '1515 3rd St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Airbnb',
    domain: 'airbnb.com',
    industry: 'other',
    size: '500+',
    revenue: 9_900_000_000,
    headquarters: { street: '888 Brannan St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Stripe',
    domain: 'stripe.com',
    industry: 'other',
    size: '500+',
    revenue: 14_400_000_000,
    headquarters: { street: '510 Townsend St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Zoom',
    domain: 'zoom.us',
    industry: 'saas',
    size: '500+',
    revenue: 4_500_000_000,
    headquarters: { street: '55 Almaden Blvd', city: 'San Jose', state: 'CA', country: 'US' },
  },
  {
    name: 'Slack',
    domain: 'slack.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_500_000_000,
    headquarters: { street: '500 Howard St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Atlassian',
    domain: 'atlassian.com',
    industry: 'saas',
    size: '500+',
    revenue: 3_500_000_000,
    headquarters: { street: '350 Bush St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Dropbox',
    domain: 'dropbox.com',
    industry: 'saas',
    size: '500+',
    revenue: 2_500_000_000,
    headquarters: { street: '1800 Owens St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'GitHub',
    domain: 'github.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_200_000_000,
    headquarters: {
      street: '88 Colin P Kelly Jr St',
      city: 'San Francisco',
      state: 'CA',
      country: 'US',
    },
  },
  {
    name: 'GitLab',
    domain: 'gitlab.com',
    industry: 'saas',
    size: '500+',
    revenue: 580_000_000,
    headquarters: { street: '268 Bush St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Snowflake',
    domain: 'snowflake.com',
    industry: 'saas',
    size: '500+',
    revenue: 2_600_000_000,
    headquarters: { street: '106 E Babcock St', city: 'Bozeman', state: 'MT', country: 'US' },
  },
  {
    name: 'Databricks',
    domain: 'databricks.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_600_000_000,
    headquarters: { street: '160 Spear St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'MongoDB',
    domain: 'mongodb.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_700_000_000,
    headquarters: { street: '1633 Broadway', city: 'New York', state: 'NY', country: 'US' },
  },
  {
    name: 'Cloudflare',
    domain: 'cloudflare.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_300_000_000,
    headquarters: { street: '101 Townsend St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Twilio',
    domain: 'twilio.com',
    industry: 'saas',
    size: '500+',
    revenue: 4_100_000_000,
    headquarters: { street: '101 Spear St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'HubSpot',
    domain: 'hubspot.com',
    industry: 'saas',
    size: '500+',
    revenue: 2_200_000_000,
    headquarters: { street: '25 First St', city: 'Cambridge', state: 'MA', country: 'US' },
  },
  {
    name: 'Zendesk',
    domain: 'zendesk.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_700_000_000,
    headquarters: { street: '989 Market St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Intercom',
    domain: 'intercom.com',
    industry: 'saas',
    size: '500+',
    revenue: 300_000_000,
    headquarters: { street: '55 2nd St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Notion',
    domain: 'notion.so',
    industry: 'saas',
    size: '201-500',
    revenue: 250_000_000,
    headquarters: { street: '2300 Harrison St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Figma',
    domain: 'figma.com',
    industry: 'saas',
    size: '500+',
    revenue: 600_000_000,
    headquarters: { street: '760 Market St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Canva',
    domain: 'canva.com',
    industry: 'saas',
    size: '500+',
    revenue: 2_000_000_000,
    headquarters: { street: '110 Kippax St', city: 'Sydney', state: 'NSW', country: 'AU' },
  },
  {
    name: 'Asana',
    domain: 'asana.com',
    industry: 'saas',
    size: '500+',
    revenue: 652_000_000,
    headquarters: { street: '633 Folsom St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Monday.com',
    domain: 'monday.com',
    industry: 'saas',
    size: '500+',
    revenue: 906_000_000,
    headquarters: { street: '6 Yitzhak Sadeh St', city: 'Tel Aviv', state: 'TA', country: 'IL' },
  },
  {
    name: 'Zapier',
    domain: 'zapier.com',
    industry: 'saas',
    size: '500+',
    revenue: 310_000_000,
    headquarters: { street: '548 Market St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Mailchimp',
    domain: 'mailchimp.com',
    industry: 'saas',
    size: '500+',
    revenue: 800_000_000,
    headquarters: {
      street: '675 Ponce De Leon Ave NE',
      city: 'Atlanta',
      state: 'GA',
      country: 'US',
    },
  },
  {
    name: 'Klaviyo',
    domain: 'klaviyo.com',
    industry: 'saas',
    size: '500+',
    revenue: 700_000_000,
    headquarters: { street: '125 Summer St', city: 'Boston', state: 'MA', country: 'US' },
  },
  {
    name: 'Eventbrite',
    domain: 'eventbrite.com',
    industry: 'saas',
    size: '500+',
    revenue: 326_000_000,
    headquarters: { street: '155 5th St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'DocuSign',
    domain: 'docusign.com',
    industry: 'saas',
    size: '500+',
    revenue: 2_700_000_000,
    headquarters: { street: '221 Main St', city: 'San Francisco', state: 'CA', country: 'US' },
  },
  {
    name: 'Squarespace',
    domain: 'squarespace.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_000_000_000,
    headquarters: { street: '225 Varick St', city: 'New York', state: 'NY', country: 'US' },
  },
  {
    name: 'Wix',
    domain: 'wix.com',
    industry: 'saas',
    size: '500+',
    revenue: 1_500_000_000,
    headquarters: { street: '40 Namal Tel Aviv St', city: 'Tel Aviv', state: 'TA', country: 'IL' },
  },
  {
    name: 'Etsy',
    domain: 'etsy.com',
    industry: 'e-commerce',
    size: '500+',
    revenue: 2_700_000_000,
    headquarters: { street: '117 Adams St', city: 'Brooklyn', state: 'NY', country: 'US' },
  },
  {
    name: 'eBay',
    domain: 'ebay.com',
    industry: 'e-commerce',
    size: '500+',
    revenue: 10_100_000_000,
    headquarters: { street: '2025 Hamilton Ave', city: 'San Jose', state: 'CA', country: 'US' },
  },
  {
    name: 'Wayfair',
    domain: 'wayfair.com',
    industry: 'e-commerce',
    size: '500+',
    revenue: 12_200_000_000,
    headquarters: { street: '4 Copley Pl', city: 'Boston', state: 'MA', country: 'US' },
  },
  {
    name: 'Chewy',
    domain: 'chewy.com',
    industry: 'e-commerce',
    size: '500+',
    revenue: 11_100_000_000,
    headquarters: { street: '1855 Griffin Rd', city: 'Dania Beach', state: 'FL', country: 'US' },
  },
  {
    name: 'Best Buy',
    domain: 'bestbuy.com',
    industry: 'retail',
    size: '500+',
    revenue: 46_000_000_000,
    headquarters: { street: '7601 Penn Ave S', city: 'Richfield', state: 'MN', country: 'US' },
  },
  {
    name: 'Home Depot',
    domain: 'homedepot.com',
    industry: 'retail',
    size: '500+',
    revenue: 152_700_000_000,
    headquarters: { street: '2455 Paces Ferry Rd', city: 'Atlanta', state: 'GA', country: 'US' },
  },
  {
    name: 'Lululemon',
    domain: 'lululemon.com',
    industry: 'retail',
    size: '500+',
    revenue: 9_600_000_000,
    headquarters: { street: '1818 Cornwall Ave', city: 'Vancouver', state: 'BC', country: 'CA' },
  },
  {
    name: 'Costco',
    domain: 'costco.com',
    industry: 'retail',
    size: '500+',
    revenue: 242_300_000_000,
    headquarters: { street: '999 Lake Dr', city: 'Issaquah', state: 'WA', country: 'US' },
  },
  {
    name: 'Boeing',
    domain: 'boeing.com',
    industry: 'manufacturing',
    size: '500+',
    revenue: 77_800_000_000,
    headquarters: { street: '929 Long Bridge Dr', city: 'Arlington', state: 'VA', country: 'US' },
  },
  {
    name: 'Sysco',
    domain: 'sysco.com',
    industry: 'wholesale',
    size: '500+',
    revenue: 76_300_000_000,
    headquarters: { street: '1390 Enclave Pkwy', city: 'Houston', state: 'TX', country: 'US' },
  },
  {
    name: 'McKesson',
    domain: 'mckesson.com',
    industry: 'wholesale',
    size: '500+',
    revenue: 276_700_000_000,
    headquarters: { street: '6555 State Hwy 161', city: 'Irving', state: 'TX', country: 'US' },
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
    const namePrefix = this.scenario.isExample ? '[Example] ' : ''
    const values = roster.map((c) => ({
      company_name: `${namePrefix}${c.name}`,
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
