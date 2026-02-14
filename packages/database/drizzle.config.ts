// packages/database/drizzle.config.ts
import { type Config, defineConfig } from 'drizzle-kit'

import 'dotenv/config'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL || '', // Ensure DATABASE_URL is defined
  },
})
