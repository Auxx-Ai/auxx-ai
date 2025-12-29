// apps/web/src/app/(protected)/app/workflows/_components/credentials/credential-registry.ts

import {
  AirtableApi,
  AirtableOAuth2Api,
  HttpBasicAuth,
  HttpHeaderAuth,
  OAuth2Api,
  GoogleOAuth2Api,
  OutlookOAuth2Api,
  FacebookOAuth2Api,
  InstagramOAuth2Api,
  ShopifyOAuth2Api,
  DropboxOAuth2,
  Postgres,
  CrateDb,
  Imap,
  SmtpCredentials,
  PostgresWithTesting,
} from '@auxx/workflow-nodes/credentials'
import { type ICredentialType } from '@auxx/workflow-nodes/types'
import { PROVIDER_ICONS } from '~/constants/icons'
import { Shield, Hash, Key, Table, Database, Inbox } from 'lucide-react'
import type { SVGProps } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Credential type metadata for UI display
 */
export interface CredentialTypeMetadata {
  id: string
  displayName: string
  description: string
  category: 'database' | 'data' | 'email' | 'auth' | 'social' | 'ecommerce' | 'storage'
  icon: React.ComponentType<SVGProps<SVGSVGElement>> | LucideIcon
  credentialType: ICredentialType
  // Node compatibility - specify which node types can use this credential
  compatibleNodeTypes?: string[]
}

/**
 * Registry of all available credential types
 */
export const CREDENTIAL_REGISTRY: CredentialTypeMetadata[] = [
  // Authentication Credentials
  {
    id: 'googleOAuth2Api',
    displayName: 'Google OAuth2',
    description:
      'Connect to Google services (Gmail, Drive, Sheets, Calendar) with one-click authentication',
    category: 'auth',
    icon: PROVIDER_ICONS.google,
    credentialType: new GoogleOAuth2Api(),
    compatibleNodeTypes: ['http', 'email', 'professional-network'],
  },
  {
    id: 'app-connection',
    displayName: 'App Connection',
    description: 'App connection',
    category: 'auth',
    icon: PROVIDER_ICONS.google,
    credentialType: new GoogleOAuth2Api(),
    compatibleNodeTypes: ['http', 'email', 'professional-network'],
  },

  {
    id: 'outlookOAuth2Api',
    displayName: 'Microsoft Outlook OAuth2',
    description: 'Connect to Microsoft Outlook and Exchange services with OAuth2 authentication',
    category: 'auth',
    icon: PROVIDER_ICONS.outlook,
    credentialType: new OutlookOAuth2Api(),
    compatibleNodeTypes: ['http', 'email'],
  },
  {
    id: 'httpBasicAuth',
    displayName: 'HTTP Basic Auth',
    description: 'Basic username and password authentication for HTTP requests',
    category: 'auth',
    icon: Shield,
    credentialType: new HttpBasicAuth(),
    compatibleNodeTypes: ['http', 'crud'],
  },
  {
    id: 'httpHeaderAuth',
    displayName: 'HTTP Header Auth',
    description: 'Custom header-based authentication for API requests',
    category: 'auth',
    icon: Hash,
    credentialType: new HttpHeaderAuth(),
    compatibleNodeTypes: ['http', 'crud'],
  },
  {
    id: 'oAuth2Api',
    displayName: 'OAuth2 API',
    description: 'Generic OAuth2 authentication for API access with various grant types',
    category: 'auth',
    icon: Key,
    credentialType: new OAuth2Api(),
    compatibleNodeTypes: ['http', 'crud'],
  },

  // Email Services
  {
    id: 'smtp',
    displayName: 'SMTP Email Account',
    description: 'Connect to SMTP servers for sending emails',
    category: 'email',
    icon: PROVIDER_ICONS.gmail,
    credentialType: new SmtpCredentials(),
    compatibleNodeTypes: ['email', 'http'],
  },
  {
    id: 'imap',
    displayName: 'IMAP',
    description: 'Connect to IMAP servers for reading emails',
    category: 'email',
    icon: Inbox,
    credentialType: new Imap(),
    compatibleNodeTypes: ['email', 'message-received-trigger'],
  },

  // Social Media
  {
    id: 'facebookOAuth2Api',
    displayName: 'Facebook OAuth2',
    description: 'Connect to Facebook Graph API for pages and messaging',
    category: 'social',
    icon: PROVIDER_ICONS.facebook,
    credentialType: new FacebookOAuth2Api(),
  },
  {
    id: 'instagramOAuth2Api',
    displayName: 'Instagram OAuth2',
    description: 'Connect to Instagram Basic Display API',
    category: 'social',
    icon: PROVIDER_ICONS.instagram,
    credentialType: new InstagramOAuth2Api(),
  },

  // E-commerce
  {
    id: 'shopifyOAuth2Api',
    displayName: 'Shopify OAuth2',
    description: 'Connect to Shopify Admin API for store management',
    category: 'ecommerce',
    icon: PROVIDER_ICONS.shopify,
    credentialType: new ShopifyOAuth2Api(),
  },

  // Storage Services
  {
    id: 'DROPBOX',
    displayName: 'Dropbox OAuth2',
    description: 'Connect to Dropbox API for file storage and sharing',
    category: 'storage',
    icon: PROVIDER_ICONS.dropbox,
    credentialType: new DropboxOAuth2(),
    compatibleNodeTypes: ['http', 'file-storage'],
  },

  // Data Services
  {
    id: 'airtableApi',
    displayName: 'Airtable API',
    description: 'Connect to Airtable databases using API key authentication',
    category: 'data',
    icon: Table,
    credentialType: new AirtableApi(),
  },
  {
    id: 'airtableOAuth2Api',
    displayName: 'Airtable OAuth2',
    description: 'Connect to Airtable databases using OAuth2 authentication',
    category: 'data',
    icon: Table,
    credentialType: new AirtableOAuth2Api(),
  },

  // Databases
  {
    id: 'postgres',
    displayName: 'PostgreSQL',
    description: 'Connect to PostgreSQL databases with connection credentials',
    category: 'database',
    icon: PROVIDER_ICONS.postgres,
    credentialType: new Postgres(),
  },
  {
    id: 'postgresWithTesting',
    displayName: 'PostgreSQL (with testing)',
    description: 'Connect to PostgreSQL databases with testing support',
    category: 'database',
    icon: PROVIDER_ICONS.postgres,
    credentialType: new PostgresWithTesting(),
  },
  {
    id: 'crateDb',
    displayName: 'CrateDB',
    description: 'Connect to CrateDB distributed SQL database',
    category: 'database',
    icon: Database,
    credentialType: new CrateDb(),
  },
]

/**
 * Get credential type metadata by ID
 */
export function getCredentialType(id: string): CredentialTypeMetadata | undefined {
  return CREDENTIAL_REGISTRY.find((cred) => cred.id === id)
}

/**
 * Get all credential types by category
 */
export function getCredentialsByCategory(
  category: CredentialTypeMetadata['category']
): CredentialTypeMetadata[] {
  return CREDENTIAL_REGISTRY.filter((cred) => cred.category === category)
}

/**
 * Search credential types by name or description
 */
export function searchCredentialTypes(query: string): CredentialTypeMetadata[] {
  const lowercaseQuery = query.toLowerCase()
  return CREDENTIAL_REGISTRY.filter(
    (cred) =>
      cred.displayName.toLowerCase().includes(lowercaseQuery) ||
      cred.description.toLowerCase().includes(lowercaseQuery)
  )
}

/**
 * Get credential types compatible with a specific node type
 */
export function getCompatibleCredentialTypes(nodeType: string): CredentialTypeMetadata[] {
  return CREDENTIAL_REGISTRY.filter(
    (cred) =>
      !cred.compatibleNodeTypes || // If no compatibility specified, assume compatible with all
      cred.compatibleNodeTypes.includes(nodeType)
  )
}

/**
 * Filter credential types by multiple node type compatibility
 */
export function getCredentialTypesForNodes(nodeTypes: string[]): CredentialTypeMetadata[] {
  return CREDENTIAL_REGISTRY.filter(
    (cred) =>
      !cred.compatibleNodeTypes || // If no compatibility specified, assume compatible with all
      nodeTypes.some((nodeType) => cred.compatibleNodeTypes!.includes(nodeType))
  )
}

/**
 * Check if a credential type is compatible with a node type
 */
export function isCredentialCompatibleWithNode(
  credentialTypeId: string,
  nodeType: string
): boolean {
  const credentialType = getCredentialType(credentialTypeId)
  if (!credentialType) return false

  // If no compatibility specified, assume compatible with all
  if (!credentialType.compatibleNodeTypes) return true

  return credentialType.compatibleNodeTypes.includes(nodeType)
}

/**
 * Category labels for UI display
 */
export const CREDENTIAL_CATEGORIES = {
  database: 'Databases',
  data: 'Data Services',
  email: 'Email Services',
  auth: 'Authentication',
  social: 'Social Media',
  ecommerce: 'E-commerce',
  storage: 'Storage Services',
} as const
