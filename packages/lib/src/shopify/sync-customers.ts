import { z } from 'zod'
import { extractShopifyId } from './utils'
import { type Address, type Customer, ORDER_ADDRESS_TYPE } from './shopify-types'

import type { AdminApiClient } from '@shopify/admin-api-client'
import type { ResponseWithType } from '@shopify/admin-api-client'
import {
  convertToCents,
  formatCityName,
  formatCompanyName,
  formatComplexName,
  formatEmail,
  formatPhoneNumber,
  formatStreetAddress,
  withRetry,
} from '../utils'
import pLimit from 'p-limit'
import { database, schema } from '@auxx/database'
import type { Database } from '@auxx/database'
import { eq, sql } from 'drizzle-orm'

const { shopify_customers, Address: AddressTable } = schema
import { createScopedLogger } from '@auxx/logger'
import { linkShopifyCustomer } from '../contacts/sync-contact'
import type { ShopifyAdminClient } from './shopify-webhooks'
const logger = createScopedLogger('sync-customers')

// Prepared statements for database operations
const upsertCustomerPrepared = database
  .insert(shopify_customers)
  .values({
    id: sql.placeholder('id'),
    firstName: sql.placeholder('firstName'),
    lastName: sql.placeholder('lastName'),
    email: sql.placeholder('email'),
    phone: sql.placeholder('phone'),
    createdAt: sql.placeholder('createdAt'),
    updatedAt: sql.placeholder('updatedAt'),
    numberOfOrders: sql.placeholder('numberOfOrders'),
    state: sql.placeholder('state'),
    amountSpent: sql.placeholder('amountSpent'),
    note: sql.placeholder('note'),
    verifiedEmail: sql.placeholder('verifiedEmail'),
    multipassIdentifier: sql.placeholder('multipassIdentifier'),
    taxExempt: sql.placeholder('taxExempt'),
    tags: sql.placeholder('tags'),
    organizationId: sql.placeholder('organizationId'),
    integrationId: sql.placeholder('integrationId'),
  })
  .onConflictDoUpdate({
    target: shopify_customers.id,
    set: {
      firstName: sql.placeholder('firstName'),
      lastName: sql.placeholder('lastName'),
      email: sql.placeholder('email'),
      phone: sql.placeholder('phone'),
      createdAt: sql.placeholder('createdAt'),
      updatedAt: sql.placeholder('updatedAt'),
      numberOfOrders: sql.placeholder('numberOfOrders'),
      state: sql.placeholder('state'),
      amountSpent: sql.placeholder('amountSpent'),
      note: sql.placeholder('note'),
      verifiedEmail: sql.placeholder('verifiedEmail'),
      multipassIdentifier: sql.placeholder('multipassIdentifier'),
      taxExempt: sql.placeholder('taxExempt'),
      tags: sql.placeholder('tags'),
    },
  })
  .prepare('upsertCustomer')

const upsertAddressPrepared = database
  .insert(AddressTable)
  .values({
    id: sql.placeholder('id'),
    firstName: sql.placeholder('firstName'),
    lastName: sql.placeholder('lastName'),
    company: sql.placeholder('company'),
    address1: sql.placeholder('address1'),
    address2: sql.placeholder('address2'),
    city: sql.placeholder('city'),
    zip: sql.placeholder('zip'),
    phone: sql.placeholder('phone'),
    name: sql.placeholder('name'),
    provinceCode: sql.placeholder('provinceCode'),
    countryCode: sql.placeholder('countryCode'),
    customerId: sql.placeholder('customerId'),
    orderType: sql.placeholder('orderType'),
    organizationId: sql.placeholder('organizationId'),
    integrationId: sql.placeholder('integrationId'),
  })
  .onConflictDoUpdate({
    target: AddressTable.id,
    set: {
      firstName: sql.placeholder('firstName'),
      lastName: sql.placeholder('lastName'),
      company: sql.placeholder('company'),
      address1: sql.placeholder('address1'),
      address2: sql.placeholder('address2'),
      city: sql.placeholder('city'),
      zip: sql.placeholder('zip'),
      phone: sql.placeholder('phone'),
      name: sql.placeholder('name'),
      provinceCode: sql.placeholder('provinceCode'),
      countryCode: sql.placeholder('countryCode'),
      orderType: sql.placeholder('orderType'),
    },
  })
  .returning()
  .prepare('upsertAddress')

type SyncOptions = { limit: number; pageInfo?: string | null }

export async function fetchCustomer(ownerId: string, client: ShopifyAdminClient) {
  const response = (await withRetry(() =>
    client.fetch(getOneCustomerGraphQL, { variables: { id: ownerId } })
  )) as ResponseWithType

  const json = await response.json()
  // data.orders.edges
  const data = [{ node: json.data.customer }]
  const formatted = processCustomers(data)
  return formatted[0]
}

export class CustomerSync {
  private shopifyClient: AdminApiClient
  private db: Database
  private organizationId: string
  private integrationId: string

  constructor(
    shopifyClient: AdminApiClient,
    db: Database,
    organizationId: string,
    integrationId: string
  ) {
    this.shopifyClient = shopifyClient
    this.db = db
    this.organizationId = organizationId
    this.integrationId = integrationId
  }

  async sync(): Promise<Customer[]> {
    if (!this.shopifyClient) throw new Error('Shopify client not initialized')

    const customers = await this.fetch({ limit: 120 })

    const result = await this.syncToDB(customers)

    // console.dir(allCustomers, { depth: null, colors: true })
    return result
  }

  async fetch({ limit, pageInfo = null }: SyncOptions): Promise<Customer[]> {
    // let customers: (typeof customerSchema)[] = []
    let allCustomers: Customer[] = []
    let result
    let i = 1
    // let cursor = null
    try {
      do {
        i--

        const response = (await withRetry(() =>
          this.shopifyClient.fetch(getCustomersGraphQL, {
            variables: { first: limit, after: pageInfo },
          })
        )) as ResponseWithType

        const json = await response.json()
        // console.dir(json, { depth: null, colors: true })

        const customers = await this.process(json.data)
        allCustomers = allCustomers.concat(customers)

        // Extract 'page_info' from the 'Link' header for the next page
        // pageInfo = getNextPageInfo(response)
        pageInfo = json?.data?.customers?.pageInfo?.endCursor

        // console.log('pageInfo:', pageInfo)
      } while (pageInfo && i > 0)
      logger.info(`fetched customers: ${allCustomers.length}`)

      return allCustomers

      // return customers
    } catch (error: unknown) {
      logger.error('Error fetching customers:', { error })
      throw error
    }
  }

  async process(data: any) {
    return processCustomers(data.customers.edges)
  }

  async syncToDB(customers: Customer[]): Promise<Customer[]> {
    // console.log(`Syncing ${customers.length} customers to database`)
    // let dbCustomers = []
    const limit = pLimit(10) // Process up to 10 emails concurrently

    await Promise.all(
      customers.map(async (customer, index) => {
        return limit(async () => {
          return upsertCustomer(this.db, customer, index, this.organizationId, this.integrationId)
        })
      })
    )

    return customers
  }
}

// export default fetchAllCustomers
export const upsertCustomer = async (
  db: Database,
  customer: Customer,
  index: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting customer ${index + 1} with id ${customer.id}`)
    //console.dir(customer, { depth: null, colors: true })

    await upsertCustomerPrepared.execute({
      id: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      email: customer.email,
      phone: customer.phone,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
      numberOfOrders: customer.numberOfOrders,
      state: customer.state,
      amountSpent: customer.amountSpent,
      note: customer.note,
      verifiedEmail: customer.verifiedEmail,
      multipassIdentifier: customer.multipassIdentifier,
      taxExempt: customer.taxExempt,
      tags: customer.tags ?? [],
      organizationId,
      integrationId,
    })

    // const addressesToUpsert = new Map()
    const upsertedAddresses: (Awaited<ReturnType<typeof upsertAddress>> | null)[] = []

    for (const address of customer.addresses) {
      address.customer.createdAt = customer.createdAt

      const upsertedAddress = await upsertAddress(
        db,
        address,
        undefined,
        customer.id,
        organizationId,
        integrationId
      )
      upsertedAddresses.push(upsertedAddress)
    }

    await linkShopifyCustomer({
      db,
      shopifyCustomerId: customer.id,
      email: customer.email,
      organizationId,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
    })
    // todo: set default address in customer record !!!
  } catch (error: unknown) {
    logger.error(`Failed to upsert customer ${customer.id}:`, { error })
    throw error
  }
}

export const upsertAddress = async (
  db: Database,
  address: Address,
  type: ORDER_ADDRESS_TYPE | undefined = undefined,
  customerId: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    const result = await upsertAddressPrepared.execute({
      id: address.id,
      firstName: address.firstName,
      lastName: address.lastName,
      company: address.company,
      address1: address.address1,
      address2: address.address2,
      city: address.city,
      zip: address.zip,
      phone: address.phone,
      name: address.name,
      provinceCode: address.provinceCode,
      countryCode: address.countryCode,
      customerId: customerId,
      orderType: type,
      organizationId,
      integrationId,
    })

    return result[0]
  } catch (error: unknown) {
    logger.info(`Failed to upsert Address ${address.id}: ${error}`)
    throw error
  }
}

export const processCustomers = (customers: any) => {
  const result = customers
    .map((c: any, i: number) => {
      logger.info(`Processing customer ${i}: ${c?.node?.id}`)

      try {
        const customer = c.node
        customer.id = extractShopifyId(customer.id)
        customer.firstName = formatComplexName(customer.firstName)
        customer.lastName = formatComplexName(customer.lastName)

        customer.email = formatEmail(customer.email)
        customer.phone = formatPhoneNumber(customer.phone)
        customer.createdAt = new Date(customer.createdAt)
        customer.updatedAt = new Date(customer.updatedAt)
        customer.numberOfOrders = parseInt(customer.numberOfOrders)

        if (customer.lastOrder) {
          customer.lastOrderId = extractShopifyId(customer.lastOrder.id)
          customer.lastOrderName = customer.lastOrder.name
        }
        delete customer.lastOrder

        if (customer.amountSpent) customer.amountSpent = convertToCents(customer.amountSpent.amount)

        customer.addresses = customer.addresses
          .map((address: any) => {
            address = processAddress(address, null, customer.id)
            if (address.address1 === null) return false
            return address
          })
          .filter(Boolean)

        if (customer.defaultAddress && customer.defaultAddress.address1) {
          customer.defaultAddress = processAddress(customer.defaultAddress, 'default', customer.id)

          customer.defaultAddressId = customer.defaultAddress.id
        } else {
          delete customer.defaultAddressId
          delete customer.defaultAddress
        }
        return customer
      } catch (error: unknown) {
        logger.error(`Failed to process customer ${c.node?.id}: ${error}`)
        return null
      }
    })
    .filter(Boolean)

  return result as Customer[]
}

export const processAddress = (address: any, type: string | null, customerId: number) => {
  // address = address || {}
  address.id = extractShopifyId(address?.id)
  address.customerId = customerId
  address.customer = { id: customerId, createdAt: new Date(), updatedAt: new Date() }
  address.countryCode = address.countryCodeV2
  address.address1 = formatStreetAddress(address?.address1)
  address.address2 = formatStreetAddress(address?.address2)
  address.firstName = formatComplexName(address?.firstName)
  address.lastName = formatComplexName(address?.lastName)
  address.name = formatComplexName(address?.name)
  address.city = formatCityName(address?.city)
  address.phone = formatPhoneNumber(address?.phone)
  address.company = formatCompanyName(address?.company)
  delete address.countryCodeV2
  return address
}

export const getCustomersGraphQL = `#graphql
  query CustomerList($first: Int = 2, $after: String, $query: String) {
  customers(first: $first, after: $after, query: $query, reverse: true ) {
    pageInfo {
      hasNextPage
      endCursor
    }
  edges{
    cursor
    node {
      id
      firstName
      lastName
      email
      phone
      createdAt
      updatedAt
      numberOfOrders
      state
      amountSpent {
        amount
        currencyCode
      }
      lastOrder {
        id
        name
      }
      note
      verifiedEmail
      multipassIdentifier
      taxExempt
      tags
      addresses {
        id
        firstName
        lastName
        company
        address1
        address2
        city
        province
        country
        zip
        phone
        name
        provinceCode
        countryCodeV2
      }
      defaultAddress {
        id
        firstName
        lastName
        company
        address1
        address2
        city
        province
        country
        zip
        phone
        name
        provinceCode
        countryCodeV2
      }
      taxExemptions
      emailMarketingConsent {
        marketingState
        marketingOptInLevel
        consentUpdatedAt
      }
      smsMarketingConsent {
        consentCollectedFrom
        consentUpdatedAt
        marketingOptInLevel
        marketingState
      }
    }
  }
}
}`

// export const getOneOrderGraphQL = `query getOneOrder($id: ID!) {
//   order(id: $id) {

export const getOneCustomerGraphQL = `query getOneCustomer($id: ID!) {
  customer(id: $id) {
    id
    firstName
    lastName
    email
    phone
    createdAt
    updatedAt
    numberOfOrders
    state
    amountSpent {
      amount
      currencyCode
    }
    lastOrder {
      id
      name
    }
    note
    verifiedEmail
    multipassIdentifier
    taxExempt
    tags
    addresses {
      id
      firstName
      lastName
      company
      address1
      address2
      city
      province
      country
      zip
      phone
      name
      provinceCode
      countryCodeV2
    }
    defaultAddress {
      id
      firstName
      lastName
      company
      address1
      address2
      city
      province
      country
      zip
      phone
      name
      provinceCode
      countryCodeV2
    }
    taxExemptions
    emailMarketingConsent {
      marketingState
      marketingOptInLevel
      consentUpdatedAt
    }
    smsMarketingConsent {
      consentCollectedFrom
      consentUpdatedAt
      marketingOptInLevel
      marketingState
    }
  }
}`
