// apps/web/src/components/webhooks/ui/webhook-endpoint-fields.ts
// The endpoint configure form modeled as synthetic connection variables, shared by the
// create-from-template (gallery) and edit (standalone) hosts. `displayOptions.show` drives
// the conditional rows for free: hmac signature fields, the Stripe signing-secret field, and
// the topic-value row. Pure — no React.

import type { ConnectionVariable } from '@auxx/database'
import { FieldType } from '@auxx/database/enums'
import type { WebhookEndpointTemplate } from '@auxx/lib/webhooks/endpoint-templates'
import type { WebhookEndpointRow } from '../hooks/use-webhook-endpoint'

/**
 * The topic-value row, worded for the chosen source: a request header name vs a dot-path into
 * the JSON body (resolved with `getByPath` server-side). The `description` surfaces as a tooltip
 * with a concrete example.
 */
function topicValueVar(topicSourceKind?: string): ConnectionVariable {
  const isPath = topicSourceKind === 'path'
  return {
    key: 'topicSourceValue',
    label: isPath ? 'JSON path' : 'Header name',
    type: FieldType.TEXT,
    required: true,
    description: isPath
      ? 'Dot-path into the request body whose value is the topic. Example: type (Stripe) or event.type'
      : 'Name of the request header whose value is the topic. Example: x-github-event',
    placeholder: isPath ? 'type' : 'x-github-event',
    displayOptions: { show: { topicSourceKind: ['header', 'path'] } },
  }
}

/**
 * Build the configure-form variables. `topicSourceKind` words the topic-value row;
 * `includeStripeSecret` adds the pasted-secret row (create only — on edit the secret is
 * managed through the Rotate/Replace affordance, not this form).
 */
export function endpointVars(
  topicSourceKind?: string,
  opts?: { includeStripeSecret?: boolean }
): ConnectionVariable[] {
  const vars: ConnectionVariable[] = [
    {
      key: 'name',
      label: 'Name',
      type: FieldType.TEXT,
      required: true,
      placeholder: 'Typeform leads',
    },
    {
      key: 'verification',
      label: 'Verification',
      type: FieldType.SINGLE_SELECT,
      required: true,
      default: 'hmac',
      description: 'How inbound deliveries are checked.',
      options: [
        { label: 'HMAC signature', value: 'hmac' },
        { label: 'Stripe signature', value: 'stripe' },
        { label: 'Bearer token', value: 'token' },
        { label: 'None (open)', value: 'none' },
      ],
    },
    {
      key: 'stripeSecret',
      label: 'Signing secret',
      type: FieldType.TEXT,
      required: true,
      secret: true,
      description: 'Stripe generates this (starts with whsec_) when you add the endpoint.',
      placeholder: 'whsec_…',
      displayOptions: { show: { verification: ['stripe'] } },
    },
    {
      key: 'signatureHeader',
      label: 'Signature header',
      type: FieldType.TEXT,
      required: true,
      default: 'x-hub-signature-256',
      placeholder: 'x-hub-signature-256',
      displayOptions: { show: { verification: ['hmac'] } },
    },
    {
      key: 'signaturePrefix',
      label: 'Signature prefix',
      type: FieldType.TEXT,
      required: false,
      placeholder: 'sha256=',
      description: 'Stripped before comparison (optional).',
      displayOptions: { show: { verification: ['hmac'] } },
    },
    {
      key: 'signatureEncoding',
      label: 'Signature encoding',
      type: FieldType.SINGLE_SELECT,
      required: true,
      default: 'hex',
      options: [
        { label: 'Hex (GitHub, Stripe)', value: 'hex' },
        { label: 'Base64 (Shopify-style)', value: 'base64' },
      ],
      displayOptions: { show: { verification: ['hmac'] } },
    },
    {
      key: 'topicSourceKind',
      label: 'Topic source',
      type: FieldType.SINGLE_SELECT,
      required: true,
      default: 'none',
      description: 'Optionally route deliveries on a topic pulled from each request.',
      options: [
        { label: 'No topic (every delivery matches)', value: 'none' },
        { label: 'From a header', value: 'header' },
        { label: 'From a JSON path', value: 'path' },
      ],
    },
    topicValueVar(topicSourceKind),
  ]
  return opts?.includeStripeSecret ? vars : vars.filter((v) => v.key !== 'stripeSecret')
}

/**
 * The configure form's value bag. Every seeder below fills all eight keys, so the form can read
 * them without a per-key undefined guard (a bare `Record<string, string>` would not model that).
 */
export type WebhookEndpointFormValues = {
  name: string
  verification: string
  stripeSecret: string
  signatureHeader: string
  signaturePrefix: string
  signatureEncoding: string
  topicSourceKind: string
  topicSourceValue: string
}

/** Seed the form from an existing endpoint (edit mode). */
export function seedValuesFromEndpoint(endpoint: WebhookEndpointRow): WebhookEndpointFormValues {
  return {
    name: endpoint.name,
    verification: endpoint.verification,
    stripeSecret: '',
    signatureHeader: endpoint.signatureHeader ?? 'x-hub-signature-256',
    signaturePrefix: endpoint.signaturePrefix ?? '',
    signatureEncoding: endpoint.signatureEncoding,
    topicSourceKind: endpoint.topicSource?.kind ?? 'none',
    topicSourceValue: endpoint.topicSource?.value ?? '',
  }
}

/** Seed the form from a template (create-from-template). Blank templates fall back to defaults. */
export function seedValuesFromTemplate(
  template: WebhookEndpointTemplate
): WebhookEndpointFormValues {
  const c = template.config
  return {
    name: template.blank ? '' : template.name,
    verification: c.verification,
    stripeSecret: '',
    signatureHeader: c.signatureHeader ?? 'x-hub-signature-256',
    signaturePrefix: c.signaturePrefix ?? '',
    signatureEncoding: c.signatureEncoding ?? 'hex',
    topicSourceKind: c.topicSource?.kind ?? 'none',
    topicSourceValue: c.topicSource?.value ?? '',
  }
}

/** Empty seed (blank create). */
export function blankSeedValues(): WebhookEndpointFormValues {
  return {
    name: '',
    verification: 'hmac',
    stripeSecret: '',
    signatureHeader: 'x-hub-signature-256',
    signaturePrefix: '',
    signatureEncoding: 'hex',
    topicSourceKind: 'none',
    topicSourceValue: '',
  }
}
