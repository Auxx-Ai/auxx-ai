// packages/seed/src/domains/commerce.domain.ts
// Commerce domain refinements for drizzle-seed with comprehensive e-commerce seeding

import { sql } from 'drizzle-orm'
import { ContentEngine } from '../generators/content-engine'
import type { SeedingContext, SeedingScenario, ServiceIntegratorShopifyIntegration } from '../types'
import { BusinessDistributions } from '../utils/business-distributions'
import { RelationshipEngine } from '../utils/relationship-engine'

/** CommerceDomain encapsulates product and order refinements. */
export class CommerceDomain {
  /** scenario stores the resolved scenario definition. */
  private readonly scenario: SeedingScenario
  /** distributions provides realistic business data patterns. */
  private readonly distributions: BusinessDistributions
  /** relationships builds entity connections. */
  private readonly relationships: RelationshipEngine
  /** content generates realistic business content. */
  private readonly content: ContentEngine

  /** shopifyIntegrations caches Shopify integration references from services. */
  private readonly shopifyIntegrations: ServiceIntegratorShopifyIntegration[]
  /** organizationId targets seeding to a specific organization. */
  private readonly organizationId?: string

  /**
   * Creates a new CommerceDomain instance.
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
    this.relationships = new RelationshipEngine(scenario)
    this.content = new ContentEngine(scenario.dataQuality)
    this.organizationId = options?.organizationId

    // Filter integrations by organizationId if specified
    this.shopifyIntegrations = this.organizationId
      ? context.services.shopifyIntegrations.filter((i) => i.organizationId === this.organizationId)
      : context.services.shopifyIntegrations

    if (this.shopifyIntegrations.length === 0) {
      throw new Error(
        `CommerceDomain requires at least one Shopify integration${
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

    // Generate customer data
    console.log('🛒 Generating customer data...')
    const customerAssignments = this.generateCommerceAssignments(this.scenario.scales.customers)
    const customerIds = this.generateCustomerIds()
    const customerTimestamps = this.generateTimestampPairs(this.scenario.scales.customers)
    const customerFirstNames = this.generateFirstNames()
    const customerLastNames = this.generateLastNames()
    const customerEmails = this.generateCustomerEmails()
    const customerPhones = this.generatePhoneNumbers()
    const customerOrderCounts = this.generateOrderCounts()
    const customerStates = this.generateCustomerStates()
    const customerAmountSpent = this.generateAmountSpent()
    const customerVerified = this.generateVerifiedFlags()
    const customerTags = this.generateCustomerTags()

    // Insert customers
    const customerRows = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      customerRows.push({
        id: customerIds[i],
        firstName: customerFirstNames[i],
        lastName: customerLastNames[i],
        email: customerEmails[i],
        phone: customerPhones[i],
        numberOfOrders: customerOrderCounts[i],
        state: customerStates[i],
        amountSpent: customerAmountSpent[i],
        verifiedEmail: customerVerified[i],
        tags: customerTags[i],
        createdAt: customerTimestamps.createdAt[i],
        updatedAt: customerTimestamps.updatedAt[i],
        organizationId: customerAssignments[i]!.organizationId,
        integrationId: customerAssignments[i]!.integrationId,
        defaultAddressId: null,
        lastOrderId: null,
        contactId: null,
      })
    }

    if (customerRows.length > 0) {
      await db
        .insert(schema.shopify_customers)
        .values(customerRows)
        .onConflictDoUpdate({
          target: schema.shopify_customers.id,
          set: {
            firstName: sql`excluded."firstName"`,
            lastName: sql`excluded."lastName"`,
            email: sql`excluded.email`,
            phone: sql`excluded.phone`,
            numberOfOrders: sql`excluded."numberOfOrders"`,
            state: sql`excluded.state`,
            amountSpent: sql`excluded."amountSpent"`,
            verifiedEmail: sql`excluded."verifiedEmail"`,
            tags: sql`excluded.tags`,
            updatedAt: sql`excluded."updatedAt"`,
          },
        })
      console.log(`✅ Upserted ${customerRows.length} customers`)
    }

    // Generate product data
    console.log('🛒 Generating product data...')
    const productAssignments = this.generateCommerceAssignments(this.scenario.scales.products)
    const productIds = this.generateProductIds()
    const productTimestamps = this.generateTimestampPairs(this.scenario.scales.products)
    const productTitles = this.generateProductTitles()
    const productDescriptions = this.generateProductDescriptions()
    const productHandles = this.generateProductHandles()
    const productVendors = this.generateVendors()
    const productTypes = this.generateProductTypes()
    const productStatuses = this.generateProductStatuses()
    const defaultVariants = this.generateDefaultVariantFlags()
    const inventoryTracking = this.generateInventoryTrackingFlags()
    const totalInventory = this.generateTotalInventory()
    const productTags = this.generateProductTags()
    const publishedAt = this.generatePublishedAtDates(productTimestamps.createdAt)

    // Insert products
    const productRows = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      productRows.push({
        id: productIds[i],
        title: productTitles[i],
        descriptionHtml: productDescriptions[i],
        vendor: productVendors[i],
        productType: productTypes[i],
        handle: productHandles[i],
        status: productStatuses[i],
        hasOnlyDefaultVariant: defaultVariants[i],
        tracksInventory: inventoryTracking[i],
        totalInventory: totalInventory[i],
        tags: productTags[i],
        createdAt: productTimestamps.createdAt[i],
        updatedAt: productTimestamps.updatedAt[i],
        publishedAt: publishedAt[i],
        organizationId: productAssignments[i]!.organizationId,
        integrationId: productAssignments[i]!.integrationId,
      })
    }

    if (productRows.length > 0) {
      console.log('📝 Product rows to insert:')
      productRows.forEach((row, i) => {
        console.log(`  [${i}] id=${row.id}, title="${row.title}", handle="${row.handle}"`)
      })

      await db
        .insert(schema.Product)
        .values(productRows)
        .onConflictDoUpdate({
          target: schema.Product.id,
          set: {
            title: sql`excluded.title`,
            descriptionHtml: sql`excluded."descriptionHtml"`,
            vendor: sql`excluded.vendor`,
            productType: sql`excluded."productType"`,
            handle: sql`excluded.handle`,
            status: sql`excluded.status`,
            hasOnlyDefaultVariant: sql`excluded."hasOnlyDefaultVariant"`,
            tracksInventory: sql`excluded."tracksInventory"`,
            totalInventory: sql`excluded."totalInventory"`,
            tags: sql`excluded.tags`,
            updatedAt: sql`excluded."updatedAt"`,
            publishedAt: sql`excluded."publishedAt"`,
          },
        })
      console.log(`✅ Upserted ${productRows.length} products`)
    }

    // Generate and insert Addresses
    await this.seedAddresses(db, schema)

    // Generate and insert Orders
    await this.seedOrders(db, schema)
  }

  /**
   * seedAddresses generates and inserts address records for customers.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   */
  private async seedAddresses(db: any, schema: any): Promise<void> {
    console.log('📍 Generating addresses...')

    const shopifyIntegration = this.shopifyIntegrations[0]!

    // Get existing customers
    const customers = await db
      .select({ id: schema.shopify_customers.id })
      .from(schema.shopify_customers)
      .where(sql`${schema.shopify_customers.organizationId} = ${shopifyIntegration.organizationId}`)

    if (customers.length === 0) {
      console.log('⚠️  No customers found, skipping address generation')
      return
    }

    const addresses = []
    const addressIdCounter = BigInt(30_000_000_000) // Start from 30 billion

    // Create 2 addresses per customer (billing and shipping)
    customers.forEach((customer: any, customerIndex: number) => {
      // Shipping address
      addresses.push({
        id: addressIdCounter + BigInt(customerIndex * 2),
        firstName: this.generateFirstName(customerIndex),
        lastName: this.generateLastName(customerIndex),
        address1: `${100 + customerIndex} Main Street`,
        address2: customerIndex % 3 === 0 ? `Apt ${customerIndex + 1}` : null,
        city: this.generateCity(customerIndex),
        provinceCode: this.generateProvinceCode(customerIndex),
        countryCode: 'US',
        zip: this.generateZipCode(customerIndex),
        phone: this.generatePhoneNumber(customerIndex),
        customerId: customer.id,
        orderType: 'SHIPPING',
        organizationId: shopifyIntegration.organizationId,
        integrationId: shopifyIntegration.id,
      })

      // Billing address (slightly different)
      addresses.push({
        id: addressIdCounter + BigInt(customerIndex * 2 + 1),
        firstName: this.generateFirstName(customerIndex),
        lastName: this.generateLastName(customerIndex),
        address1: `${200 + customerIndex} Oak Avenue`,
        address2: null,
        city: this.generateCity(customerIndex),
        provinceCode: this.generateProvinceCode(customerIndex),
        countryCode: 'US',
        zip: this.generateZipCode(customerIndex),
        phone: this.generatePhoneNumber(customerIndex),
        customerId: customer.id,
        orderType: 'BILLING',
        organizationId: shopifyIntegration.organizationId,
        integrationId: shopifyIntegration.id,
      })
    })

    if (addresses.length > 0) {
      const BATCH_SIZE = 2000

      if (addresses.length > BATCH_SIZE) {
        console.log(`📦 Inserting ${addresses.length} addresses in batches of ${BATCH_SIZE}...`)
      }

      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.Address)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.Address.id,
            set: {
              address1: sql`excluded.address1`,
              city: sql`excluded.city`,
              zip: sql`excluded.zip`,
            },
          })

        if (addresses.length > BATCH_SIZE) {
          console.log(
            `  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(addresses.length / BATCH_SIZE)} complete`
          )
        }
      }

      console.log(`✅ Upserted ${addresses.length} addresses`)
    }
  }

  /**
   * seedOrders generates and inserts order records.
   * @param db - Drizzle database instance
   * @param schema - Database schema
   */
  private async seedOrders(db: any, schema: any): Promise<void> {
    console.log('🛒 Generating orders...')

    const shopifyIntegration = this.shopifyIntegrations[0]!

    // Get existing customers
    const customers = await db
      .select({ id: schema.shopify_customers.id })
      .from(schema.shopify_customers)
      .where(sql`${schema.shopify_customers.organizationId} = ${shopifyIntegration.organizationId}`)

    if (customers.length === 0) {
      console.log('⚠️  No customers found, skipping order generation')
      return
    }

    // Get existing addresses
    const addresses = await db
      .select()
      .from(schema.Address)
      .where(sql`${schema.Address.organizationId} = ${shopifyIntegration.organizationId}`)

    if (addresses.length === 0) {
      console.log('⚠️  No addresses found, skipping order generation')
      return
    }

    const orders = []
    const orderIdCounter = BigInt(40_000_000_000) // Start from 40 billion
    const ordersPerCustomer = Math.ceil(this.scenario.scales.orders / customers.length)

    customers.forEach((customer: any, customerIndex: number) => {
      // Find addresses for this customer
      const customerAddresses = addresses.filter((a: any) => a.customerId === customer.id)
      const shippingAddress = customerAddresses.find((a: any) => a.orderType === 'SHIPPING')
      const billingAddress = customerAddresses.find((a: any) => a.orderType === 'BILLING')

      // Create orders for this customer
      for (let orderIndex = 0; orderIndex < ordersPerCustomer; orderIndex++) {
        const orderId = orderIdCounter + BigInt(customerIndex * ordersPerCustomer + orderIndex)
        const orderNumber = 1000 + customerIndex * ordersPerCustomer + orderIndex
        const subtotal = this.distributions.generateValueInRange(
          2000,
          50000,
          customerIndex + orderIndex
        ) // $20-$500
        const tax = Math.floor(subtotal * 0.08) // 8% tax
        const shipping = this.distributions.generateValueInRange(500, 1500, customerIndex) // $5-$15
        const total = subtotal + tax + shipping

        orders.push({
          id: orderId,
          name: `#${orderNumber}`,
          email: `customer${customerIndex}@example.com`,
          phone: this.generatePhoneNumber(customerIndex),
          financialStatus: this.generateFinancialStatus(orderIndex),
          fulfillmentStatus: this.generateFulfillmentStatus(orderIndex),
          subtotalPrice: subtotal,
          totalTax: tax,
          totalShippingPrice: shipping,
          totalDiscounts: 0,
          totalPrice: total,
          totalRefunded: 0,
          currencyCode: 'USD',
          canNotifyCustomer: true,
          taxExempt: false,
          tags: this.generateOrderTags(orderIndex),
          customerId: customer.id,
          shippingAddressId: shippingAddress?.id || null,
          billingAddressId: billingAddress?.id || null,
          organizationId: shopifyIntegration.organizationId,
          integrationId: shopifyIntegration.id,
          createdAt: new Date(Date.now() - (ordersPerCustomer - orderIndex) * 86400000), // Days ago
          updatedAt: new Date(),
          processedAt: new Date(Date.now() - (ordersPerCustomer - orderIndex) * 86400000),
        })
      }
    })

    if (orders.length > 0) {
      const BATCH_SIZE = 1000

      if (orders.length > BATCH_SIZE) {
        console.log(`📦 Inserting ${orders.length} orders in batches of ${BATCH_SIZE}...`)
      }

      for (let i = 0; i < orders.length; i += BATCH_SIZE) {
        const batch = orders.slice(i, i + BATCH_SIZE)
        await db
          .insert(schema.Order)
          .values(batch)
          .onConflictDoUpdate({
            target: schema.Order.id,
            set: {
              financialStatus: sql`excluded."financialStatus"`,
              fulfillmentStatus: sql`excluded."fulfillmentStatus"`,
              updatedAt: sql`excluded."updatedAt"`,
            },
          })

        if (orders.length > BATCH_SIZE) {
          console.log(
            `  ✓ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(orders.length / BATCH_SIZE)} complete`
          )
        }
      }

      console.log(`✅ Upserted ${orders.length} orders`)
    }
  }

  // ---- Address Generator Methods ----

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
      'Wilson',
      'Anderson',
      'Taylor',
    ]
    return names[index % names.length]!
  }

  /** generateCity creates realistic city names. */
  private generateCity(index: number): string {
    const cities = [
      'New York',
      'Los Angeles',
      'Chicago',
      'Houston',
      'Phoenix',
      'Philadelphia',
      'San Antonio',
      'San Diego',
      'Dallas',
      'Austin',
      'San Francisco',
      'Seattle',
      'Denver',
      'Boston',
      'Portland',
    ]
    return cities[index % cities.length]!
  }

  /** generateProvinceCode creates US state codes. */
  private generateProvinceCode(index: number): string {
    const states = ['NY', 'CA', 'IL', 'TX', 'AZ', 'PA', 'WA', 'CO', 'MA', 'OR']
    return states[index % states.length]!
  }

  /** generateZipCode creates realistic ZIP codes. */
  private generateZipCode(index: number): string {
    const base = 10000 + index * 100
    return base.toString().padStart(5, '0')
  }

  /** generatePhoneNumber creates realistic phone numbers. */
  private generatePhoneNumber(index: number): string {
    const areaCode = 200 + (index % 800)
    const exchange = 200 + (index % 800)
    const number = 1000 + (index % 9000)
    return `+1${areaCode}${exchange}${number}`
  }

  // ---- Order Generator Methods ----

  /** generateFinancialStatus creates realistic order financial statuses. */
  private generateFinancialStatus(index: number): string {
    if (index % 10 === 0) return 'PENDING'
    if (index % 20 === 0) return 'REFUNDED'
    if (index % 30 === 0) return 'PARTIALLY_PAID'
    return 'PAID'
  }

  /** generateFulfillmentStatus creates realistic order fulfillment statuses. */
  private generateFulfillmentStatus(index: number): string {
    if (index % 10 === 0) return 'UNFULFILLED'
    if (index % 5 === 0) return 'IN_PROGRESS'
    if (index % 15 === 0) return 'PARTIALLY_FULFILLED'
    return 'FULFILLED'
  }

  /** generateOrderTags creates realistic order tags. */
  private generateOrderTags(index: number): string[] {
    const tags = []
    if (index % 5 === 0) tags.push('priority')
    if (index % 7 === 0) tags.push('international')
    if (index % 3 === 0) tags.push('gift')
    return tags
  }

  /**
   * buildRefinements produces drizzle-seed refinements for commerce entities (DEPRECATED - use insertDirectly).
   * @returns A function consumed by drizzle-seed refined builder.
   */
  buildRefinements(): (helpers: unknown) => Record<string, unknown> {
    return (helpers: any) => {
      console.log('🛒 Commerce domain buildRefinements called')

      console.log('🛒 Generating customer data...')
      const customerAssignments = this.generateCommerceAssignments(this.scenario.scales.customers)
      const customerIds = this.generateCustomerIds()
      const customerTimestamps = this.generateTimestampPairs(this.scenario.scales.customers)
      const customerFirstNames = this.generateFirstNames()
      const customerLastNames = this.generateLastNames()
      const customerEmails = this.generateCustomerEmails()
      const customerPhones = this.generatePhoneNumbers()
      const customerOrderCounts = this.generateOrderCounts()
      const customerStates = this.generateCustomerStates()
      const customerAmountSpent = this.generateAmountSpent()
      const customerVerified = this.generateVerifiedFlags()
      const customerTags = this.generateCustomerTags()

      const customerDebug = {
        id: customerIds,
        firstName: customerFirstNames,
        lastName: customerLastNames,
        email: customerEmails,
        phone: customerPhones,
        numberOfOrders: customerOrderCounts,
        state: customerStates,
        amountSpent: customerAmountSpent,
        verifiedEmail: customerVerified,
        tags: customerTags,
        createdAt: customerTimestamps.createdAt,
        updatedAt: customerTimestamps.updatedAt,
        organizationId: customerAssignments.map((assignment) => assignment.organizationId),
        integrationId: customerAssignments.map((assignment) => assignment.integrationId),
      }

      Object.entries(customerDebug).forEach(([key, value]) => {
        console.log(`   ↳ shopify_customers.${key}: ${value.length}`)
      })

      const customerData = {
        id: helpers.valuesFromArray({ values: customerIds }),
        firstName: helpers.valuesFromArray({ values: customerFirstNames }),
        lastName: helpers.valuesFromArray({ values: customerLastNames }),
        email: helpers.valuesFromArray({ values: customerEmails }),
        phone: helpers.valuesFromArray({ values: customerPhones }),
        numberOfOrders: helpers.valuesFromArray({ values: customerOrderCounts }),
        state: helpers.valuesFromArray({ values: customerStates }),
        amountSpent: helpers.valuesFromArray({ values: customerAmountSpent }),
        verifiedEmail: helpers.valuesFromArray({ values: customerVerified }),
        tags: helpers.valuesFromArray({ values: customerTags }),
        createdAt: helpers.valuesFromArray({ values: customerTimestamps.createdAt }),
        updatedAt: helpers.valuesFromArray({ values: customerTimestamps.updatedAt }),
        organizationId: helpers.valuesFromArray({
          values: customerAssignments.map((assignment) => assignment.organizationId),
        }),
        integrationId: helpers.valuesFromArray({
          values: customerAssignments.map((assignment) => assignment.integrationId),
        }),
        // Explicitly set nullable foreign keys to null (these tables are not seeded)
        defaultAddressId: helpers.valuesFromArray({
          values: Array(this.scenario.scales.customers).fill(null),
        }),
        lastOrderId: helpers.valuesFromArray({
          values: Array(this.scenario.scales.customers).fill(null),
        }),
        contactId: helpers.valuesFromArray({
          values: Array(this.scenario.scales.customers).fill(null),
        }),
      }
      console.log('✅ Customer data generated')

      // Validate customer data
      this.validateCustomerData({
        emails: customerEmails,
        ids: customerIds,
      })

      console.log('🛒 Generating product data...')

      // Generate assignments and timestamps first (needed for other generators)
      const productAssignments = this.generateCommerceAssignments(this.scenario.scales.products)
      const productTimestamps = this.generateTimestampPairs(this.scenario.scales.products)

      // Pre-generate ALL product data to ensure consistency
      // This prevents multiple calls to getProductDescriptions() which could generate different data each time
      const productIds = this.generateProductIds()
      const productTitles = this.generateProductTitles()
      const productDescriptions = this.generateProductDescriptions()
      const productHandles = this.generateProductHandles()
      const productVendors = this.generateVendors()
      const productTypes = this.generateProductTypes()
      const productStatuses = this.generateProductStatuses()
      const defaultVariants = this.generateDefaultVariantFlags()
      const inventoryTracking = this.generateInventoryTrackingFlags()
      const totalInventory = this.generateTotalInventory()
      const productTags = this.generateProductTags()
      const publishedAt = this.generatePublishedAtDates(productTimestamps.createdAt)

      // Log generated data for debugging
      console.log('📝 Generated product data:')
      for (let i = 0; i < productIds.length; i++) {
        console.log(
          `  [${i}] id=${productIds[i]}, title="${productTitles[i]}", handle="${productHandles[i]}"`
        )
      }

      // Build product data with pre-generated arrays
      const productData = {
        id: helpers.valuesFromArray({ values: [...productIds] }), // Spread to create new array
        title: helpers.valuesFromArray({ values: [...productTitles] }),
        descriptionHtml: helpers.valuesFromArray({ values: [...productDescriptions] }),
        vendor: helpers.valuesFromArray({ values: [...productVendors] }),
        productType: helpers.valuesFromArray({ values: [...productTypes] }),
        handle: helpers.valuesFromArray({ values: [...productHandles] }),
        status: helpers.valuesFromArray({ values: [...productStatuses] }),
        hasOnlyDefaultVariant: helpers.valuesFromArray({ values: [...defaultVariants] }),
        tracksInventory: helpers.valuesFromArray({ values: [...inventoryTracking] }),
        totalInventory: helpers.valuesFromArray({ values: [...totalInventory] }),
        tags: helpers.valuesFromArray({ values: [...productTags] }),
        createdAt: helpers.valuesFromArray({ values: [...productTimestamps.createdAt] }),
        updatedAt: helpers.valuesFromArray({ values: [...productTimestamps.updatedAt] }),
        publishedAt: helpers.valuesFromArray({ values: [...publishedAt] }),
        organizationId: helpers.valuesFromArray({
          values: productAssignments.map((assignment) => assignment.organizationId),
        }),
        integrationId: helpers.valuesFromArray({
          values: productAssignments.map((assignment) => assignment.integrationId),
        }),
      }
      console.log('✅ Product data generated')

      console.log('🛒 Building final commerce refinements object...')
      const result = {
        shopify_customers: {
          count: this.scenario.scales.customers,
          columns: customerData,
        },
        Product: {
          count: this.scenario.scales.products,
          columns: productData,
        },
      }
      Object.entries(result).forEach(([table, config]) => {
        const count = (config as { count?: number }).count ?? 'unknown'
        console.log(`🧱 Commerce refinements prepared: ${table} (${count})`)
      })
      console.log('✅ Commerce refinements object built successfully')
      return result
    }
  }

  // ---- Customer Generator Methods ----

  /** generateFirstNames creates realistic customer first names. */
  private generateFirstNames(): string[] {
    console.log('  🔸 generateFirstNames started')
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
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      result.push(names[i % names.length]!)
    }
    console.log(`  ✅ generateFirstNames completed (${result.length} names)`)
    return result
  }

  /** generateLastNames creates realistic customer last names. */
  private generateLastNames(): string[] {
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
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      result.push(names[i % names.length]!)
    }
    return result
  }

  /** generateCustomerEmails creates realistic customer email addresses. */
  private generateCustomerEmails(): string[] {
    const firstNames = [
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
    const lastNames = [
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
    const domains = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com']
    const emails: string[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      const first = firstNames[i % firstNames.length]!.toLowerCase()
      const last = lastNames[i % lastNames.length]!.toLowerCase()
      const domain = domains[i % domains.length]!
      emails.push(`${first}.${last}${i > 100 ? i : ''}@${domain}`)
    }
    return emails
  }

  /** generatePhoneNumbers creates realistic phone numbers. */
  private generatePhoneNumbers(): (string | null)[] {
    const phones: (string | null)[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      if (i % 3 === 0) {
        phones.push(null) // 33% no phone
      } else {
        const areaCode = 200 + (i % 800)
        const exchange = 200 + (i % 800)
        const number = 1000 + (i % 9000)
        phones.push(`+1${areaCode}${exchange}${number}`)
      }
    }
    return phones
  }

  /** generateOrderCounts creates realistic customer order counts. */
  private generateOrderCounts(): number[] {
    const counts: number[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      if (i % 10 === 0)
        counts.push(this.distributions.generateValueInRange(20, 50, i)) // 10% VIP
      else if (i % 5 === 0)
        counts.push(this.distributions.generateValueInRange(8, 20, i)) // 20% loyal
      else if (i % 3 === 0)
        counts.push(this.distributions.generateValueInRange(3, 8, i)) // 33% regular
      else counts.push(this.distributions.generateValueInRange(1, 3, i)) // rest occasional
    }
    return counts
  }

  /** generateCustomerStates creates realistic customer account states. */
  private generateCustomerStates(): string[] {
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      if (i % 100 < 85) result.push('enabled')
      else if (i % 100 < 95) result.push('disabled')
      else if (i % 100 < 99) result.push('invited')
      else result.push('declined')
    }
    return result
  }

  /** generateAmountSpent creates realistic customer lifetime values. */
  private generateAmountSpent(): number[] {
    const amounts: number[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      // Generate order count inline to avoid circular dependency
      let orderCount: number
      if (i % 10 === 0)
        orderCount = this.distributions.generateValueInRange(20, 50, i) // 10% VIP
      else if (i % 5 === 0)
        orderCount = this.distributions.generateValueInRange(8, 20, i) // 20% loyal
      else if (i % 3 === 0)
        orderCount = this.distributions.generateValueInRange(3, 8, i) // 33% regular
      else orderCount = this.distributions.generateValueInRange(1, 3, i) // rest occasional

      const orderValue = this.distributions.selectWeightedValue(
        this.distributions.getOrderValueDistribution(),
        i
      )
      const totalSpent = this.distributions.generateValueInRange(
        orderValue.min * orderCount,
        orderValue.max * orderCount,
        i
      )
      amounts.push(totalSpent * 100) // Convert to cents
    }
    return amounts
  }

  /** generateVerifiedFlags creates realistic email verification status. */
  private generateVerifiedFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      flags.push(i % 10 !== 0) // 90% verified
    }
    return flags
  }

  /** generateCustomerTags creates realistic customer tags. */
  private generateCustomerTags(): string[][] {
    const availableTags = [
      'vip',
      'wholesale',
      'retail',
      'new_customer',
      'returning_customer',
      'high_value',
      'frequent_buyer',
      'seasonal',
      'corporate',
      'individual',
    ]
    const tagSets: string[][] = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      const numTags = this.distributions.generateValueInRange(0, 3, i)
      const tags: string[] = []
      for (let j = 0; j < numTags; j++) {
        const tag = availableTags[(i + j) % availableTags.length]!
        if (!tags.includes(tag)) {
          tags.push(tag)
        }
      }
      tagSets.push(tags)
    }
    return tagSets
  }

  // ---- Product Generator Methods ----

  /** getProductDescriptions generates fresh product descriptions */
  private getProductDescriptions() {
    // ALWAYS generate fresh to avoid any caching issues with drizzle-seed
    console.log('  🔸 Generating product descriptions (fresh)')

    const products: Array<{
      name: string
      description: string
      tagline: string
      category: string
    }> = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const productNumber = i + 1
      products.push({
        name: `Product ${productNumber}`,
        description: `This is a great product for your needs. Product ${productNumber} offers excellent value.`,
        tagline: `Quality Product ${productNumber}`,
        category: 'Electronics', // Fixed category for consistency
      })
    }

    console.log(`  ✅ Generated ${products.length} unique product descriptions`)

    // Validate uniqueness
    const names = products.map((p) => p.name)
    const uniqueNames = new Set(names)
    if (names.length !== uniqueNames.size) {
      throw new Error('Product cache contains duplicate names!')
    }

    return products
  }

  /** generateProductTitles creates realistic product names. */
  private generateProductTitles(): string[] {
    console.log('  🔸 generateProductTitles started')
    const products = this.getProductDescriptions()
    const titles = products.map((p) => p.name)
    console.log(`  ✅ generateProductTitles completed (${titles.length} titles)`)
    return titles
  }

  /** generateProductDescriptions creates realistic product descriptions. */
  private generateProductDescriptions(): string[] {
    console.log('  🔸 generateProductDescriptions started')
    const products = this.getProductDescriptions()
    const descriptions = products.map(
      (p) => `<p>${p.description}</p><p><strong>${p.tagline}</strong></p>`
    )
    console.log(`  ✅ generateProductDescriptions completed (${descriptions.length} descriptions)`)
    return descriptions
  }

  /** generateVendors creates realistic vendor names. */
  private generateVendors(): string[] {
    const vendors = [
      'Acme Corp',
      'Global Supplies',
      'Premium Brands',
      'Elite Manufacturing',
      'Quality Goods Co',
      'Superior Products',
      'Trusted Suppliers',
      'Best Choice',
      'Top Tier',
      'Excellence Inc',
      'Prime Vendor',
      'Select Brands',
    ]
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      result.push(vendors[i % vendors.length]!)
    }
    return result
  }

  /** generateProductTypes creates realistic product categories. */
  private generateProductTypes(): string[] {
    const categories = this.distributions.getProductCategoryMix()
    const result: string[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const category = this.distributions.selectWeightedValue(categories, i)
      result.push(category)
    }
    return result
  }

  /** generateProductHandles creates URL-friendly product handles. */
  private generateProductHandles(): string[] {
    console.log('  🔸 generateProductHandles started')
    const handles: string[] = []
    const usedHandles = new Set<string>()
    const products = this.getProductDescriptions()

    products.forEach((product, i) => {
      const baseHandle = product.name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, '-')
        .substring(0, 50)

      // Ensure uniqueness by adding index
      let handle = `${baseHandle}-${i + 1}`
      let suffix = 0

      // If somehow still duplicate, add incrementing suffix
      while (usedHandles.has(handle)) {
        suffix++
        handle = `${baseHandle}-${i + 1}-${suffix}`
      }

      usedHandles.add(handle)
      handles.push(handle)
    })

    console.log(`  ✅ generateProductHandles completed (${handles.length} handles)`)
    console.log(`  📊 Unique handles: ${usedHandles.size}/${handles.length}`)

    return handles
  }

  /** generateProductStatuses creates realistic product publication status. */
  private generateProductStatuses(): ('ACTIVE' | 'ARCHIVED' | 'DRAFT')[] {
    const statuses: ('ACTIVE' | 'ARCHIVED' | 'DRAFT')[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      if (i % 20 === 0)
        statuses.push('DRAFT') // 5% draft
      else if (i % 15 === 0)
        statuses.push('ARCHIVED') // ~7% archived
      else statuses.push('ACTIVE') // ~88% active
    }
    return statuses
  }

  /** generateDefaultVariantFlags creates realistic default variant flags. */
  private generateDefaultVariantFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      flags.push(i % 3 === 0) // 33% have only default variant
    }
    return flags
  }

  /** generateInventoryTrackingFlags creates realistic inventory tracking settings. */
  private generateInventoryTrackingFlags(): boolean[] {
    const flags: boolean[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      flags.push(i % 5 !== 0) // 80% track inventory
    }
    return flags
  }

  /** generateTotalInventory creates realistic inventory levels. */
  private generateTotalInventory(): number[] {
    const inventory: number[] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const level = this.distributions.selectWeightedValue(
        this.distributions.getInventoryLevels(),
        i
      )
      inventory.push(level.quantity)
    }
    return inventory
  }

  /** generateProductTags creates realistic product tags. */
  private generateProductTags(): string[][] {
    const availableTags = [
      'new-arrival',
      'bestseller',
      'sale',
      'featured',
      'limited-edition',
      'eco-friendly',
      'premium',
      'budget-friendly',
      'trending',
      'seasonal',
    ]
    const tagSets: string[][] = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      const numTags = this.distributions.generateValueInRange(1, 4, i)
      const tags: string[] = []
      for (let j = 0; j < numTags; j++) {
        const tag = availableTags[(i + j) % availableTags.length]!
        if (!tags.includes(tag)) {
          tags.push(tag)
        }
      }
      tagSets.push(tags)
    }
    return tagSets
  }

  /** generateCustomerIds produces deterministic bigint identifiers for Shopify customers. */
  private generateCustomerIds(): bigint[] {
    const base = BigInt(10_000_000_000)
    const ids: Array<bigint> = []
    for (let i = 0; i < this.scenario.scales.customers; i++) {
      ids.push(base + BigInt(i))
    }
    return ids
  }

  /** generateProductIds produces deterministic bigint identifiers for products. */
  private generateProductIds(): bigint[] {
    const base = BigInt(20_000_000_000)
    const ids: Array<bigint> = []
    for (let i = 0; i < this.scenario.scales.products; i++) {
      ids.push(base + BigInt(i))
    }
    return ids
  }

  /** generateCommerceAssignments creates organization/integration assignments per entity. */
  private generateCommerceAssignments(
    count: number
  ): Array<{ organizationId: string; integrationId: string }> {
    return Array.from({ length: count }, (_, index) => {
      const integration = this.shopifyIntegrations[index % this.shopifyIntegrations.length]!
      return { organizationId: integration.organizationId, integrationId: integration.id }
    })
  }

  /** generateTimestampPairs produces deterministic createdAt/updatedAt pairs. */
  private generateTimestampPairs(count: number): { createdAt: Date[]; updatedAt: Date[] } {
    const createdAt: Date[] = []
    const updatedAt: Date[] = []
    const base = Date.now() - count * 60000

    for (let i = 0; i < count; i++) {
      const created = new Date(base + i * 60000)
      createdAt.push(created)
      updatedAt.push(new Date(created.getTime() + 5 * 60000))
    }

    return { createdAt, updatedAt }
  }

  /** generatePublishedAtDates derives optional published timestamps from created dates. */
  private generatePublishedAtDates(created: Date[]): Array<Date | null> {
    return created.map((date, index) =>
      index % 6 === 0 ? null : new Date(date.getTime() + 90 * 60000)
    )
  }

  /**
   * validateProductData validates product data before seeding.
   * @param data - Product data to validate
   * @throws Error if validation fails
   */
  private validateProductData(data: { handles: string[]; titles: string[]; ids: bigint[] }): void {
    console.log('  🔍 Validating product data...')

    // Validate array lengths match
    const lengths = [data.handles.length, data.titles.length, data.ids.length]
    if (new Set(lengths).size !== 1) {
      throw new Error(
        `Product array length mismatch: handles=${data.handles.length}, titles=${data.titles.length}, ids=${data.ids.length}`
      )
    }

    // Validate handle uniqueness
    const uniqueHandles = new Set(data.handles)
    if (data.handles.length !== uniqueHandles.size) {
      const duplicates = data.handles.filter((h, i) => data.handles.indexOf(h) !== i)
      throw new Error(`Duplicate product handles detected: ${duplicates.join(', ')}`)
    }

    // Validate ID uniqueness
    const uniqueIds = new Set(data.ids.map((id) => id.toString()))
    if (data.ids.length !== uniqueIds.size) {
      throw new Error('Duplicate product IDs detected')
    }

    // Validate no empty handles
    const emptyHandles = data.handles.filter((h) => !h || h.trim() === '')
    if (emptyHandles.length > 0) {
      throw new Error(`Empty product handles detected: ${emptyHandles.length} empty values`)
    }

    console.log('  ✅ Product data validation passed')
  }

  /**
   * validateCustomerData validates customer data before seeding.
   * @param data - Customer data to validate
   * @throws Error if validation fails
   */
  private validateCustomerData(data: { emails: string[]; ids: bigint[] }): void {
    console.log('  🔍 Validating customer data...')

    // Validate array lengths match
    if (data.emails.length !== data.ids.length) {
      throw new Error(
        `Customer array length mismatch: emails=${data.emails.length}, ids=${data.ids.length}`
      )
    }

    // Validate email uniqueness
    const uniqueEmails = new Set(data.emails)
    if (data.emails.length !== uniqueEmails.size) {
      const duplicates = data.emails.filter((e, i) => data.emails.indexOf(e) !== i)
      throw new Error(`Duplicate customer emails detected: ${duplicates.join(', ')}`)
    }

    // Validate ID uniqueness
    const uniqueIds = new Set(data.ids.map((id) => id.toString()))
    if (data.ids.length !== uniqueIds.size) {
      throw new Error('Duplicate customer IDs detected')
    }

    console.log('  ✅ Customer data validation passed')
  }
}
