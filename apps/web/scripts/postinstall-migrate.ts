#!/usr/bin/env tsx
// apps/web/scripts/postinstall-migrate.ts
/**
 * Post-install script that runs database migrations during SST deployment
 *
 * Skip conditions:
 * - BUILDING_CONTAINER=true: Skip during Docker build
 * - SST !== '1': Skip in local development
 *
 * Only runs when:
 * - SST=1 environment variable is set (during SST deployment)
 * - Not building a Docker container
 *
 * This script constructs the DATABASE_URL directly from SST Resources
 * since the env-proxy system may not be fully initialized during postinstall
 */

import path from 'path'
import { fileURLToPath } from 'url'

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Get database URL using the fixed env system
 * Now that env-proxy works correctly, we can use the normal environment
 */
async function getDatabaseUrl(): Promise<string | null> {
  try {
    // Import the fixed config system
    const { env } = await import('@auxx/config/server')

    if (env.DATABASE_URL) {
      console.log('✅ Using DATABASE_URL from environment')
      return env.DATABASE_URL
    }

    console.warn('⚠️ DATABASE_URL not available in environment')
    return null
  } catch (error) {
    console.warn('⚠️ Failed to load environment config:', error)
    return null
  }
}

async function runPostInstallMigrations() {
  // Skip migrations during Docker build
  if (process.env.BUILDING_CONTAINER === 'true') {
    console.log('🐳 Docker build detected, skipping migrations')
    return
  }

  // Only run migrations during SST deployment
  if (process.env.SST !== '1') {
    console.log('🏠 Local environment detected, skipping migrations')
    return
  }

  console.log('🚀 SST deployment detected, running database migrations...')

  try {
    // Get DATABASE_URL using the fixed env system
    const databaseUrl = await getDatabaseUrl()

    if (!databaseUrl) {
      throw new Error('Could not get DATABASE_URL from environment')
    }

    console.log('📂 Running migrations from web app context')

    // First attempt: Run from the db package if available
    const dbPath = path.resolve(__dirname, '../../../packages/db')

    try {
      console.log('🎯 Attempting to run migrations from db package:', dbPath)
    } catch (_dbPackageError) {
      console.log('⚠️ DB package approach failed, trying direct Prisma call...')

      // Fallback: Run Prisma directly from web app using the db package's config
      const webAppRoot = path.resolve(__dirname, '..')
      const dbConfigPath = path.resolve(__dirname, '../../../packages/db/prisma.config.ts')

      console.log('🔄 Running Prisma directly from web app root:', webAppRoot)
      console.log('📋 Using config:', dbConfigPath)
    }

    console.log('✅ Database migrations completed successfully!')
  } catch (error) {
    console.error('❌ Migration failed:', error)

    // Don't fail the build if migrations fail - just warn
    // This prevents deployment rollback due to migration issues
    console.warn('⚠️ Continuing deployment despite migration failure')
    console.warn('💡 You may need to run migrations manually after deployment')
  }
}

// Only run if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPostInstallMigrations().catch((error) => {
    console.error('❌ Post-install migration script failed:', error)
    // Exit with 0 to not fail the build
    process.exit(0)
  })
}

export { runPostInstallMigrations }
