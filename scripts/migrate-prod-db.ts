#!/usr/bin/env tsx

// scripts/migrate-prod-db.ts

/**
 * Script to run Prisma migrations against the production database
 * This script uses SST Resource access to get the correct DATABASE_URL
 */

import { execSync } from 'child_process'
import path from 'path'
import { Resource } from 'sst'

async function migrateProdDatabase() {
  try {
    console.log('🔍 Accessing SST resources...')

    // Get the database connection details from SST Resources
    const rdsResource = (Resource as any).AuxxAiRds

    if (!rdsResource) {
      throw new Error('Could not access AuxxAiRds resource from SST')
    }

    // Construct the database URL from RDS resource properties
    const databaseUrl = `postgresql://${rdsResource.username}:${rdsResource.password}@${rdsResource.host}:${rdsResource.port}/${rdsResource.database}`

    console.log('RDS Resource found:', {
      host: rdsResource.host,
      database: rdsResource.database,
      username: rdsResource.username,
      port: rdsResource.port,
    })

    console.log('✅ Database connection found')
    console.log('🚀 Running Prisma migrations...')

    // Set the DATABASE_URL environment variable and run migrations
    const env = {
      ...process.env,
      DATABASE_URL: databaseUrl,
    }

    // Change to the db package directory
    const dbPackagePath = path.join(process.cwd(), 'packages/db')

    // Run the migration deployment
    execSync('pnpm run db:migrate:deploy', {
      cwd: dbPackagePath,
      env,
      stdio: 'inherit',
    })

    console.log('✅ Migrations completed successfully!')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    process.exit(1)
  }
}

// Run the migration
migrateProdDatabase()
