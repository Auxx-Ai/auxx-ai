// packages/lib/src/ai/mcp/templates/catalog.ts
//
// Ship-with-the-code MCP server templates surfaced in the "Connect from template" dialog
// (Settings → Apps). Pure data — no DB, no tRPC. The catalog is served to the client via
// `mcp.listTemplates` (it never ships in the client bundle) and is the source of truth for
// curated/global McpServer rows: `ensureCuratedMcpServer` upserts a row at connect time, and
// `@auxx/seed`'s McpDomain loops the same catalog for fresh installs.

import type { ConnectionVariable, McpServerIcon } from '@auxx/database'

export type McpTemplateCategory =
  | 'dev-tools'
  | 'project-management'
  | 'commerce'
  | 'data-search'
  | 'productivity'

export interface McpTemplateCategoryDef {
  value: McpTemplateCategory | 'all'
  label: string
  /** ICON_DATA iconId, rendered via EntityIcon in the gallery sidebar. */
  icon: string
}

export interface McpTemplate {
  /** Stable kebab-case slug — becomes the global McpServer.slug (tool namespace mcp__<slug>__). */
  id: string
  name: string
  description: string
  /** `iconId` is a `brand:<slug>` visual ref (apps/web/public/icons/brands) rendered by AppIcon. */
  icon?: McpServerIcon
  categories: McpTemplateCategory[]
  /** Streamable HTTP endpoint; may contain `{connectionVariable}` placeholders. */
  endpoint: string
  /** oauth2-code → OAuth 2.1 (client creds minted lazily via DCR on first connect). */
  connectionType: 'oauth2-code' | 'secret' | 'none'
  /** Variables the org must supply at connect time (interpolated into the endpoint). */
  connectionVariables?: ConnectionVariable[]
  /** Provider docs for the connect step (e.g. where to find the API key). */
  docsUrl?: string
  /**
   * How the OAuth client is obtained (absent = `'dcr'`). `'manual'` = the provider has no
   * Dynamic Client Registration; the template routes through the custom-server flow and the
   * user registers an OAuth app themselves.
   */
  clientRegistration?: 'dcr' | 'manual'
  /** Shown in the manual setup step (e.g. "GitHub does not support automatic registration…"). */
  setupHint?: string
  /** Deep link to the provider's "create OAuth app" form. */
  createOAuthAppUrl?: string
  /** Provider requires a client secret on token exchange (no public-client PKCE). */
  clientSecretRequired?: boolean
}

export const mcpTemplateCategories: McpTemplateCategoryDef[] = [
  { value: 'all', label: 'All templates', icon: 'layout-grid' },
  { value: 'dev-tools', label: 'Developer tools', icon: 'code' },
  { value: 'project-management', label: 'Project management', icon: 'list-todo' },
  { value: 'commerce', label: 'Commerce', icon: 'shopping-cart' },
  { value: 'data-search', label: 'Data & search', icon: 'search' },
  { value: 'productivity', label: 'Productivity', icon: 'zap' },
]

/**
 * Endpoints + auth posture verified against live provider docs (2026-06). All endpoints are
 * Streamable HTTP. The `linear`/`notion`/`shopify` slugs predate this catalog (originally seeded
 * by @auxx/seed) — keep them stable so the upsert matches existing rows in place.
 */
export const mcpTemplates: McpTemplate[] = [
  {
    id: 'linear',
    name: 'Linear',
    description: 'Find, create, and update Linear issues, projects, and comments.',
    icon: { iconId: 'brand:linear' },
    categories: ['project-management'],
    endpoint: 'https://mcp.linear.app/mcp',
    connectionType: 'oauth2-code',
    docsUrl: 'https://linear.app/docs/mcp',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search, read, and update pages and databases in your Notion workspace.',
    icon: { iconId: 'brand:notion' },
    categories: ['productivity', 'project-management'],
    endpoint: 'https://mcp.notion.com/mcp',
    connectionType: 'oauth2-code',
    docsUrl: 'https://developers.notion.com/docs/mcp',
  },
  {
    id: 'shopify',
    name: 'Shopify Storefront',
    description: 'Search products, manage carts, and read store policies on a Shopify storefront.',
    icon: { iconId: 'brand:shopify' },
    categories: ['commerce'],
    endpoint: 'https://{shop}.myshopify.com/api/mcp',
    connectionType: 'none',
    connectionVariables: [
      {
        key: 'shop',
        label: 'Shop subdomain',
        description: 'Only the subdomain, e.g. my-store from my-store.myshopify.com',
        placeholder: 'my-store',
        required: true,
      },
    ],
    docsUrl: 'https://shopify.dev/docs/apps/build/storefront-mcp',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Read repositories, issues, and pull requests; create and update issues.',
    icon: { iconId: 'brand:github' },
    categories: ['dev-tools'],
    endpoint: 'https://api.githubcopilot.com/mcp/',
    connectionType: 'oauth2-code',
    // github.com/login/oauth publishes no registration_endpoint — DCR can never work.
    clientRegistration: 'manual',
    clientSecretRequired: true,
    setupHint:
      'GitHub does not support automatic client registration. Create an OAuth app on GitHub and paste its Client ID and Client Secret.',
    createOAuthAppUrl: 'https://github.com/settings/applications/new',
    docsUrl: 'https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Query Sentry issues, events, and projects to debug production errors.',
    icon: { iconId: 'brand:sentry' },
    categories: ['dev-tools'],
    endpoint: 'https://mcp.sentry.dev/mcp',
    connectionType: 'oauth2-code',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Look up customers, payments, subscriptions, and invoices in Stripe.',
    icon: { iconId: 'brand:stripe' },
    categories: ['commerce'],
    endpoint: 'https://mcp.stripe.com',
    connectionType: 'oauth2-code',
    docsUrl: 'https://docs.stripe.com/mcp',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    description: 'Manage PayPal invoices, orders, and transactions.',
    icon: { iconId: 'brand:paypal' },
    categories: ['commerce'],
    endpoint: 'https://mcp.paypal.com/mcp',
    connectionType: 'oauth2-code',
    docsUrl: 'https://developer.paypal.com/tools/mcp-server/',
  },
  {
    id: 'context7',
    name: 'Context7',
    description: 'Fetch up-to-date documentation and code examples for any library.',
    icon: { iconId: 'brand:context7' },
    categories: ['dev-tools', 'data-search'],
    endpoint: 'https://mcp.context7.com/mcp',
    connectionType: 'none',
    docsUrl: 'https://context7.com',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    description: 'Search models, datasets, papers, and Spaces on the Hugging Face Hub.',
    icon: { iconId: 'brand:huggingface' },
    categories: ['data-search'],
    endpoint: 'https://huggingface.co/mcp',
    connectionType: 'secret',
    docsUrl: 'https://huggingface.co/settings/mcp',
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Trigger Zapier actions across thousands of connected apps.',
    icon: { iconId: 'brand:zapier' },
    categories: ['productivity'],
    endpoint: 'https://mcp.zapier.com/api/mcp/mcp',
    connectionType: 'secret',
    docsUrl: 'https://zapier.com/mcp',
  },
  {
    id: 'deepwiki',
    name: 'DeepWiki',
    description: 'Ask questions about any public GitHub repository, answered from its docs.',
    icon: { iconId: 'brand:deepwiki' },
    categories: ['dev-tools', 'data-search'],
    endpoint: 'https://mcp.deepwiki.com/mcp',
    connectionType: 'none',
    docsUrl: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
  },
  {
    id: 'exa',
    name: 'Exa Search',
    description: 'Web search and content crawling built for AI agents.',
    icon: { iconId: 'brand:exa' },
    categories: ['data-search'],
    endpoint: 'https://mcp.exa.ai/mcp',
    connectionType: 'secret',
    docsUrl: 'https://docs.exa.ai/reference/exa-mcp',
  },
]
