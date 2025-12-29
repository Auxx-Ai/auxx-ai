// src/lib/providers/openphone/types.ts

// Describes the expected structure in the Integration.metadata field
export interface OpenPhoneIntegrationMetadata {
  apiKeyHashed?: boolean // Flag indicating if the stored key is hashed (recommended)
  phoneNumberId: string
  phoneNumber: string // E.164 format
  webhookSigningSecret: string
  webhookId?: string // ID of the webhook created via API (if applicable)
}

// --- Types based on OpenPhone API Docs ---

export interface OpenPhoneConversation {
  id: string
  object: 'conversation'
  phone_number_id: string
  contact: OpenPhoneContact | null
  latest_message: OpenPhoneMessage | null
  unread: boolean
  last_activity_at: string // ISO 8601 Date string
  created_at: string // ISO 8601 Date string
}

export interface OpenPhoneContact {
  id: string
  object: 'contact'
  name: string | null
  company_name: string | null
  // ... other contact fields
}

export interface OpenPhoneMessage {
  id: string
  object: 'message'
  conversation_id: string
  phone_number_id: string
  direction: 'inbound' | 'outbound'
  sender_phone_number: string | null // E.164 format
  recipient_phone_number: string | null // E.164 format
  sender_contact: OpenPhoneContact | null
  recipient_contact: OpenPhoneContact | null
  status: 'received' | 'sent' | 'delivered' | 'read' | 'error'
  type: 'sms' // Assuming only SMS for now
  body: string
  attachments: OpenPhoneAttachment[]
  date_created: string // ISO 8601 Date string
  date_sent: string | null // ISO 8601 Date string
  date_delivered: string | null // ISO 8601 Date string
  date_read: string | null // ISO 8601 Date string
}

export interface OpenPhoneAttachment {
  id: string
  object: 'attachment'
  file_name: string
  content_type: string
  url: string
  size_bytes: number
}

// Type for POST /messages payload
export interface OpenPhoneSendMessagePayload {
  phone_number_id: string
  to: string // E.164 phone number
  body: string
  // attachments?: Array<{ url: string }>; // Sending attachments
}

// Type for POST /webhooks payload
export interface OpenPhoneWebhookPayload {
  url: string
  secret: string
  triggers: Array<'message.received' | 'call.ringing' | 'call.finished' /* Add others */>
}

export interface OpenPhoneWebhookResponse {
  id: string
  object: 'webhook'
  url: string
  secret: string // The secret you provided
  triggers: string[]
  status: 'active' | 'inactive'
  date_created: string
  date_updated: string
}

// Type for incoming webhook event
export interface OpenPhoneWebhookEvent<T = any> {
  id: string // Event ID
  object: 'event'
  type: string // e.g., 'message.received'
  date_created: string
  data: T // Payload depends on the event type
  webhook_id: string
  api_version: string
}

export type OpenPhoneMessageReceivedData = {
  object: 'message'
} & OpenPhoneMessage // Reuse the Message type
