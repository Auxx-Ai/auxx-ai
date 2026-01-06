import type { Product, ProductMedia, ProductOption, ProductVariant } from './shopify-types'
import { extractShopifyId } from './utils'

import type { AdminApiClient, ResponseWithType } from '@shopify/admin-api-client'
import { convertToCents, withRetry } from '@auxx/utils'
import { database as db, type Database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ShopifyAdminClient } from './shopify-webhooks'

export const syncProducts = async () => {
  // shopifyClient
}

type SyncOptions = { limit: number; pageInfo?: string | null }
const logger = createScopedLogger('sync-products')

export async function fetchProduct(ownerId: string, client: ShopifyAdminClient) {
  const response = (await withRetry(() =>
    client.fetch(getOneProductGraphQL, { variables: { id: ownerId } })
  )) as ResponseWithType

  const json = await response.json()
  const data = [{ node: json.data.product }]
  const formatted = processProducts(data)
  return formatted[0]
}

export class ProductSync {
  private shopifyClient: AdminApiClient
  private db: Database
  private organizationId: string
  private integrationId: string

  constructor(
    shopifyClient: AdminApiClient,
    database: Database,
    organizationId: string,
    integrationId: string
  ) {
    this.shopifyClient = shopifyClient
    this.db = database
    this.organizationId = organizationId
    this.integrationId = integrationId
  }

  async sync(): Promise<Product[]> {
    if (!this.shopifyClient) throw new Error('Shopify client not initialized')

    const allProducts = await this.fetch({ limit: 50 })

    const result = await this.syncToDB(allProducts)

    return result
  }

  async fetch({ limit, pageInfo = null }: SyncOptions) {
    let result
    let allProducts: Product[] = []
    const i = 2
    try {
      do {
        // i--

        const response = (await withRetry(() =>
          this.shopifyClient.fetch(getProductsGraphQL, {
            variables: { first: limit, after: pageInfo },
          })
        )) as ResponseWithType

        const json = await response.json()
        if (json.errors) {
          console.dir(json.errors, { depth: null, colors: true })
          throw new Error('Error fetching orders from Shopify')
        }

        const products = await this.process(json.data)
        allProducts = allProducts.concat(products)

        pageInfo = json?.data?.products?.pageInfo?.endCursor
      } while (pageInfo && i > 0)

      return allProducts
    } catch (error: any) {
      logger.error('Error fetching products:', { error })
      throw error
    }
  }

  async process(data: any) {
    return processProducts(data.products.edges)
  }

  async syncToDB(products: Product[]): Promise<Product[]> {
    for (const [index, product] of products.entries()) {
      await upsertProduct(this.db, product, index, this.organizationId, this.integrationId)
    }

    return products
  }
}

export const upsertProduct = async (
  db: Database,
  product: Product,
  index: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting product ${index + 1} with id ${product.id}`)

    // Upsert Product with direct Drizzle query
    const [dbProduct] = await db
      .insert(schema.Product)
      .values({
        id: product.id,
        organizationId,
        integrationId,
        createdAt: product.createdAt,
        updatedAt: product.updatedAt,
        publishedAt: product.publishedAt,
        title: product.title,
        descriptionHtml: product.descriptionHtml,
        vendor: product.vendor,
        hasOnlyDefaultVariant: product.hasOnlyDefaultVariant,
        productType: product.productType,
        handle: product.handle,
        status: product.status,
        tags: product.tags,
        tracksInventory: product.tracksInventory,
        totalInventory: product.totalInventory,
      })
      .onConflictDoUpdate({
        target: schema.Product.id,
        set: {
          organizationId,
          integrationId,
          createdAt: product.createdAt,
          updatedAt: product.updatedAt,
          publishedAt: product.publishedAt,
          title: product.title,
          descriptionHtml: product.descriptionHtml,
          vendor: product.vendor,
          hasOnlyDefaultVariant: product.hasOnlyDefaultVariant,
          productType: product.productType,
          handle: product.handle,
          status: product.status,
          tags: product.tags,
          tracksInventory: product.tracksInventory,
          totalInventory: product.totalInventory,
        },
      })
      .returning()

    // Upsert Product variants
    for (const [vi, variant] of product.variants.entries()) {
      await upsertProductVariant(db, variant, product.id, vi, organizationId, integrationId)
    }

    // Upsert Product Media
    for (const [vi, media] of product.media.entries()) {
      await upsertProductMedia(db, media, product.id, vi, organizationId, integrationId)
    }
    // Upsert Product Options
    for (const [vi, option] of product.options.entries()) {
      await upsertProductOption(db, option, product.id, vi, organizationId, integrationId)
    }
  } catch (error: any) {
    logger.error(`Error upserting product ${product.id}:`, { error: error.message || error })
  }
}

const upsertProductVariant = async (
  db: Database,
  variant: ProductVariant,
  productId: number,
  index: number,
  organizationId: string,
  integrationId: string
) => {
  try {
    logger.info(`Upserting product variant ${index + 1} with id ${variant.id}`)

    // Upsert Product Variant with direct Drizzle query
    const [dbVariant] = await db
      .insert(schema.ProductVariant)
      .values({
        id: variant.id,
        organizationId,
        integrationId,
        availableForSale: variant.availableForSale,
        barcode: variant.barcode,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
        displayName: variant.displayName,
        position: variant.position,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        sku: variant.sku,
        taxable: variant.taxable,
        title: variant.title,
        selectedOptions: variant.selectedOptions,
        imageId: variant.imageId,
        imageUrl: variant.imageUrl,
        inventoryItemId: variant.inventoryItemId,
        inventoryManagement: variant.inventoryManagement,
        inventoryPolicy: variant.inventoryPolicy,
        inventoryQuantity: variant.inventoryQuantity,
        weightUnit: variant.inventoryItem?.measurement?.weight?.unit,
        weight: variant.inventoryItem?.measurement?.weight?.value,
        productId: productId,
      })
      .onConflictDoUpdate({
        target: schema.ProductVariant.id,
        set: {
          organizationId,
          integrationId,
          availableForSale: variant.availableForSale,
          barcode: variant.barcode,
          createdAt: variant.createdAt,
          updatedAt: variant.updatedAt,
          displayName: variant.displayName,
          position: variant.position,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
          sku: variant.sku,
          taxable: variant.taxable,
          title: variant.title,
          selectedOptions: variant.selectedOptions,
          imageId: variant.imageId,
          imageUrl: variant.imageUrl,
          inventoryItemId: variant.inventoryItemId,
          inventoryManagement: variant.inventoryManagement,
          inventoryPolicy: variant.inventoryPolicy,
          inventoryQuantity: variant.inventoryQuantity,
          weightUnit: variant.inventoryItem?.measurement?.weight?.unit,
          weight: variant.inventoryItem?.measurement?.weight?.value,
          productId: productId,
        },
      })
      .returning()

    return dbVariant
  } catch (error: any) {
    logger.error(`Error upserting variant ${variant.id}:`, { error: error.message || error })
  }
}

const upsertProductMedia = async (
  db: Database,
  media: ProductMedia,
  productId: number,
  index: number,
  _organizationId: string,
  _integrationId: string
) => {
  try {
    logger.info(`Upserting product media ${index + 1} with id ${media.id}`)

    // Upsert Product Media with direct Drizzle query
    const [dbMedia] = await db
      .insert(schema.ProductMedia)
      .values({
        id: media.id,
        alt: media.alt,
        mediaContentType: media.mediaContentType,
        previewId: media.preview?.id,
        previewAlt: media.preview?.altText,
        previewHeight: media.preview?.height,
        previewWidth: media.preview?.width,
        previewUrl: media.preview?.url,
        width: media.preview?.width,
        height: media.preview?.height,
        productId: productId,
      })
      .onConflictDoUpdate({
        target: schema.ProductMedia.id,
        set: {
          alt: media.alt,
          mediaContentType: media.mediaContentType,
          previewId: media.preview?.id,
          previewAlt: media.preview?.altText,
          previewHeight: media.preview?.height,
          previewWidth: media.preview?.width,
          previewUrl: media.preview?.url,
          width: media.preview?.width,
          height: media.preview?.height,
          productId: productId,
        },
      })
      .returning()

    return dbMedia
  } catch (error: any) {
    logger.error(`Error upserting media ${media.id}:`, { error: error.message || error })
  }
}

const upsertProductOption = async (
  db: Database,
  option: ProductOption,
  productId: number,
  index: number,
  _organizationId: string,
  _integrationId: string
) => {
  try {
    logger.info(`Upserting product option ${index + 1} with id ${option.id}`)

    // Upsert Product Option with direct Drizzle query
    const [dbOption] = await db
      .insert(schema.ProductOption)
      .values({
        id: option.id,
        name: option.name,
        position: option.position,
        values: option.values,
        productId: productId,
      })
      .onConflictDoUpdate({
        target: schema.ProductOption.id,
        set: {
          name: option.name,
          position: option.position,
          values: option.values,
          productId: productId,
        },
      })
      .returning()

    return dbOption
  } catch (error: any) {
    logger.error(`Error upserting product option ${option.id}:`, { error: error.message || error })
  }
}

export const processProducts = (products: any) => {
  const result = products.map((p: any) => {
    p.node.id = extractShopifyId(p.node.id)
    p.node.createdAt = new Date(p.node.createdAt)
    p.node.updatedAt = new Date(p.node.updatedAt)
    p.node.publishedAt = p.node.publishedAt ? new Date(p.node.publishedAt) : null
    p.node.variants = p.node.variants.edges.map((v: any) => {
      v.node.id = extractShopifyId(v.node.id)
      v.node.createdAt = new Date(v.node.createdAt)
      v.node.updatedAt = new Date(v.node.updatedAt)
      v.node.price = convertToCents(v.node.price)
      v.node.compareAtPrice = convertToCents(v.node.compareAtPrice)
      v.node.inventoryItemId = v.node.inventoryItem
        ? extractShopifyId(v.node.inventoryItem.id)
        : null

      v.node.imageId = v.node.image ? extractShopifyId(v.node.image?.id) : null
      v.node.imageUrl = v.node.image ? v.node.image?.url : null

      return v.node
    })

    p.node.media = p.node.media.edges.map((m: any) => {
      m.node.id = extractShopifyId(m.node.id)
      m.node.preview = m.node.preview.image
      m.node.preview.id = extractShopifyId(m.node.preview.id)
      return m.node
    })

    p.node.images = p.node.images.edges.map((i: any) => {
      i.node.id = extractShopifyId(i.node.id)
      i.node.url = i.node.originalSrc
      return i.node
    })
    p.node.options = p.node.options.map((o: any) => {
      o.id = extractShopifyId(o.id)
      o.productId = p.node.id
      return o
    })

    return p.node
  }) as Product[]

  // console.log(z.array(productSchema).parse(result)) // Validate the result against
  return result
}

export const getProductsGraphQL = `query 
getAllProducts($first: Int = 250, $after: String) {
  products(first: $first, after: $after) {
    pageInfo {
      hasNextPage
      endCursor
    }
    edges {
      cursor
      node {
        id
        title
        descriptionHtml
        handle
        vendor
        tags
        productType
        publishedAt
        createdAt
        updatedAt
        tracksInventory
        hasOnlyDefaultVariant
        totalInventory
        status
        options(first: 3) {
          id
          name
          values
          position
        }
        media(first: 250) {
          edges {
            node {
              id
              alt
              mediaContentType
              preview {
                image{
                  id
                  altText
                  height
                  width
                  url
                }
              }
            }
          }
        }
        images(first: 250) {
          edges {
            node {
              id
              originalSrc
              altText
              url
            }
          }
        }
        variants(first: 250) {
          edges {
            node {
              id
              title
              sku
              price
              compareAtPrice
              availableForSale
              barcode
              displayName
              inventoryPolicy
              inventoryQuantity
              position
              createdAt
              updatedAt
              taxable    
              selectedOptions {
                name
                value
              }
              image {
                id
                altText
                url
              }
              inventoryItem {
                id
                measurement {
                  weight {
                    value
                    unit
                  }

                }
              }  

            }
          }
        }
      }
    }
  }
}`

export const getOneProductGraphQL = `query 
getOneProduct($id: ID!) {
  product(id: $id) {
    id
    title
    descriptionHtml
    handle
    vendor
    tags
    productType
    publishedAt
    createdAt
    updatedAt
    tracksInventory
    hasOnlyDefaultVariant
    totalInventory
    status
    options(first: 3) {
      id
      name
      values
      position
    }
    media(first: 250) {
      edges {
        node {
          id
          alt
          mediaContentType
          preview {
            image {
              id
              altText
              height
              width
              url
            }
          }
        }
      }
    }
    images(first: 250) {
      edges {
        node {
          id
          originalSrc
          altText
          url
        }
      }
    }
    variants(first: 250) {
      edges {
        node {
          id
          title
          sku
          price
          compareAtPrice
          availableForSale
          barcode
          displayName
          inventoryPolicy
          inventoryQuantity
          position
          createdAt
          updatedAt
          taxable
          selectedOptions {
            name
            value
          }
          image {
            id
            altText
            url
          }
          inventoryItem {
            id
            measurement {
              weight {
                value
                unit
              }
            }
          }
        }
      }
    }
  }
}`
