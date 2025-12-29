# @auxx/sdk

> ⚠️ This package is experimental and not yet ready for production use.

CLI tool and SDK for creating Auxx apps. Build custom integrations, workflows, and UI extensions for the Auxx platform.

## Installation

```bash
# Install globally
npm install -g @auxx/sdk

# Or use with npx
npx @auxx/sdk
```

## Quick Start

```bash
# Create a new app
auxx init my-app

# Start development mode
cd my-app
auxx dev

# Build for production
auxx build
```

## Commands

### `auxx init <app-slug>`
Initialize a new Auxx app project with the specified slug.

### `auxx dev [--workspace <slug>]`
Start development mode with hot reload. Optionally specify a workspace for testing.

### `auxx build`
Build your app for production deployment.

### `auxx login`
Authenticate with your Auxx developer account.

### `auxx logout`
Log out and remove stored credentials.

### `auxx whoami`
Display information about the currently authenticated user.

### `auxx logs`
Stream real-time logs from your running app.

### `auxx version`
Manage app version lifecycle (create, promote, etc.).

## Package Exports

The SDK provides multiple entry points for different use cases:

```typescript
// Client-side SDK (React components, hooks)
import { useWorkflow, Form, Button } from '@auxx/sdk/client';

// Server-side SDK (workflow execution, API access)
import { WorkflowContext } from '@auxx/sdk/server';

// Type definitions
import type { AppManifest } from '@auxx/sdk/global';
```

## Development

This package is part of the Auxx monorepo and uses pnpm workspaces.

```bash
# Install dependencies
pnpm install

# Build the SDK
pnpm --filter @auxx/sdk run build

# Watch mode for development
pnpm --filter @auxx/sdk run dev

# Run tests
pnpm --filter @auxx/sdk run test

# Lint code
pnpm --filter @auxx/sdk run lint
```

## License

MIT
