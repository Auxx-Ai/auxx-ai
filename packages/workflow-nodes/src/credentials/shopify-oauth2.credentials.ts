// packages/workflow-nodes/src/credentials/shopify-oauth2.credentials.ts

import { URLTransformUtils } from '../services/url-template.service'
import type { ICredentialType, INodeProperty } from '../types'
import type { OAuth2Config } from '../types/oauth2'

/**
 * Shopify OAuth2 credential type for workflow integrations
 * Uses system-wide Shopify OAuth client credentials with Shopify Admin API scopes
 */
export class ShopifyOAuth2Api implements ICredentialType {
  name = 'shopifyOAuth2Api'

  displayName = 'Shopify OAuth2'

  documentationUrl = 'shopify-oauth2'

  /**
   * UI metadata for styling this credential type
   */
  uiMetadata = {
    icon: 'ShoppingBag',
    iconColor: 'text-green-600',
    backgroundColor: 'from-green-50 to-emerald-50',
    borderColor: 'border-green-200',
    category: 'ecommerce' as const,
    brandColor: '#5d8a66', // Shopify green
  }

  /**
   * OAuth2 provider configuration - defines everything needed for generic OAuth flow
   */
  oauth2Config: OAuth2Config = {
    providerName: 'shopify',
    icon: 'ShoppingBag', // Lucide icon name for UI
    authUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
    systemClientIdEnv: 'SHOPIFY_CLIENT_ID',
    systemClientSecretEnv: 'SHOPIFY_CLIENT_SECRET',

    // Shopify Admin API scopes
    scopes: [
      'read_orders', // Read order data
      'write_orders', // Modify order data
      'read_customers', // Read customer data
      'write_customers', // Modify customer data
      'read_products', // Read product data
      'write_products', // Modify product data
      'read_inventory', // Read inventory data
      'write_inventory', // Modify inventory data
    ],

    // Shopify-specific OAuth parameters
    additionalAuthParams: {
      response_type: 'code',
      state: 'nonce', // Shopify requires a state parameter
    },

    // Provider-specific styling (overrides uiMetadata for OAuth2 specifics)
    providerStyling: {
      iconColor: 'text-green-600',
      backgroundColor: 'from-green-50 to-emerald-50',
      borderColor: 'border-green-200',
      brandColor: '#5d8a66',
    },

    // URL transformations for dynamic shop-specific URLs
    urlTransforms: {
      authUrl: [
        {
          type: 'extract',
          source: 'shopDomain',
          target: '{shop}',
          transform: URLTransformUtils.extractShopifyShopName,
          description: 'Extract shop name from full Shopify domain',
        },
      ],
      tokenUrl: [
        {
          type: 'extract',
          source: 'shopDomain',
          target: '{shop}',
          transform: URLTransformUtils.extractShopifyShopName,
          description: 'Extract shop name from full Shopify domain',
        },
      ],
    },
  }

  /**
   * Shopify requires additional shop domain configuration
   */
  properties: INodeProperty[] = [
    {
      displayName: 'Shop Domain',
      name: 'shopDomain',
      type: 'string',
      default: '',
      required: true,
      placeholder: 'your-shop.myshopify.com',
      description: 'Your Shopify shop domain (e.g., your-shop.myshopify.com)',
      validation: {
        pattern: /^[a-zA-Z0-9-]+\.myshopify\.com$/,
        minLength: 10,
        maxLength: 100,
        errorMessage: 'Shop domain must be in format: your-shop.myshopify.com',
      },
    },
  ]

  /**
   * Optional: Custom authentication method for workflow execution
   * This could be used to refresh tokens or validate credentials
   */
  authenticate?(credentials: Record<string, any>): Record<string, any> {
    // The OAuth2WorkflowService will handle token refresh automatically
    // This method could add computed fields if needed
    return credentials
  }
}
