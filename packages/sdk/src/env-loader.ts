// packages/sdk/src/env-loader.ts
// Must be imported before any other modules to ensure .env
// variables are available when env.ts constants are evaluated.

import dotenv from 'dotenv'

dotenv.config()
