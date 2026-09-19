// packages/lib/src/entity-instances/metadata-types.ts
// Typed metadata interfaces per entityType (resourceType)

/**
 * Ticket-specific metadata stored in EntityInstance.metadata
 * Used when EntityDefinition.entityType = 'ticket'
 */
export type TicketMetadata = {
  /** ISO timestamp when status changed to RESOLVED */
  resolvedAt?: string
  /** ISO timestamp when status changed to CLOSED */
  closedAt?: string
  /** Type-specific structured data (MISSING_ITEM fields, RETURN fields, etc.) */
  typeData?: Record<string, unknown>
  /** Type-specific status (e.g., return status, refund status) */
  typeStatus?: string
  /** Mailgun message ID for email deduplication (unique indexed) */
  mailgunMessageId?: string
  /** Generated ticket email address for inbound routing */
  internalReference?: string
  /** Shopify customer ID for integration */
  shopifyCustomerId?: string
}

/**
 * Contact-specific metadata stored in EntityInstance.metadata
 * Used when EntityDefinition.entityType = 'contact'
 */
export type ContactMetadata = {
  /** Shopify customer ID if linked */
  shopifyCustomerId?: string
  /** Source of the contact record */
  source?: string
  /** Last interaction timestamp */
  lastInteractionAt?: string
}

/**
 * Part-specific metadata stored in EntityInstance.metadata
 * Used when EntityDefinition.entityType = 'part'
 */
export type PartMetadata = {
  /** External system ID (e.g., ERP system) */
  externalId?: string
  /** Last inventory sync timestamp */
  lastSyncAt?: string
}

/**
 * Vendor-bill metadata stored in EntityInstance.metadata
 * Used when EntityDefinition.entityType = 'vendor_bill'
 */
export type VendorBillMetadata = {
  /** Set while a posted bill is unlocked for editing (73 D4). Absent = locked. */
  editOpen?: {
    /** ISO timestamp the Edit button was pressed. */
    openedAt: string
    byUserId: string
  }
}

/**
 * Union type for all entity metadata types
 */
export type EntityMetadata =
  | TicketMetadata
  | ContactMetadata
  | PartMetadata
  | VendorBillMetadata
  | Record<string, unknown>

/**
 * Helper type to get metadata type by entity type
 */
export type MetadataByEntityType<T extends string> = T extends 'ticket'
  ? TicketMetadata
  : T extends 'contact'
    ? ContactMetadata
    : T extends 'part'
      ? PartMetadata
      : T extends 'vendor_bill'
        ? VendorBillMetadata
        : Record<string, unknown>
