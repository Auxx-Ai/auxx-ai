// packages/lib/src/connections/providers/defs.ts
// Platform built-in connection providers, ported verbatim from the old
// workflow-node CREDENTIAL_REGISTRY (packages/workflow-nodes/src/credentials).
// One entry per registered ICredentialType. `ensure-platform-providers` upserts
// each into a ConnectionDefinition row keyed by providerKey.

import { FieldType } from '@auxx/database/enums'
import { BEARER_AUTH as BEARER } from '../auth-apply'
import type { PlatformProviderDef } from './types'

/** Per-credential OAuth client variables for bring-your-own-client providers (§9.1). */
const BYO_CLIENT_VARS = [
  { key: 'clientId', label: 'Client ID', required: true },
  {
    key: 'clientSecret',
    label: 'Client Secret',
    secret: true,
    required: true,
  },
]

export const PLATFORM_PROVIDER_DEFS: PlatformProviderDef[] = [
  // ────────────────────────────────────────────────────────────────────────
  // First-party OAuth2 account providers (per-user, platform client creds)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'googleOAuth2Api',
    connectionType: 'oauth2-code',
    label: 'Google OAuth2',
    global: false,
    oauth2AuthorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauth2AccessTokenUrl: 'https://oauth2.googleapis.com/token',
    oauth2Scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      // drive.file (per-file, non-sensitive) instead of full `drive`. Listing the
      // user's spreadsheets needs drive.metadata.readonly — a Google "restricted"
      // scope, accepted deliberately: gmail.modify already puts us through the
      // CASA audit, and metadata-only is the narrowest scope files.list accepts.
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/drive.metadata.readonly',
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    systemClientIdEnv: 'GOOGLE_CLIENT_ID',
    systemClientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    oauth2Features: {
      additionalAuthorizeParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
    },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:google', category: 'auth', brandColor: '#db4437' },
  },
  {
    providerKey: 'outlookOAuth2Api',
    connectionType: 'oauth2-code',
    label: 'Microsoft Outlook OAuth2',
    global: false,
    oauth2AuthorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    oauth2AccessTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    oauth2Scopes: [
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ],
    systemClientIdEnv: 'OUTLOOK_CLIENT_ID',
    systemClientSecretEnv: 'OUTLOOK_CLIENT_SECRET',
    oauth2Features: {
      additionalAuthorizeParams: {
        response_type: 'code',
        response_mode: 'query',
        prompt: 'consent',
      },
    },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:outlook', category: 'email', brandColor: '#0078d4' },
  },
  // ────────────────────────────────────────────────────────────────────────
  // Mail-centric channel providers (org-shared). Distinct from the kitchen-sink
  // googleOAuth2Api/outlookOAuth2Api. Channels fold onto these. Gmail scopes are
  // the minimal set for Google OAuth verification: gmail.modify already includes
  // read/send/labels, and `users.watch` needs no pubsub scope (the platform topic
  // grants publish to gmail-api-push). Existing broader grants stay valid.
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'gmail',
    connectionType: 'oauth2-code',
    label: 'Gmail',
    global: true,
    oauth2AuthorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauth2AccessTokenUrl: 'https://oauth2.googleapis.com/token',
    oauth2Scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    systemClientIdEnv: 'GOOGLE_CLIENT_ID',
    systemClientSecretEnv: 'GOOGLE_CLIENT_SECRET',
    systemClientApprovedEnv: 'GOOGLE_PLATFORM_CREDENTIALS_APPROVED',
    oauth2Features: {
      additionalAuthorizeParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
    },
    // BYO client fields (optional) — required at connect time when the approval
    // gate forces own-client (resolveOwnClientRequirement).
    connectionVariables: BYO_CLIENT_VARS.map((v) => ({ ...v, required: false })),
    authApply: BEARER,
    uiMetadata: { icon: 'brand:gmail', category: 'email', brandColor: '#ea4335' },
  },
  {
    providerKey: 'outlookMail',
    connectionType: 'oauth2-code',
    label: 'Outlook',
    global: true,
    oauth2AuthorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    oauth2AccessTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    oauth2Scopes: [
      'https://graph.microsoft.com/Mail.ReadWrite',
      'https://graph.microsoft.com/Mail.Send',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ],
    systemClientIdEnv: 'OUTLOOK_CLIENT_ID',
    systemClientSecretEnv: 'OUTLOOK_CLIENT_SECRET',
    systemClientApprovedEnv: 'OUTLOOK_PLATFORM_CREDENTIALS_APPROVED',
    oauth2Features: {
      additionalAuthorizeParams: {
        response_type: 'code',
        response_mode: 'query',
        prompt: 'consent',
      },
    },
    connectionVariables: BYO_CLIENT_VARS.map((v) => ({ ...v, required: false })),
    authApply: BEARER,
    uiMetadata: { icon: 'brand:outlook', category: 'email', brandColor: '#0078d4' },
  },
  // ── Social messaging channel defs (Facebook + Instagram) ────────────────────
  // These are the CHANNEL defs (providerKey == Integration.provider class), and as of
  // 2026-08-17 the ONLY Facebook/Instagram defs — the workflow `facebookOAuth2Api` /
  // `instagramOAuth2Api` connectors that used to sit below were deleted: they keyed on
  // `FACEBOOK_CLIENT_ID`/`INSTAGRAM_CLIENT_ID` env vars that exist nowhere, and the
  // Instagram one pointed at the Basic Display API Meta retired in Dec 2024. Both
  // use the platform Facebook app (IG Messaging is a Facebook-Graph child — no separate
  // Instagram app) and authorize through the Facebook login dialog. The OAuth code
  // exchange yields a USER token; the social post-connect hook derives the long-lived
  // PAGE token + (IG) the linked Instagram Business Account and swaps it onto the
  // credential. Long-lived page tokens have no refresh grant → dead token surfaces as
  // requiresReauth (no scanner refresh).
  {
    providerKey: 'facebook',
    connectionType: 'oauth2-code',
    label: 'Facebook',
    global: false,
    oauth2AuthorizeUrl: 'https://www.facebook.com/v26.0/dialog/oauth',
    oauth2AccessTokenUrl: 'https://graph.facebook.com/v26.0/oauth/access_token',
    // pages_show_list + business_management are declared dependencies of the
    // messaging permissions; without business_management, pages owned by a
    // Business portfolio are missing from /me/accounts at connect time.
    oauth2Scopes: [
      'pages_messaging',
      'pages_manage_metadata',
      'pages_read_engagement',
      'pages_show_list',
      'business_management',
    ],
    systemClientIdEnv: 'FACEBOOK_APP_ID',
    systemClientSecretEnv: 'FACEBOOK_APP_SECRET',
    oauth2Features: { additionalAuthorizeParams: { response_type: 'code' } },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:facebook', category: 'social', brandColor: '#1877f2' },
  },
  {
    providerKey: 'instagram',
    connectionType: 'oauth2-code',
    label: 'Instagram',
    global: false,
    // Instagram Messaging authorizes through the Facebook login dialog + Facebook app.
    oauth2AuthorizeUrl: 'https://www.facebook.com/v26.0/dialog/oauth',
    oauth2AccessTokenUrl: 'https://graph.facebook.com/v26.0/oauth/access_token',
    oauth2Scopes: [
      'instagram_basic',
      'instagram_manage_messages',
      'pages_messaging',
      'pages_manage_metadata',
      'pages_read_engagement',
      'pages_show_list',
      'business_management',
    ],
    systemClientIdEnv: 'FACEBOOK_APP_ID',
    systemClientSecretEnv: 'FACEBOOK_APP_SECRET',
    oauth2Features: { additionalAuthorizeParams: { response_type: 'code' } },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:instagram', category: 'social', brandColor: '#e4405f' },
  },
  {
    providerKey: 'shopifyOAuth2Api',
    connectionType: 'oauth2-code',
    label: 'Shopify OAuth2',
    global: false,
    // The {shop} placeholder is interpolated from the `shop` connection variable.
    oauth2AuthorizeUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
    oauth2AccessTokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
    oauth2Scopes: [
      'read_orders',
      'write_orders',
      'read_customers',
      'write_customers',
      'read_products',
      'write_products',
      'read_inventory',
      'write_inventory',
    ],
    systemClientIdEnv: 'SHOPIFY_CLIENT_ID',
    systemClientSecretEnv: 'SHOPIFY_CLIENT_SECRET',
    oauth2Features: { additionalAuthorizeParams: { response_type: 'code' } },
    connectionVariables: [
      {
        key: 'shop',
        label: 'Shop Subdomain',
        description: 'Only the subdomain, e.g. my-store from my-store.myshopify.com',
        placeholder: 'my-store',
        required: true,
      },
    ],
    authApply: BEARER,
    baseUrlTemplate: 'https://{shop}.myshopify.com/admin/api/2024-10',
    uiMetadata: { icon: 'brand:shopify', category: 'ecommerce', brandColor: '#5d8a66' },
  },
  // ────────────────────────────────────────────────────────────────────────
  // Storage OAuth2 providers (per-user, platform client creds)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'GOOGLE_DRIVE',
    connectionType: 'oauth2-code',
    label: 'Google Drive Storage',
    global: false,
    oauth2AuthorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    oauth2AccessTokenUrl: 'https://oauth2.googleapis.com/token',
    oauth2Scopes: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    systemClientIdEnv: 'GOOGLE_DRIVE_CLIENT_ID',
    systemClientSecretEnv: 'GOOGLE_DRIVE_CLIENT_SECRET',
    oauth2Features: {
      additionalAuthorizeParams: {
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
      },
    },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:google-drive', category: 'storage', brandColor: '#4285f4' },
  },
  {
    providerKey: 'DROPBOX',
    connectionType: 'oauth2-code',
    label: 'Dropbox OAuth2',
    global: false,
    oauth2AuthorizeUrl: 'https://www.dropbox.com/oauth2/authorize',
    oauth2AccessTokenUrl: 'https://api.dropboxapi.com/oauth2/token',
    oauth2Scopes: ['account_info.read', 'files.metadata.read', 'files.content.read'],
    systemClientIdEnv: 'DROPBOX_CLIENT_ID',
    systemClientSecretEnv: 'DROPBOX_CLIENT_SECRET',
    oauth2Features: {
      additionalAuthorizeParams: { token_access_type: 'offline', force_reapprove: 'false' },
    },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:dropbox', category: 'storage', brandColor: '#0061FF' },
  },
  {
    providerKey: 'ONEDRIVE',
    connectionType: 'oauth2-code',
    label: 'OneDrive OAuth2',
    global: false,
    oauth2AuthorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    oauth2AccessTokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    oauth2Scopes: [
      'https://graph.microsoft.com/Files.ReadWrite.All',
      'https://graph.microsoft.com/User.Read',
      'offline_access',
    ],
    systemClientIdEnv: 'ONEDRIVE_CLIENT_ID',
    systemClientSecretEnv: 'ONEDRIVE_CLIENT_SECRET',
    oauth2Features: { additionalAuthorizeParams: { response_mode: 'query' } },
    authApply: BEARER,
    uiMetadata: { icon: 'brand:onedrive', category: 'storage', brandColor: '#0078d4' },
  },
  {
    providerKey: 'BOX',
    connectionType: 'oauth2-code',
    label: 'Box OAuth2',
    global: false,
    oauth2AuthorizeUrl: 'https://account.box.com/api/oauth2/authorize',
    oauth2AccessTokenUrl: 'https://api.box.com/oauth2/token',
    oauth2Scopes: [],
    systemClientIdEnv: 'BOX_CLIENT_ID',
    systemClientSecretEnv: 'BOX_CLIENT_SECRET',
    authApply: BEARER,
    uiMetadata: { icon: 'brand:box', category: 'storage', brandColor: '#0061D5' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Bring-your-own-client OAuth2 (per-credential client id/secret, §9.1)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'oAuth2Api',
    connectionType: 'oauth2-code',
    label: 'OAuth2 API',
    global: true,
    // URLs/scopes are blank — supplied per-credential via connection variables.
    // The resolver falls back to credential-stored config when these are blank.
    connectionVariables: [
      {
        key: 'authUrl',
        label: 'Authorization URL',
        placeholder: 'https://example.com/oauth/authorize',
        required: true,
      },
      {
        key: 'accessTokenUrl',
        label: 'Access Token URL',
        placeholder: 'https://example.com/oauth/token',
        required: true,
      },
      ...BYO_CLIENT_VARS,
      { key: 'scope', label: 'Scope', required: false },
    ],
    authApply: BEARER,
    uiMetadata: { icon: 'shield', category: 'auth', brandColor: '#3b82f6' },
  },
  {
    providerKey: 'airtableOAuth2Api',
    connectionType: 'oauth2-code',
    label: 'Airtable OAuth2 API',
    global: true,
    oauth2AuthorizeUrl: 'https://airtable.com/oauth2/v1/authorize',
    oauth2AccessTokenUrl: 'https://airtable.com/oauth2/v1/token',
    oauth2Scopes: ['schema.bases:read', 'data.records:read', 'data.records:write'],
    oauth2TokenRequestAuthMethod: 'basic-auth',
    oauth2Features: { pkce: true },
    // Airtable is BYO-client (inherited clientId/clientSecret from the old oAuth2Api extends).
    connectionVariables: BYO_CLIENT_VARS,
    authApply: BEARER,
    baseUrlTemplate: 'https://api.airtable.com/v0',
    uiMetadata: { icon: 'brand:airtable', category: 'data', brandColor: '#fcb401' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // HTTP auth (secret)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'httpBasicAuth',
    connectionType: 'secret',
    label: 'Basic Auth',
    global: true,
    connectionVariables: [
      { key: 'user', label: 'User' },
      { key: 'password', label: 'Password', secret: true },
    ],
    authApply: { in: 'basic' },
    uiMetadata: { icon: 'key', category: 'auth', brandColor: '#6b7280' },
  },
  {
    providerKey: 'httpHeaderAuth',
    connectionType: 'secret',
    label: 'Header Auth',
    global: true,
    connectionVariables: [
      { key: 'name', label: 'Name', placeholder: 'X-API-Key' },
      { key: 'value', label: 'Value', secret: true },
    ],
    // {name} interpolates the plain field; {value} the resolved secret.
    authApply: { in: 'header', name: '{name}', format: '{value}' },
    uiMetadata: { icon: 'hash', category: 'auth', brandColor: '#8b5cf6' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Database (secret, authApply null — consumed by the driver via fields)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'postgres',
    connectionType: 'secret',
    label: 'Postgres',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'host',
        label: 'Host',
        default: 'localhost',
        required: true,
        placeholder: 'localhost or IP address',
        validation: { minLength: 1, maxLength: 255 },
      },
      {
        key: 'database',
        label: 'Database',
        default: 'postgres',
        required: true,
        placeholder: 'Database name',
        validation: { minLength: 1, maxLength: 63 },
      },
      {
        key: 'user',
        label: 'User',
        default: 'postgres',
        required: true,
        placeholder: 'Username',
        validation: { minLength: 1, maxLength: 63 },
      },
      {
        key: 'password',
        label: 'Password',
        secret: true,
        required: true,
        placeholder: 'Password',
      },
      {
        key: 'maxConnections',
        label: 'Maximum Number of Connections',
        type: FieldType.NUMBER,
        default: 100,
        description:
          'Make sure this value times the number of workers you have is lower than the maximum number of connections your postgres instance allows.',
        validation: { min: 1, max: 10000 },
      },
      {
        key: 'allowUnauthorizedCerts',
        label: 'Ignore SSL Issues (Insecure)',
        type: FieldType.CHECKBOX,
        default: false,
        description: 'Whether to connect even if SSL certificate validation is not possible',
      },
      {
        key: 'ssl',
        label: 'SSL',
        type: FieldType.SINGLE_SELECT,
        default: 'disable',
        displayOptions: { show: { allowUnauthorizedCerts: [false] } },
        options: [
          { label: 'Allow', value: 'allow' },
          { label: 'Disable', value: 'disable' },
          { label: 'Require', value: 'require' },
        ],
      },
      {
        key: 'port',
        label: 'Port',
        type: FieldType.NUMBER,
        default: 5432,
        placeholder: '5432',
        validation: { port: true, min: 1, max: 65535 },
      },
      { key: 'sshTunnel', label: 'SSH Tunnel', type: FieldType.CHECKBOX, default: false },
      {
        key: 'sshAuthenticateWith',
        label: 'SSH Authenticate with',
        type: FieldType.SINGLE_SELECT,
        default: 'password',
        required: true,
        options: [
          { label: 'Password', value: 'password' },
          { label: 'Private Key', value: 'privateKey' },
        ],
        displayOptions: { show: { sshTunnel: [true] } },
      },
      {
        key: 'sshHost',
        label: 'SSH Host',
        default: 'localhost',
        required: true,
        placeholder: 'SSH server hostname or IP',
        displayOptions: { show: { sshTunnel: [true] } },
        validation: { minLength: 1, maxLength: 255 },
      },
      {
        key: 'sshPort',
        label: 'SSH Port',
        type: FieldType.NUMBER,
        default: 22,
        placeholder: '22',
        displayOptions: { show: { sshTunnel: [true] } },
        validation: { port: true, min: 1, max: 65535 },
      },
      {
        key: 'sshUser',
        label: 'SSH User',
        default: 'root',
        required: true,
        placeholder: 'SSH username',
        displayOptions: { show: { sshTunnel: [true] } },
        validation: { minLength: 1, maxLength: 32 },
      },
      {
        key: 'sshPassword',
        label: 'SSH Password',
        secret: true,
        required: true,
        placeholder: 'SSH password',
        displayOptions: { show: { sshTunnel: [true], sshAuthenticateWith: ['password'] } },
      },
      {
        key: 'privateKey',
        label: 'Private Key',
        type: FieldType.TEXT,
        multiline: true,
        rows: 4,
        secret: true,
        required: true,
        placeholder: 'SSH private key content',
        displayOptions: { show: { sshTunnel: [true], sshAuthenticateWith: ['privateKey'] } },
        validation: { minLength: 100 },
      },
      {
        key: 'passphrase',
        label: 'Passphrase',
        secret: true,
        description: 'Passphrase used to create the key, if no passphrase was used leave empty',
        displayOptions: { show: { sshTunnel: [true], sshAuthenticateWith: ['privateKey'] } },
      },
    ],
    uiMetadata: { icon: 'brand:postgresql', category: 'database', brandColor: '#336791' },
  },
  {
    providerKey: 'postgresWithTesting',
    connectionType: 'secret',
    label: 'PostgreSQL Database (with testing)',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'host',
        label: 'Host',
        default: 'localhost',
        required: true,
        placeholder: 'localhost or IP address',
        validation: { minLength: 1, maxLength: 255 },
      },
      {
        key: 'port',
        label: 'Port',
        type: FieldType.NUMBER,
        default: 5432,
        placeholder: '5432',
        validation: { port: true, min: 1, max: 65535 },
      },
      {
        key: 'database',
        label: 'Database',
        default: 'postgres',
        required: true,
        placeholder: 'Database name',
        validation: { minLength: 1, maxLength: 63 },
      },
      {
        key: 'user',
        label: 'User',
        default: 'postgres',
        required: true,
        placeholder: 'Username',
        validation: { minLength: 1, maxLength: 63 },
      },
      {
        key: 'password',
        label: 'Password',
        secret: true,
        required: true,
        placeholder: 'Password',
      },
      {
        key: 'ssl',
        label: 'SSL Mode',
        type: FieldType.SINGLE_SELECT,
        default: 'prefer',
        description: 'SSL connection mode',
        options: [
          { label: 'Disable', value: 'disable' },
          { label: 'Allow', value: 'allow' },
          { label: 'Prefer', value: 'prefer' },
          { label: 'Require', value: 'require' },
        ],
      },
    ],
    uiMetadata: { icon: 'brand:postgresql', category: 'database', brandColor: '#336791' },
  },
  {
    providerKey: 'crateDb',
    connectionType: 'secret',
    label: 'CrateDB',
    global: true,
    authApply: null,
    connectionVariables: [
      { key: 'host', label: 'Host', default: 'localhost' },
      { key: 'database', label: 'Database', default: 'doc' },
      { key: 'user', label: 'User', default: 'crate' },
      { key: 'password', label: 'Password', secret: true },
      {
        key: 'ssl',
        label: 'SSL',
        type: FieldType.SINGLE_SELECT,
        default: 'disable',
        options: [
          { label: 'Allow', value: 'allow' },
          { label: 'Disable', value: 'disable' },
          { label: 'Require', value: 'require' },
        ],
      },
      { key: 'port', label: 'Port', type: FieldType.NUMBER, default: 5432 },
    ],
    uiMetadata: { icon: 'brand:cratedb', category: 'database', brandColor: '#14b8a6' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Email (secret, authApply null)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'smtp',
    connectionType: 'secret',
    label: 'SMTP Email Account',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'host',
        label: 'Host',
        required: true,
        placeholder: 'smtp.gmail.com',
        validation: { minLength: 1, maxLength: 255 },
      },
      {
        key: 'port',
        label: 'Port',
        type: FieldType.NUMBER,
        default: 587,
        required: true,
        placeholder: '587',
        validation: { port: true, min: 1, max: 65535 },
      },
      {
        key: 'username',
        label: 'Username',
        required: true,
        placeholder: 'your-email@gmail.com',
        validation: { minLength: 1, maxLength: 255 },
      },
      {
        key: 'password',
        label: 'Password',
        secret: true,
        required: true,
        placeholder: 'App password or account password',
      },
      {
        key: 'secure',
        label: 'Use TLS',
        type: FieldType.CHECKBOX,
        default: true,
        description: 'Whether to use TLS encryption (recommended for most providers)',
      },
      {
        key: 'ignoreTLS',
        label: 'Ignore SSL Issues (Insecure)',
        type: FieldType.CHECKBOX,
        default: false,
        description:
          'Whether to ignore SSL certificate validation (not recommended for production)',
      },
    ],
    uiMetadata: { icon: 'mail', category: 'email', brandColor: '#10b981' },
  },
  {
    providerKey: 'imap',
    connectionType: 'secret',
    label: 'IMAP',
    global: true,
    authApply: null,
    connectionVariables: [
      { key: 'user', label: 'User' },
      { key: 'password', label: 'Password', secret: true },
      { key: 'host', label: 'Host' },
      { key: 'port', label: 'Port', type: FieldType.NUMBER, default: 993 },
      { key: 'secure', label: 'SSL/TLS', type: FieldType.CHECKBOX, default: true },
      {
        key: 'allowUnauthorizedCerts',
        label: 'Allow Self-Signed Certificates',
        type: FieldType.CHECKBOX,
        default: false,
        description: 'Whether to connect even if SSL certificate validation is not possible',
      },
    ],
    uiMetadata: { icon: 'inbox', category: 'email', brandColor: '#3b82f6' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Object storage / keys (secret, authApply null — SDK-consumed)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'S3',
    connectionType: 'secret',
    label: 'AWS S3',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'accessKeyId',
        label: 'Access Key ID',
        required: true,
        placeholder: 'AKIA...',
        description: 'AWS IAM Access Key ID with S3 permissions',
        validation: { minLength: 16, maxLength: 128 },
      },
      {
        key: 'secretAccessKey',
        label: 'Secret Access Key',
        secret: true,
        required: true,
        placeholder: 'Enter your AWS Secret Access Key',
        description: 'AWS Secret Access Key corresponding to the Access Key ID',
        validation: { minLength: 40, maxLength: 40 },
      },
      {
        key: 'region',
        label: 'Region',
        default: 'us-east-1',
        required: true,
        placeholder: 'us-east-1',
        description: 'AWS region where your S3 buckets are located',
      },
      {
        key: 'endpoint',
        label: 'Custom Endpoint (Optional)',
        required: false,
        placeholder: 'https://s3.amazonaws.com',
        description: 'Custom S3 endpoint for S3-compatible services (leave empty for AWS S3)',
      },
      {
        key: 'sessionToken',
        label: 'Session Token (Optional)',
        secret: true,
        required: false,
        placeholder: 'Enter session token if using temporary credentials',
        description: 'AWS session token for temporary security credentials (STS)',
      },
      {
        key: 'bucket',
        label: 'Default Bucket (Optional)',
        required: false,
        placeholder: 'my-s3-bucket',
        description: 'Default S3 bucket for file operations (can be overridden per operation)',
      },
    ],
    uiMetadata: { icon: 'brand:aws', category: 'data', brandColor: '#FF9900' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Legacy / API-key data providers
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'airtableApi',
    connectionType: 'secret',
    label: 'Airtable API',
    description: 'Deprecated — use Airtable OAuth2 instead.',
    global: true,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'keyXXXXXXXXXXXXXX',
        validation: { minLength: 17, maxLength: 17 },
      },
    ],
    // `{apiKey}`, not the shared `BEARER` — see the openphone note below. `{value}`
    // is empty for a `secret` connection whose variable carries any other name.
    authApply: { in: 'header', name: 'Authorization', format: 'Bearer {apiKey}' },
    baseUrlTemplate: 'https://api.airtable.com/v0',
    uiMetadata: { icon: 'brand:airtable', category: 'data', brandColor: '#fcb401' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Channel API-key providers (secret). The SMS/phone channel (Quo, formerly
  // OpenPhone) as a per-org connection.
  //
  // ONE CONNECTION = ONE QUO WORKSPACE, not one phone number. Quo scopes the API
  // key and its webhooks at the workspace; only the number itself is a resource
  // within it. So the form collects the API KEY AND NOTHING ELSE — the connect
  // flow fetches `GET /v1/phone-numbers` with it, caches the trimmed list on
  // `Credential.metadata.quo`, and the number is a post-connect selection carried
  // through `postConnect` → `ctx.extra.phoneNumberId`. N Integrations then hang
  // off the one Credential, one per number turned into a channel.
  //
  // The other three fields this form used to collect are gone:
  //  - `phoneNumberId` validated `^pnv_.+`, but real Quo ids are `PN…` — the form
  //    literally could not be submitted, which is why this channel had never been
  //    connected. It is now picked from the live list after connect.
  //  - `phoneNumber` is derived from that same list.
  //  - `webhookSigningSecret` is minted by Quo and returned on webhook creation
  //    (`POST /v1/webhooks/messages` → `data.key`), which `setupWebhook` persists.
  //
  // providerKey stays `openphone` everywhere it is persisted (labels-only rename).
  // (Mailgun is intentionally absent — its key is a platform env, not a per-org
  // connection.)
  //
  // AUTH APPLIES `{apiKey}`, NOT THE SHARED `BEARER` CONSTANT. `BEARER` is
  // `Bearer {value}`, and `{value}` resolves to `secrets.accessToken || secrets.secret`
  // (`resolve-connection-for-runtime.secretValue`) — neither of which a `secret`
  // connection with NAMED variables ever sets: `saveConnection` files a secret-flagged
  // variable under `secrets.fields.<key>`. `{value}`'s only other fallback is a field
  // literally named `value` (which is why `httpHeaderAuth` names its variable that).
  // With `BEARER` here the connector sent `Authorization: Bearer ` — empty — and every
  // request 401'd; the channel never noticed because `providers/openphone/api.ts`
  // hand-rolls its own header and never goes through `applyAuth`. Raw (no `Bearer `
  // prefix) matches Quo's docs and that same channel code; Quo accepts either form.
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'openphone',
    connectionType: 'secret',
    label: 'Quo',
    global: true,
    authApply: { in: 'header', name: 'Authorization', format: '{apiKey}' },
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'Your Quo API key',
        description:
          'Quo API key — Workspace Settings → API in the Quo dashboard (owner/admin only). One key covers every phone number on the workspace.',
        validation: { minLength: 10, message: 'API key must be at least 10 characters.' },
      },
    ],
    // `brand:quo`, not `brand:openphone` — the latter had no file on disk, so this
    // rendered as a fallback identity. The provider KEY stays `openphone` (it is
    // persisted on every Credential row); only the mark is renamed.
    uiMetadata: { icon: 'brand:quo', category: 'other', brandColor: '#0e0f17' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // AI provider API keys (secret, authApply null — consumed by the AI SDK)
  // ────────────────────────────────────────────────────────────────────────
  {
    providerKey: 'openaiApi',
    connectionType: 'secret',
    label: 'OpenAI API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'sk-...',
        description: 'Your OpenAI API key from https://platform.openai.com/api-keys',
        validation: { minLength: 20 },
      },
      {
        key: 'organization',
        label: 'Organization ID (Optional)',
        required: false,
        placeholder: 'org-...',
        description: 'OpenAI Organization ID for usage tracking (optional)',
      },
      {
        key: 'apiBase',
        label: 'API Base URL (Optional)',
        default: 'https://api.openai.com/v1',
        required: false,
        placeholder: 'https://api.openai.com/v1',
        description: 'Custom API base URL for OpenAI-compatible endpoints',
      },
    ],
    uiMetadata: { icon: 'brand:openai', category: 'ai', brandColor: '#10A37F' },
  },
  {
    providerKey: 'anthropicApi',
    connectionType: 'secret',
    label: 'Anthropic API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'sk-ant-...',
        description: 'Your Anthropic API key from https://console.anthropic.com/settings/keys',
        validation: { minLength: 20 },
      },
      {
        key: 'voyageApiKey',
        label: 'Voyage API Key (Optional)',
        secret: true,
        required: false,
        placeholder: 'pa-...',
        description: 'Voyage AI API key for embeddings (optional)',
      },
    ],
    uiMetadata: { icon: 'brand:anthropic', category: 'ai', brandColor: '#D4A574' },
  },
  {
    providerKey: 'googleAiApi',
    connectionType: 'secret',
    label: 'Google AI API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'AIza...',
        description: 'Your Google AI API key from https://aistudio.google.com/app/apikey',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:gemini', category: 'ai', brandColor: '#4285F4' },
  },
  {
    providerKey: 'groqApi',
    connectionType: 'secret',
    label: 'Groq API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'gsk_...',
        description: 'Your Groq API key from https://console.groq.com/keys',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:groq', category: 'ai', brandColor: '#F55036' },
  },
  {
    providerKey: 'deepseekApi',
    connectionType: 'secret',
    label: 'DeepSeek API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'sk-...',
        description: 'Your DeepSeek API key from https://platform.deepseek.com/api_keys',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:deepseek', category: 'ai', brandColor: '#0EA5E9' },
  },
  {
    providerKey: 'qwenApi',
    connectionType: 'secret',
    label: 'Qwen API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'sk-...',
        description: 'Your Qwen (DashScope) API key',
        validation: { minLength: 20 },
      },
      {
        key: 'apiBase',
        label: 'API Base URL (Optional)',
        default: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
        required: false,
        placeholder: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
        description: 'Region-specific Qwen (DashScope) endpoint',
      },
    ],
    uiMetadata: { icon: 'brand:qwen', category: 'ai', brandColor: '#615CED' },
  },
  {
    providerKey: 'kimiApi',
    connectionType: 'secret',
    label: 'Kimi API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'sk-...',
        description: 'Your Kimi (Moonshot AI) API key from https://platform.moonshot.ai/',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:kimi', category: 'ai', brandColor: '#000000' },
  },
  {
    providerKey: 'zaiApi',
    connectionType: 'secret',
    label: 'Z.AI API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: '<id>.<secret>',
        description: 'Your Z.AI (Zhipu / GLM) API key from https://z.ai/manage-apikey/apikey-list',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:zai', category: 'ai', brandColor: '#3859FF' },
  },
  {
    providerKey: 'grokApi',
    connectionType: 'secret',
    label: 'xAI (Grok) API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: 'xai-...',
        description: 'Your xAI API key from https://console.x.ai',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:grok', category: 'ai', brandColor: '#000000' },
  },
  {
    providerKey: 'cohereApi',
    connectionType: 'secret',
    label: 'Cohere API',
    global: true,
    authApply: null,
    connectionVariables: [
      {
        key: 'apiKey',
        label: 'API Key',
        secret: true,
        required: true,
        placeholder: '...',
        description: 'Your Cohere API key from https://dashboard.cohere.com/api-keys',
        validation: { minLength: 20 },
      },
    ],
    uiMetadata: { icon: 'brand:cohere', category: 'ai', brandColor: '#39594D' },
  },

  // ────────────────────────────────────────────────────────────────────────
  // Hosted-provision providers (provider mints a resource + hosted redirect)
  // ────────────────────────────────────────────────────────────────────────
  {
    // Stripe Connect (Account Links) — money MP1's payment onboarding. Charges run on the
    // platform key + `Stripe-Account` header, so there is no stored token and no OAuth
    // client: the Credential only anchors the connected `acct_…` (connection variables).
    providerKey: 'stripeConnect',
    connectionType: 'hosted-provision',
    hostedProvisionKey: 'stripeConnect',
    label: 'Stripe',
    description: 'Accept card payments on invoices. Payouts run on your Stripe schedule.',
    global: true,
    authApply: null,
    uiMetadata: { icon: 'brand:stripe', category: 'other', brandColor: '#635bff' },
  },
]
