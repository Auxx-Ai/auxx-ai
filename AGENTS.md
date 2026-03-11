# Repository Guidelines

This monorepo uses pnpm workspaces and Turborepo to manage multiple TypeScript apps and packages. Follow these concise guidelines to keep contributions consistent and easy to review.

## Project Structure & Module Organization

- apps/: Next.js and Node services (e.g., `apps/web`, `apps/admin`, `apps/kb`, `apps/docs`, `apps/api`, `apps/websockets`, `apps/worker`).
- packages/: Shared code (e.g., `packages/db` Prisma schema + client, `packages/lib`, `packages/ui`, `packages/config`, `packages/eslint-config`, `packages/typescript-config`).
- infra-cdk/, infra/: Infrastructure definitions and scripts.
- scripts/: Utility scripts (env, setup, migrations). docs/: Additional project docs.
- Env files: `.env.example` → copy to `.env` per app/service as needed.
- Zod 4 is used which deprecated nativeEnum. now its just z.enum

## Build, Test, and Development Commands

- Install: `pnpm i` (Node 22; see `.nvmrc`).
- Develop (all): `pnpm dev` (Turbo parallel dev).
- Build (all): `pnpm build`; Start (all): `pnpm start`.
- Lint/Format: `pnpm lint`, `pnpm lint:fix`, `pnpm format`.
- Test (workspace): `pnpm test`, `pnpm test:run`, `pnpm test:coverage`.
- Filter per app: `pnpm -F web dev`, `pnpm -F api build`, `pnpm -F worker start`.
- Docker (optional): `pnpm docker:dev`, `pnpm docker:stop`. S3/CDN dev setup: `pnpm setup:dev`.

## Coding Style & Naming Conventions

- Language: TypeScript across apps/packages. Paths under `src/`.
- Formatting: Prettier enforced (2 spaces, single quotes, no semicolons). Run `pnpm format`.
- Linting: ESLint via shared configs in `packages/eslint-config` (+ Next.js rules where relevant).
- Filenames: kebab-case for files/dirs; React component identifiers use PascalCase.
- Create reusable and modular components
- Break large components into smaller ones for better maintainability
- File naming: use kebab-case for files (e.g., `user-profile.tsx`)
- At the top of each file, comment the file-path/file-name.file_type
- Add `'use client'` directive for any components using client-side hooks or state
- Comment every function, interface, type, and global variable

## Testing Guidelines

- Runner: Vitest with a workspace config (`vitest.workspace.ts`).
- Web app uses JSDOM and Testing Library; libs/packages use Node environment.
- Naming: `*.test.ts(x)` or `*.spec.ts(x)` under `src/` or `__tests__/`.
- Coverage: thresholds enforced in configs (e.g., web ≥70%, lib/workflow-nodes ≥75%). Use `pnpm test:coverage`.

## Commit & Pull Request Guidelines

- Commits: follow Conventional Commits (`feat:`, `fix:`, `refactor:`, optional scopes).
- Before PR: `pnpm lint && pnpm test:run && pnpm build` must pass; include migration notes for `packages/db/prisma` changes.
- PRs: clear description, linked issues, screenshots/GIFs for UI, and notes for env/infra impacts.

## Security & Configuration Tips

- Do not commit secrets. Use `.env` (see `.env.example`) and `scripts/fetch-env.ts` for environment sync.
- AWS/S3/CDN: see `.aws.md` and `scripts/setup-*.js`. Keep keys in your local env/SSM, not VCS.

## Utility Methods

**IMPORTANT**: Before creating any utility functions, check `packages/lib/src/utils` for existing helpers:

- **date.ts** - Date formatting and relative time
- **email.ts** - Email parsing, validation, and formatting
- **file.ts** - File operations and path utilities
- **generateId.ts** - Unique ID generation
- **strings.ts** - String manipulation (titleize, pluralize, whitespace)
- **contact.ts** - Name, phone, and address formatting

## UI Components

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

## Railway CLI (production)

The project is linked to Railway via `railway link`. The `.railway` config file is gitignored.

**Workspace:** Auxx.Ai's Projects | **Project:** Auxx Ai | **Environment:** production

**Services:** web, api, worker, build, lambda-server, homepage, docs, Postgres, pgvector, Redis

```bash
# List all projects
railway list

# Show all services and their deployment status
railway service status -a --json

# View variables for a specific service
railway variables -s <service-name> --json

# View logs for a specific service
railway service logs -s <service-name>

# Redeploy a service
railway service redeploy -s <service-name>
```

---
