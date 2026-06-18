// packages/sdk/__fixtures__/connector-app/src/shopify-core.connector.server.ts
//
// Server handler (`shopifyCoreSync`) for the Shopify Core data connector. Runs
// inside the app-runtime sandbox: fetches orders from the Shopify Admin GraphQL
// API using the bound connection, pages incrementally (cursor on updated_at),
// and yields SOURCE-shaped `ConnectorRecord` batches (streamKey 'order',
// externalId = order id, fields keyed by source path).
//
// The handler NEVER sees target defs/mappings and NEVER writes entities — the
// platform validates these records against the stream's source schema, then
// maps + sinks them.
//
// The catalog extractor stubs `.server.ts` imports at extraction time, so this
// body is never invoked during catalog projection.

import type {
  ConnectorExecuteArgs,
  ConnectorFetchResult,
  ConnectorRecord,
} from '@auxx/sdk/data-connectors'

interface ShopifyCoreConfig {
  includeDraftProducts?: boolean
}

/** Shopify Admin GraphQL API version. */
const ADMIN_API_VERSION = '2024-10'
/** Orders fetched per page (Shopify max is 250 for the orders connection). */
const PAGE_SIZE = 50

/** One order edge from the Admin API `orders` connection. */
interface ShopifyOrderNode {
  id: string
  name: string
  updatedAt: string
  displayFinancialStatus: string | null
  totalPriceSet: { shopMoney: { amount: string } } | null
  customer: { email: string | null; firstName: string | null } | null
  lineItems: {
    edges: Array<{ node: { sku: string | null; product: { id: string } | null } }>
  }
}

const ORDERS_QUERY = /* GraphQL */ `
  query SyncOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      edges {
        cursor
        node {
          id
          name
          updatedAt
          displayFinancialStatus
          totalPriceSet { shopMoney { amount } }
          customer { email firstName }
          lineItems(first: 100) {
            edges { node { sku product { id } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`

/**
 * Project one Shopify order node into a SOURCE-shaped `ConnectorRecord`. The
 * `fields` keys are the stream's source paths (matching the `order` stream's
 * field `sourcePath` declarations) — NOT target field keys.
 */
function toConnectorRecord(node: ShopifyOrderNode): ConnectorRecord {
  return {
    streamKey: 'order',
    externalId: node.id,
    displayName: node.name,
    fields: {
      id: node.id,
      name: node.name,
      total_price: node.totalPriceSet?.shopMoney.amount ?? null,
      financial_status: node.displayFinancialStatus,
      'customer.email': node.customer?.email ?? null,
      'customer.first_name': node.customer?.firstName ?? null,
      // Array branch (`line_items[]`) is emitted as the raw array — the mapping
      // layer fans each element out per the `line_items[]` mapping.
      line_items: node.lineItems.edges.map((e) => ({
        sku: e.node.sku,
        product_id: e.node.product?.id ?? null,
      })),
    },
  }
}

/**
 * Fetch one page of orders. Incremental mode filters on `updated_at` from the
 * persisted cursor; snapshot mode paginates from the beginning. Returns one
 * page's records + the next cursor so the platform re-invokes to page further.
 */
export default async function shopifyCoreSync(
  args: ConnectorExecuteArgs<ShopifyCoreConfig>
): Promise<ConnectorFetchResult> {
  const { streamKey, mode, state, connection } = args

  if (streamKey !== 'order') {
    throw new Error(`shopify.core: unknown stream "${streamKey}"`)
  }
  if (!connection) {
    throw new Error('shopify.core: missing connection (requiresConnection)')
  }

  // The bound connection: `value` is the Admin API access token; `metadata`
  // carries the shop domain (set during the app's OAuth flow).
  const accessToken = connection.value
  const shopDomain = String(connection.metadata?.shopDomain ?? connection.metadata?.shop ?? '')
  if (!shopDomain) {
    throw new Error('shopify.core: connection metadata is missing the shop domain')
  }

  // Incremental: only orders updated since the last cursor. Snapshot: all.
  const updatedSince = mode === 'incremental' ? state.updatedSince : undefined
  const queryFilter = updatedSince ? `updated_at:>='${updatedSince}'` : undefined

  const endpoint = `https://${shopDomain}/admin/api/${ADMIN_API_VERSION}/graphql.json`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': accessToken,
    },
    body: JSON.stringify({
      query: ORDERS_QUERY,
      variables: { first: PAGE_SIZE, after: state.cursor ?? null, query: queryFilter },
    }),
  })

  if (!response.ok) {
    throw new Error(`shopify.core: Admin API responded ${response.status}`)
  }

  const json = (await response.json()) as {
    data?: {
      orders?: {
        edges: Array<{ cursor: string; node: ShopifyOrderNode }>
        pageInfo: { hasNextPage: boolean; endCursor: string | null }
      }
    }
    errors?: Array<{ message: string }>
  }

  if (json.errors?.length) {
    throw new Error(
      `shopify.core: Admin API errors — ${json.errors.map((e) => e.message).join('; ')}`
    )
  }

  const ordersConn = json.data?.orders
  const edges = ordersConn?.edges ?? []
  const records = edges.map((edge) => toConnectorRecord(edge.node))

  // Track the high-water mark of `updatedAt` so the next incremental run resumes
  // from the latest record we've seen.
  const lastUpdatedAt = edges.length ? edges[edges.length - 1]!.node.updatedAt : updatedSince

  const hasNextPage = ordersConn?.pageInfo.hasNextPage ?? false
  const endCursor = ordersConn?.pageInfo.endCursor ?? undefined

  return {
    records,
    nextState: {
      // While paging within this run, keep the page cursor. When the page chain
      // ends, drop the cursor and advance `updatedSince` so the next run pulls
      // the delta from the latest record.
      cursor: hasNextPage ? endCursor : undefined,
      updatedSince: hasNextPage ? state.updatedSince : lastUpdatedAt,
      backfillComplete: !hasNextPage,
    },
  }
}
