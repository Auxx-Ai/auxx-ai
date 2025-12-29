# Workflow Node Constants

This module provides centralized constants for workflow nodes, ensuring consistency between frontend validation and backend processing.

## Usage

### Import Constants

```typescript
import { HTTP_NODE_CONSTANTS, AI_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'
```

### Using in Zod Schemas (Frontend)

```typescript
import { z } from 'zod'
import { HTTP_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'

const retryConfigSchema = z.object({
  max_retries: z
    .number()
    .min(HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.min)
    .max(HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.max)
    .default(HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.default),
})
```

### Using for Validation (Backend)

```typescript
import { HTTP_NODE_CONSTANTS } from '@auxx/lib/workflow-engine/constants'

function validateRetryCount(retries: number): boolean {
  return HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.validate(retries)
}

// Or clamp to valid range
const validRetries = HTTP_NODE_CONSTANTS.RETRY_CONFIG.MAX_RETRIES.clamp(userInput)
```

### Type-Safe Enums

```typescript
import type { HttpMethod, HttpAuthType } from '@auxx/lib/workflow-engine/constants'

interface RequestConfig {
  method: HttpMethod // 'GET' | 'POST' | 'PUT' | etc.
  authType: HttpAuthType // 'none' | 'basic' | 'bearer' | 'api-key'
}
```

## Available Constants

### HTTP Node (`HTTP_NODE_CONSTANTS`)

- **RETRY_CONFIG**: Max retries (1-10), retry interval (100-60000ms)
- **TIMEOUT**: Connection, response, and total timeouts
- **METHODS**: HTTP methods (GET, POST, PUT, DELETE, etc.)
- **BODY_TYPES**: Request body types
- **AUTH_TYPES**: Authentication types
- **HEADERS/QUERY_PARAMS**: Count and length limits

### AI Node (`AI_NODE_CONSTANTS`)

- **PROVIDERS**: OpenAI and Anthropic models
- **TEMPERATURE**: Range 0-2, default 0.7
- **MAX_TOKENS**: Token limits
- **TEXT_CLASSIFIER**: Category limits
- **INFO_EXTRACTOR**: Field limits and types

### Date-Time Node (`DATE_TIME_NODE_CONSTANTS`)

- **OPERATIONS**: Available date operations
- **TIME_UNITS**: Supported time units
- **DATE_FORMATS**: Predefined format strings
- **TIMEZONE_OPTIONS**: Timezone handling

## Validation Utilities

### Range Validator

```typescript
import { createRangeValidator } from '@auxx/lib/workflow-engine/constants'

const customRange = createRangeValidator({
  min: 0,
  max: 100,
  default: 50,
})

// Use the validator
if (customRange.validate(userInput)) {
  // Valid input
}

// Or clamp to range
const safeValue = customRange.clamp(userInput)
```

### Enum Validator

```typescript
import { createEnumValidator } from '@auxx/lib/workflow-engine/constants'

const statusValidator = createEnumValidator(['active', 'inactive', 'pending'] as const)

if (statusValidator.validate(userStatus)) {
  // Valid status
}
```

## Best Practices

1. **Always use constants for validation ranges** - Don't hardcode min/max values
2. **Use type exports for better type safety** - Import types like `HttpMethod` instead of strings
3. **Convert units when needed** - Constants store milliseconds, convert to seconds if needed
4. **Use validation helpers** - Leverage `validate()` and `clamp()` methods

## Adding New Constants

1. Add to appropriate file in `constants/nodes/`
2. Follow the existing pattern with `createRangeValidator`
3. Export types for enums
4. Update this README with new constants
