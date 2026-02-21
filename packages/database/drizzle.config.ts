// packages/database/drizzle.config.ts
import { defineConfig } from 'drizzle-kit'
import { ensureDatabaseEnv } from './scripts/load-database-env'

/** Loads DATABASE_URL from process env, then root .env, then derived local fallback. */
ensureDatabaseEnv()

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/*.ts',
  out: './drizzle',
  dbCredentials: {
    url: process.env.DATABASE_URL || '', // Ensure DATABASE_URL is defined
  },
})
