# Unified CRUD Handler

The `UnifiedCrudHandler` provides a single, consistent API for managing all entity types in Auxx.ai - both system entities (contacts, tickets) and custom entities.

## Overview

The Unified CRUD Handler replaces the previous fragmented approach where each entity type had its own service:

- ❌ **Old:** `ContactService`, `TicketService`, `EntityInstanceService` (deprecated)
- ✅ **New:** `UnifiedCrudHandler` (single handler for all entities)

## Key Features

- **System Entity Support**: Works seamlessly with system entities like contacts and tickets
- **Custom Entity Support**: Handles user-defined custom entities
- **System Hooks**: Automatic validation and normalization via system hooks
- **ResourceId-Based**: Uses ResourceId format (`"entityDefinitionId:instanceId"`) throughout
- **Bulk Operations**: Efficient bulk create, update, delete, and field setting
- **findByField & findOrCreate**: Convenient methods for common patterns
- **Event Publishing**: Automatic event publishing for all mutations
- **Snapshot Invalidation**: Automatic cache invalidation for query snapshots

## Usage

### Basic Setup

```typescript
import { UnifiedCrudHandler } from '@auxx/lib/resources/crud'
import { toResourceId } from '@auxx/lib/resources/resource-id'

const handler = new UnifiedCrudHandler(
  organizationId,
  userId,
  database // optional, uses default if not provided
)
```

### Creating Entities

```typescript
// Create a contact
const contact = await handler.create('contact', {
  primary_email: 'john@example.com',
  first_name: 'John',
  last_name: 'Doe',
  phone: '+1-555-0100'
})

// Create a custom entity
const product = await handler.create('custom-entity-uuid', {
  name: 'Widget Pro',
  sku: 'WGT-001',
  price: 99.99
})

// Bulk create
const { created, errors } = await handler.bulkCreate('contact', [
  { primary_email: 'alice@example.com', first_name: 'Alice' },
  { primary_email: 'bob@example.com', first_name: 'Bob' },
])
```

### Reading Entities

```typescript
// Get by ResourceId
const resourceId = toResourceId('contact', contactId)
const contact = await handler.getById(resourceId)

// List with pagination
const { items, nextCursor } = await handler.list('contact', {
  includeArchived: false,
  limit: 50,
  cursor: 'previous-cursor'
})

// Find by field (using system attribute)
const contact = await handler.findByField(
  'contact',
  'primary_email', // systemAttribute
  'john@example.com'
)

// Get field values
const values = await handler.getFieldValues(resourceId, ['field-id-1', 'field-id-2'])
```

### Updating Entities

```typescript
// Update entity
const resourceId = toResourceId('contact', contactId)
await handler.update(resourceId, {
  first_name: 'Jane',
  phone: '+1-555-0200'
})

// Set single field value
await handler.setFieldValue(resourceId, fieldId, 'new value')

// Bulk update
await handler.bulkUpdate([
  { resourceId: toResourceId('contact', id1), values: { first_name: 'Alice' } },
  { resourceId: toResourceId('contact', id2), values: { first_name: 'Bob' } }
])

// Bulk set field (same field, many entities)
await handler.bulkSetFieldValue(
  [
    toResourceId('contact', id1),
    toResourceId('contact', id2)
  ],
  'contact_status',
  'ACTIVE'
)
```

### Deleting Entities

```typescript
// Soft delete (archive)
await handler.archive(resourceId)

// Restore archived
await handler.restore(resourceId)

// Hard delete
await handler.delete(resourceId)

// Bulk archive
await handler.bulkArchive([
  toResourceId('contact', id1),
  toResourceId('contact', id2)
])

// Bulk delete
await handler.bulkDelete([resourceId1, resourceId2])
```

### Find or Create Pattern

```typescript
// Find contact by email, create if not found
const { instance, created } = await handler.findOrCreate(
  'contact',
  { primary_email: 'jane@example.com' }, // find by these fields
  {
    // additional values if creating
    first_name: 'Jane',
    last_name: 'Smith',
    contact_status: 'ACTIVE'
  }
)

if (created) {
  console.log('Created new contact:', instance.id)
} else {
  console.log('Found existing contact:', instance.id)
}
```

## System Hooks

System hooks run automatically during create and update operations for system entities. They perform validation, normalization, and constraint checking.

### Contact Hooks

The following hooks run automatically for contacts:

#### `primary_email` field:
1. **validateEmailFormat** - Ensures valid email format
2. **normalizeEmailValue** - Converts to lowercase, applies Gmail normalization
3. **checkEmailUniqueness** - Prevents duplicate email addresses

#### `contact_status` field:
1. **validateContactStatus** - Validates status is one of: ACTIVE, INACTIVE, SPAM, MERGED
2. **preventMergedStatus** - Prevents manual setting of MERGED status (only via merge operation)

### Example: Hook Behavior

```typescript
// This will fail: invalid email format
await handler.create('contact', {
  primary_email: 'not-an-email',
  first_name: 'John'
})
// ❌ Error: Invalid email format

// This will fail: duplicate email
await handler.create('contact', {
  primary_email: 'existing@example.com', // already exists
  first_name: 'Jane'
})
// ❌ Error: Email address already exists: existing@example.com

// This succeeds: email is normalized automatically
const contact = await handler.create('contact', {
  primary_email: 'John.Doe@EXAMPLE.COM', // uppercase
  first_name: 'John'
})
// ✅ Stored as: john.doe@example.com

// This fails on update: cannot manually set MERGED status
await handler.update(resourceId, {
  contact_status: 'MERGED'
})
// ❌ Error: Cannot manually set contact status to MERGED. Use the merge operation instead.
```

## Error Handling

All methods throw errors on failure. Use try-catch blocks:

```typescript
try {
  const contact = await handler.create('contact', {
    primary_email: 'invalid email'
  })
} catch (error) {
  console.error('Failed to create contact:', error.message)
  // Output: "Invalid email format"
}
```

## Events

The handler automatically publishes events for all mutations:

- `entity:created` - After successful create
- `entity:updated` - After successful update or restore
- `entity:deleted` - After archive or delete (includes `hardDelete` flag)

Event payload includes:
- `instanceId` - The entity instance ID
- `entityDefinitionId` - The entity definition ID
- `entitySlug` - The API slug (e.g., 'contacts', 'tickets')
- `entityType` - The entity type (e.g., 'contact', 'ticket', null for custom)
- `organizationId` - Organization ID
- `userId` - User who performed the action
- `values` - Field values that were set/updated
- `hardDelete` - Boolean (only for delete events)
- `restored` - Boolean (only for restore operations)

## Snapshot Invalidation

The handler automatically invalidates query snapshots after mutations, ensuring cached filtered views are refreshed.

## Implementation Notes

### Entity Definition Resolution

The handler accepts both system type strings and UUID:

- System entities: `'contact'`, `'ticket'`, `'part'`, `'entity_group'`
- Custom entities: UUID (e.g., `'clz1234567890abcdef'`)

System types are resolved by querying `EntityDefinition` where `entityType = 'contact'`.

### ResourceId Format

All operations use ResourceId format: `"entityDefinitionId:instanceId"`

```typescript
import { toResourceId, parseResourceId } from '@auxx/lib/resources/resource-id'

// Create ResourceId
const resourceId = toResourceId('contact', 'instance-id-123')
// Result: "contact:instance-id-123"

// Parse ResourceId
const { entityDefinitionId, entityInstanceId } = parseResourceId(resourceId)
```

### Field IDs vs System Attributes

- **Field IDs** - UUIDs that identify custom field definitions (e.g., `'clz1234567890'`)
- **System Attributes** - Named system fields (e.g., `'primary_email'`, `'first_name'`)

When setting values, use **field IDs**:

```typescript
await handler.create('contact', {
  'field-uuid-1': 'value1',
  'field-uuid-2': 'value2'
})
```

When finding by field, use **system attributes**:

```typescript
await handler.findByField('contact', 'primary_email', 'john@example.com')
```

## Migration from Old Services

### From ContactService

```typescript
// Old
const contactService = new ContactService(ctx)
const contact = await contactService.createContact({ email: 'john@example.com' })

// New
const handler = new UnifiedCrudHandler(ctx.organizationId, ctx.userId, ctx.db)
const contact = await handler.create('contact', { primary_email: 'john@example.com' })
```

### From EntityInstanceService

```typescript
// Old
const service = new EntityInstanceService(orgId, userId)
const { id } = await service.createWithValues(entityDefId, values)

// New
const handler = new UnifiedCrudHandler(orgId, userId)
const instance = await handler.create(entityDefId, values)
```

## Adding New System Entities

To add system hooks for a new entity type (e.g., tickets):

1. Create `packages/lib/src/resources/hooks/ticket-hooks.ts`:

```typescript
import type { SystemHookRegistry } from './types'

export const TICKET_HOOKS: SystemHookRegistry = {
  ticket_number: [validateTicketNumber, normalizeTicketNumber],
  ticket_status: [validateTicketStatus]
}
```

2. Register in `system-hooks.ts`:

```typescript
import { TICKET_HOOKS } from './ticket-hooks'

const HOOKS_BY_ENTITY_TYPE = {
  contact: CONTACT_HOOKS,
  ticket: TICKET_HOOKS, // Add here
}
```

3. Use the handler as normal:

```typescript
const ticket = await handler.create('ticket', {
  ticket_number: 'TKT-001',
  ticket_status: 'OPEN'
})
```

## Testing

```typescript
import { UnifiedCrudHandler } from '@auxx/lib/resources/crud'
import { toResourceId } from '@auxx/lib/resources/resource-id'

describe('UnifiedCrudHandler', () => {
  let handler: UnifiedCrudHandler

  beforeEach(() => {
    handler = new UnifiedCrudHandler(testOrgId, testUserId, testDb)
  })

  it('creates contact with valid email', async () => {
    const contact = await handler.create('contact', {
      primary_email: 'test@example.com',
      first_name: 'Test'
    })

    expect(contact.id).toBeDefined()
  })

  it('rejects invalid email format', async () => {
    await expect(
      handler.create('contact', {
        primary_email: 'invalid',
        first_name: 'Test'
      })
    ).rejects.toThrow('Invalid email format')
  })

  it('finds or creates contact', async () => {
    const { instance, created } = await handler.findOrCreate(
      'contact',
      { primary_email: 'new@example.com' },
      { first_name: 'New' }
    )

    expect(created).toBe(true)
    expect(instance.id).toBeDefined()

    // Second call finds existing
    const { instance: existing, created: wasCreated } = await handler.findOrCreate(
      'contact',
      { primary_email: 'new@example.com' },
      { first_name: 'New' }
    )

    expect(wasCreated).toBe(false)
    expect(existing.id).toBe(instance.id)
  })
})
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                 UnifiedCrudHandler                      │
│                                                         │
│  Single API for ALL entity types:                      │
│  • System entities (contact, ticket)                   │
│  • Custom entities (user-defined)                      │
└─────────────────┬───────────────────────────────────────┘
                  │
                  ├──► System Hooks (validation, normalization)
                  │
                  ├──► FieldValueService (typed storage)
                  │
                  ├──► EntityInstance (CRUD functions)
                  │
                  ├──► Event Publisher (entity:created, etc.)
                  │
                  └──► Snapshot Invalidation (cache management)
```

## See Also

- [Contact Migration Plan](../../../../plans/entity/contact-migration-plan-v3.md)
- [ResourceId Format](../resource-id.ts)
- [System Hooks](../hooks/system-hooks.ts)
- [FieldValueService](../../field-values/field-value-service.ts)
