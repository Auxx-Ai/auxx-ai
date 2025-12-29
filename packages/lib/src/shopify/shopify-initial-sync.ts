// packages/lib/src/shopify/shopify-initial-sync.ts

import type { AdminApiClient } from '@shopify/admin-api-client'
import { database, type Database } from '@auxx/database'

export class ShopifyInitialSync {
  //  private account: AccountType
  private client: AdminApiClient
  private db: Database = database
  private userId: string
  // private session: Session
  // private gmail

  constructor(shopifyClient: AdminApiClient, userId: string) {
    this.client = shopifyClient
    this.userId = userId
  }

  async sync() {
    if (!this.client) throw new Error('Shopify client not initialized')

    // return { orders: allOrders, customers: allCustomers, products: allProducts }
  }
}
