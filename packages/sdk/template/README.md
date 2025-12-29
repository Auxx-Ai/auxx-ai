# title-to-be-replaced

> description-to-be-replaced

## Auxx App: slug-to-be-replaced

App ID: `id-to-be-replaced`

## Getting Started

### Install Dependencies

```bash
pnpm install
```

### Development Mode

Start the development server with hot reload:

```bash
pnpm run dev
```

This will:
- Watch for file changes
- Validate TypeScript
- Bundle your code
- Enable hot reload in Auxx platform

### Build for Production

```bash
pnpm run build
```

### Formatting

```bash
pnpm run format
```

## Project Structure

```
slug-to-be-replaced/
├── src/
│   ├── app.tsx                   # Main app entry point with surfaces and App component
│   ├── hello-world-action.tsx    # Example record action
│   ├── hello-world-dialog.tsx    # Example dialog component
│   ├── test-user.tsx             # Example component with async data
│   ├── get-user.server.ts        # Example server-side function
│   └── assets/                   # Static assets (images, etc.)
├── .auxx/                        # Build output (gitignored)
├── package.json
├── tsconfig.json
├── .gitignore
└── README.md
```

## Key Concepts

### App Configuration

Your extension is defined in `src/app.tsx`, which exports two things:

1. **`app` object**: Defines all the surfaces (actions, widgets, etc.) your extension provides
2. **`App` component**: The main UI component that renders in certain contexts

Example structure:

```typescript
// src/app.tsx
import { recordAction } from './hello-world-action'

export const app = {
  record: {
    actions: [recordAction],      // Actions that appear on records
    bulkActions: [],               // Actions for multiple records
    widgets: [],                   // Custom widgets to display
  },
  workflow: {
    blocks: {
      steps: [],                   // Custom workflow steps
      triggers: [],                // Custom workflow triggers
    }
  },
  // ... more surface types
}

export function App() {
  return <div>Your extension UI</div>
}
```

### Surfaces

Surfaces are extension points where your code adds functionality to Auxx:

#### Record Actions

Buttons that appear in the record detail view:

```typescript
import type { RecordAction } from '@auxx/sdk/client'

export const recordAction: RecordAction = {
  id: 'my-extension-action',     // Must be unique
  label: 'My Action',             // User-facing text
  icon: 'zap',                    // Optional icon
  onTrigger: async ({ recordId }) => {
    // Your code here
  }
}
```

**Important**: You only need to define `id`, `label`, and `onTrigger`. The build process automatically adds:
- `type: 'record-action'`
- `location: 'record-detail-page'`

#### Other Surface Types

- **Bulk Actions**: Actions on multiple selected records
- **Widgets**: Custom UI components embedded in pages
- **Workflow Blocks**: Custom workflow steps and triggers
- **Call Recording Actions**: Text selection actions for call analysis
- **Workspace Settings**: Configuration pages

### App Component

The `App` component is your extension's main UI. It's displayed when:
- Users view your extension's settings page
- The platform needs to render your extension's interface

```typescript
export function App() {
  return (
    <div>
      <h1>My Extension</h1>
      <p>Configuration and status information goes here</p>
    </div>
  )
}
```

### Build Process

The build process automatically:

1. **Finds your app.tsx**: Looks for `src/app.tsx` or `src/app.ts`
2. **Extracts surfaces**: Reads the `app` object and organizes surfaces by type
3. **Adds required fields**: Automatically adds `type` and `location` to each surface
4. **Bundles code**: Creates an optimized bundle with React externalized
5. **Exports App component**: Makes `window.App` available to the platform runtime

You don't need to worry about these details - just define your surfaces in the `app` object!

## Documentation

- [Auxx SDK Documentation](https://docs.auxx.ai)
- [API Reference](https://docs.auxx.ai/api)
- [Examples](https://docs.auxx.ai/examples)

## Support

- [Discord Community](https://discord.gg/auxx)
- [GitHub Issues](https://github.com/auxx-ai/sdk/issues)
- [Email Support](mailto:support@auxx.ai)
