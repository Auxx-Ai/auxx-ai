# Enhanced Claude Project Instructions

## Very important rules

- Do not lie to me, that is being dishonest.
- Do not tell me I'm right when I'm not right
- If my idea is inferior to your idea, let me know.

## Project Overview

Auxx.ai is an open-source AI-powered email support ticket answer service for Shopify businesses. The platform integrates email services (Gmail and Outlook) with Shopify to provide automated customer support solutions.

## Tech Stack

- **Framework**: Next.js v16.1 with React Server Components and app router
- **API**: tRPC v11 with React Query
- **Database**: PostgreSQL with Drizzle ORM v.0.31.0
- **Frontend**: TailwindCSS v4 and shadcn component library
- **Forms**: react-hook-form v7.54
- **Caching**: Redis
- **Package Manager**: pnpm

# Coding Standards

## General

- Use TypeScript for all code
- Implement responsive designs for all components
- As this is an early-stage startup, YOU MUST prioritize simple, readable code with minimal abstraction—avoid premature optimization. Strive for elegant, minimal solutions that reduce complexity.Focus on clear implementation that’s easy to understand and iterate on as the product evolves.
- DO NOT use preserve backward compatibility unless the user specifically requests it
- You MUST strive for elegant, minimal solutions that eliminate complexity and bugs. Remove all backward compatibility and legacy code. YOU MUST prioritize simple, readable code with minimal abstraction—avoid premature optimization. Focus on clear implementation that’s easy to understand and iterate on as the product evolves. think hard

## Component Architecture

- Create reusable and modular components
- Break large components into smaller ones for better maintainability
- File naming: use kebab-case for files (e.g., `user-profile.tsx`)
- At the top of each file, comment the file-path/file-name.file_type
- Component naming: use PascalCase for components (e.g., `UserProfile`)
- Add `'use client'` directive for any components using client-side hooks or state
- Comment every function, interface, type, and global variable

## API & Data Handling

- Use tRPC protected procedures for authenticated routes
- Access DB in protected procedures with `ctx.db.<tableName>` (singular form)
- Import tRPC client with `import { api } from '~/trpc/react'`
- For mutations, use simplified naming:
  ```typescript
  // Do this:
  const sendReply = api.ticketAttachment.sendTicketReply.useMutation()
  // Not this:
  const sendReplyMutation = api.ticketAttachment.sendTicketReply.useMutation()
  ```

## Module Exports

- Inside index.ts files when exporting files, explicitly export methods, types instead of export _. e.g. export { X, Y } from './xy' instead of export _ from './xy'

## Utility Methods

**IMPORTANT**: Before creating any utility functions, check `packages/lib/src/utils` for existing helpers:

- **date.ts** - Date formatting and relative time
- **email.ts** - Email parsing, validation, and formatting
- **file.ts** - File operations and path utilities
- **generateId.ts** - Unique ID generation
- **strings.ts** - String manipulation (titleize, pluralize, whitespace)
- **contact.ts** - Name, phone, and address formatting

## UI Components

- Import shadcn components from `'@auxx/ui/components/<component>'`
- Every `<SelectItem>` component must have a `value` prop

### **toast**: Use the toast system for notifications:

```typescript
import { toastError } from '@auxx/ui/components/toast'

// Success Message: do not have toast for success. only error.

// Error notification
toastError({ title: 'Error sending reply', description: error.message })
```

### debugging:

We often encounter errors when not using zustand store correctly e.g.
do this const markDirty = useWorkflowStore((state) => state.markDirty)
instead of this: const {markDirty} = useWorkflowStore(). Which will cause many many re-renders!!!!

### **confirmations**: For delete confirmations use, the

```typescript
import { useConfirm } from '~/hooks/use-confirm'
const [confirm, ConfirmDialog] = useConfirm()
const confirmed = await confirm({
  title: 'TEXT?',
  description: 'TEXT',
  confirmText: 'Remove',
  cancelText: 'Cancel',
  destructive: true,
})

if (confirmed) {
  // do the deleting code
}
```

### **Buttons**: For disabling buttons while loading do this:

```typescript
<Button
  variant="outline"
  loading={isPending}
  loadingText="Connecting...">
  Connect
</Button>
```

### **Buttons**: Using icons in buttons. Do NOT add any className to the <Icon />.

```typescript
<Button
  variant="outline">
  <Icon /> // <!-- No h-4 w-4 added. Its handled by Button.
</Button>
```

### When to create new components

1. **If the tsx file exceeds 800 lines**
2. **If the ui is used more than once**
3. **If it has a clear single responsibility**

### Design patterns

Abstract patterns

```typescript
export interface Provider<I, O> {
  /** Unique id like "local" or "s3" */
  id: string

  /** Optional warm-up step (e.g., clients, keys) */
  init?(config?: unknown): Promise<void> | void

  /** Do the thing */
  execute(input: I): Promise<O> | O
}
```

Use of dynamic loaders:

```typescript
export const loaders = {
  local: async () => (await import('./local')).default, // => class LocalProvider
  s3: async () => (await import('./s3')).default, // => class S3Provider
} as const

export type ProviderId = keyof typeof loaders
```

Manager pattern:

```typescript
import { loaders, type ProviderId } from '../providers/manifest'
import type { Provider } from './types'
import type { LocalInput, LocalOutput } from '../providers/local'
import type { S3Input, S3Output } from '../providers/s3'

export type ManagerOptions = {
  config?: Partial<Record<ProviderId, unknown>>
}

export class ProviderManager {
  private cache = new Map<ProviderId, Provider<any, any>>()
  constructor(private opts: ManagerOptions = {}) {}

  private async get(id: ProviderId): Promise<Provider<any, any>> {
    let instance = this.cache.get(id)
    if (instance) return instance

    const Cls = await loaders[id]()
    instance = new Cls()
    if (typeof instance.init === 'function') {
      await instance.init(this.opts.config?.[id])
    }
    this.cache.set(id, instance)
    return instance
  }

  // ---- Overloads keep types nice but code simple ----
  async execute(id: 'local', input: LocalInput): Promise<LocalOutput>
  async execute(id: 's3', input: S3Input): Promise<S3Output>
  async execute(id: ProviderId, input: any): Promise<any> {
    const provider = await this.get(id)
    return provider.execute(input)
  }
}
```

## Performance Considerations

- Implement Redis caching for frequently accessed data
- Use optimistic updates with React Query where appropriate
- Implement proper data prefetching strategies
- Consider code splitting for larger components

## Project Structure

- Organize code by feature rather than by type
- Keep related files close together
- Implement a clear and consistent folder structure
- Create helper functions in dedicated utility files for reusability

## Documentation

- Document all API endpoints
- Add JSDoc comments to all exported functions, types, and interfaces
- Document database schema changes
- Keep README and documentation up to date

When implementing features, focus on solving the specific business problems of Auxx.ai: handling email support tickets, integrating with Shopify, and delivering AI-powered responses to customer inquiries.

## Common Development Commands

### Getting Started

````bash
# Install dependencies
pnpm install


### Build & Testing

- **DO NOT RUN ANY typescript tsc type checking EVER.**

```bash
# Type checking: Be specific with file. we have too many typescript errors. It will run out of memory!!
# Run tests
pnpm test
```

### Utility Commands

- **Do NOT build the program yourself to check for errors ever.**
- **Do NOT stop the dev server.**
