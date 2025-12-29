# Workflow Type Mapping System

## Overview

The workflow system uses two separate type systems:

1. **Frontend Types**: Used in the UI/React Flow components (e.g., `'message-received'`, `'if-else'`, `'ai'`)
2. **Backend Types**: Used by the workflow execution engine (e.g., `'TRIGGER_MESSAGE_RECEIVED'`, `'CONDITION_IF'`, `'ACTION_EXECUTE'`)

## Type Mappings

| Frontend Type (NodeType) | Backend Type (WorkflowNodeType) | Description                                 |
| ------------------------ | ------------------------------- | ------------------------------------------- |
| `message-received`       | `TRIGGER_MESSAGE_RECEIVED`      | Workflow trigger when a message is received |
| `if-else`                | `CONDITION_IF`                  | Conditional branching node                  |
| `answer`                 | `ACTION_EXECUTE`                | Send answer/response action                 |
| `ai`                     | `ACTION_EXECUTE`                | AI completion action                        |
| `code`                   | `ACTION_TRANSFORM`              | Code transformation node                    |

## Implementation Details

### Node Type Mapper (`/apps/web/src/server/utils/node-type-mapper.ts`)

The mapper provides the following functions:

- `mapFrontendToBackendNodeType(frontendType)`: Converts frontend types to backend types
- `mapBackendToFrontendNodeType(backendType)`: Converts backend types to frontend types
- `transformNodeConfig(frontendType, config)`: Transforms node configuration for backend compatibility
- `validateNodeConfig(nodeType, config)`: Validates node configuration

### Workflow Execution Service

The workflow execution service automatically:

1. Maps frontend node types to backend types during workflow transformation
2. Transforms node configurations for backend compatibility
3. Validates node configurations before execution
4. Preserves original frontend types in metadata for consistency

### Custom Node Processors

Frontend-specific node processors are registered for:

- **AI Nodes**: Handles OpenAI completions
- **Answer Nodes**: Handles sending responses

These processors extend the base workflow engine capabilities to support frontend-specific functionality.

## Usage

When creating workflows in the UI:

1. Use frontend node types (e.g., `'ai'`, `'answer'`)
2. The server automatically maps these to backend types
3. Node configurations are transformed as needed
4. Original types are preserved for UI consistency

## Adding New Node Types

To add a new node type:

1. Add the frontend type to `/apps/web/src/components/workflow/types/node-types.ts`
2. Add the mapping in `/apps/web/src/server/utils/node-type-mapper.ts`
3. Create a processor if needed in `/apps/web/src/server/workflow-processors/`
4. Update the transformation and validation logic

## Testing

Run tests with:

```bash
pnpm test node-type-mapper
```

The test suite covers:

- Type mapping in both directions
- Configuration transformation
- Configuration validation
