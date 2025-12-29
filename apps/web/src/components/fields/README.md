# Entity Fields System

A flexible, configuration-driven architecture for managing entity fields (both built-in and custom) across multiple data models.

## Overview

This system provides a generic way to display and edit fields for different entity types (Contacts, Tickets, Threads/Conversations, Companies) without duplicating code.

## Architecture

### Components

- **`EntityFields`** - Generic component that handles field rendering and mutations for any entity type
- **`ContactFields`** - Wrapper for contacts (backward compatible)
- **`TicketFields`** - Wrapper for tickets
- **`ThreadFields`** - Wrapper for threads/conversations

### Configuration

All entity-specific behavior is defined in `configs/model-field-configs.ts`:

```typescript
const contactFieldConfig: EntityModelConfig = {
  modelType: DataModelType.CONTACT,
  entityIdProp: 'contactId',
  builtInFields: [...], // Built-in field definitions
  queries: {
    getById: 'contact.getById',
    update: 'contact.update',
  },
  mutations: {...} // Custom mutation handlers
}
```

### Custom Mutations

Special field mutation logic is defined in `mutations/` directory:

- `contact-mutations.ts` - Handles `customerGroups` (many-to-many) and `name` (compound field)

## Usage

### Using ContactFields (existing usage - no changes needed)

```tsx
import ContactFields from '~/components/contacts/drawer/contact-fields'

<ContactFields contactId={contact.id} />
```

### Using TicketFields

```tsx
import { TicketFields } from '~/components/tickets/drawer'

<TicketFields ticketId={ticket.id} />
```

### Using ThreadFields

```tsx
import { ThreadFields } from '~/components/threads/drawer'

<ThreadFields threadId={thread.id} />
```

### Using EntityFields Directly

```tsx
import { EntityFields } from '~/components/fields'
import { DataModelType } from '@auxx/lib/custom-fields/types'

<EntityFields modelType={DataModelType.CONTACT} entityId={contactId} />
```

## Adding a New Entity Type

1. **Add built-in field definitions** in `configs/model-field-configs.ts`:

```typescript
export const myEntityFieldConfig: EntityModelConfig = {
  modelType: DataModelType.MY_ENTITY,
  entityIdProp: 'myEntityId',
  builtInFields: [
    {
      id: 'title',
      name: 'Title',
      type: ContactFieldType.TEXT,
      icon: FileText,
    },
    // ... more fields
  ],
  queries: {
    getById: 'myEntity.getById',
    update: 'myEntity.update',
  },
}
```

2. **Add to modelConfigs** record:

```typescript
export const modelConfigs: Record<DataModelType, EntityModelConfig> = {
  // ... existing configs
  [DataModelType.MY_ENTITY]: myEntityFieldConfig,
}
```

3. **Create wrapper component**:

```tsx
// components/my-entity/drawer/my-entity-fields.tsx
import EntityFields from '../../fields/entity-fields'
import { DataModelType } from '@auxx/lib/custom-fields/types'

export function MyEntityFields({ myEntityId }: { myEntityId: string }) {
  return <EntityFields modelType={DataModelType.MY_ENTITY} entityId={myEntityId} />
}
```

## Custom Mutation Handlers

If an entity has special mutation logic (e.g., many-to-many relationships, compound fields):

1. **Create mutation handler** in `mutations/my-entity-mutations.ts`:

```typescript
export async function handleSpecialFieldMutation({ entityId, value, context }) {
  // Custom logic here
}
```

2. **Reference in config**:

```typescript
mutations: {
  specialField: async ({ entityId, value, context }) => {
    const { handleSpecialFieldMutation } = await import('./mutations/my-entity-mutations')
    await handleSpecialFieldMutation({ entityId, value, context })
  }
}
```

## Features

- ✅ Eliminates ~90% code duplication across entity types
- ✅ Built-in and custom fields for all entities
- ✅ Optimistic updates with rollback
- ✅ Single-popover-open behavior
- ✅ Field validation
- ✅ Type-safe configurations
- ✅ Backward compatible with existing ContactFields

## File Structure

```
apps/web/src/components/fields/
├── entity-fields.tsx              # Generic component
├── index.ts                        # Exports
├── README.md                       # This file
├── configs/
│   └── model-field-configs.ts     # Model configurations
└── mutations/
    └── contact-mutations.ts       # Contact-specific handlers
```
