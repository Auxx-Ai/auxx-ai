// packages/seed/scripts/test-relational-seeding.ts
// Test script for multi-phase relational seeding

import { seed } from 'drizzle-seed'
import { database, schema } from '@auxx/database'
import { ScenarioBuilder } from '../src/scenarios/scenario-builder'
import type { SeedingScenarioName } from '../src/types'

/**
 * testRelationalSeeding demonstrates the multi-phase relational seeding approach.
 * This script tests foreign key relationships without using the invalid selectFromTable API.
 */
async function testRelationalSeeding() {
  console.log('🚀 Testing Multi-Phase Relational Seeding')

  try {
    // Create relational scenario
    const scenario = ScenarioBuilder.buildRelational('development')

    console.log('📋 Phase Overview:')
    const phaseDescriptions = ScenarioBuilder.getAllPhaseDescriptions()
    Object.entries(phaseDescriptions).forEach(([phase, description]) => {
      console.log(`  Phase ${phase}: ${description}`)
    })

    // Test Phase 1: Foundation Entities
    console.log('\n🌟 Testing Phase 1: Foundation Entities')
    await testPhase(scenario, 1)

    // Test Phase 2: Organization Foundation
    console.log('\n🏢 Testing Phase 2: Organization Foundation')
    await testPhase(scenario, 2)

    // Test Phase 3: Integration Layer
    console.log('\n🔗 Testing Phase 3: Integration Layer')
    await testPhase(scenario, 3)

    // Test Phase 4: Business Entities
    console.log('\n💼 Testing Phase 4: Business Entities')
    await testPhase(scenario, 4)

    // Test Phase 5: Analytics & Automation
    console.log('\n🤖 Testing Phase 5: Analytics & Automation')
    await testPhase(scenario, 5)

    console.log('\n🎉 Multi-phase relational seeding test completed successfully!')

    // Display final statistics
    console.log('\n📊 Final ID Pool Statistics:')
    const poolSizes = scenario.idPoolManager.getPoolSizes()
    Object.entries(poolSizes).forEach(([pool, size]) => {
      console.log(`  ${pool}: ${size} IDs`)
    })

  } catch (error) {
    console.error('❌ Multi-phase seeding test failed:', error)
    process.exit(1)
  }
}

/**
 * testPhase tests a single seeding phase with proper validation.
 * @param scenario - Relational seeding scenario
 * @param phase - Phase number to test
 */
async function testPhase(scenario: any, phase: 1 | 2 | 3 | 4 | 5) {
  try {
    // Validate phase prerequisites
    if (phase > 1) {
      ScenarioBuilder.validatePhaseOrder(phase, scenario.idPoolManager)
    }

    // Build phase refinements
    const refinements = scenario.buildPhaseRefinements(phase)
    console.log(`  ✅ Phase ${phase} refinements built successfully`)

    // Initialize ID pools for this phase
    switch (phase) {
      case 1:
        scenario.idPoolManager.generateUserIds()
        break
      case 2:
        scenario.idPoolManager.generateOrganizationIds()
        break
      case 3:
        scenario.idPoolManager.generateIntegrationIds()
        scenario.idPoolManager.generateTemplateIds()
        break
    }

    // Test the refinements by calling them with mock helpers
    const mockHelpers = {
      valuesFromArray: (args: any) => {
        console.log(`    Mock valuesFromArray called with ${args.values?.length || 0} values`)
        return { type: 'values_from_array', values: args.values }
      }
    }

    const result = refinements(mockHelpers)
    const tableNames = Object.keys(result)
    console.log(`  ✅ Phase ${phase} generated refinements for: ${tableNames.join(', ')}`)

    // Validate that foreign key references are properly set
    validateForeignKeyReferences(result, phase)

    console.log(`  ✅ Phase ${phase} validation completed`)

  } catch (error) {
    console.error(`  ❌ Phase ${phase} failed:`, error)
    throw error
  }
}

/**
 * validateForeignKeyReferences ensures that foreign key columns are properly configured.
 * @param refinements - Table refinements to validate
 * @param phase - Phase number for context
 */
function validateForeignKeyReferences(refinements: Record<string, any>, phase: number) {
  const expectedForeignKeys: Record<number, Record<string, string[]>> = {
    2: {
      Organization: ['createdById', 'systemUserId'],
      OrganizationSetting: ['organizationId']
    },
    3: {
      EmailIntegration: ['organizationId'],
      MessageTemplate: ['organizationId']
    },
    4: {
      Thread: ['organizationId', 'integrationId', 'assigneeId']
    },
    5: {
      AiUsage: ['organizationId', 'userId'],
      AutoResponseRule: ['organizationId', 'templateId']
    }
  }

  const expectedForPhase = expectedForeignKeys[phase]
  if (!expectedForPhase) {
    return // No validation needed for this phase
  }

  for (const [tableName, expectedColumns] of Object.entries(expectedForPhase)) {
    const tableRefinement = refinements[tableName]
    if (!tableRefinement) {
      console.warn(`    ⚠️  Table ${tableName} not found in refinements`)
      continue
    }

    const columns = tableRefinement.columns || {}
    for (const columnName of expectedColumns) {
      if (!columns[columnName]) {
        console.warn(`    ⚠️  Foreign key column ${columnName} not found in ${tableName}`)
      } else {
        console.log(`    ✅ Foreign key ${tableName}.${columnName} properly configured`)
      }
    }
  }
}

/**
 * demonstrateIdDistribution shows how IDs are distributed across entities.
 * @param scenario - Relational seeding scenario
 */
function demonstrateIdDistribution(scenario: any) {
  console.log('\n📊 ID Distribution Demonstration:')

  // Show User ID distribution
  const userIds = scenario.idPoolManager.getUserIds()
  console.log(`User IDs (${userIds.length}):`, userIds.slice(0, 3).join(', '), '...')

  // Show Organization ID distribution
  const orgIds = scenario.idPoolManager.getOrganizationIds()
  console.log(`Organization IDs (${orgIds.length}):`, orgIds.slice(0, 3).join(', '), '...')

  // Show distributed organization IDs for 10 entities
  const distributedOrgIds = scenario.idPoolManager.generateDistributedOrganizationIds(10)
  console.log(`Distributed Org IDs (80/20 pattern):`, distributedOrgIds.slice(0, 5).join(', '), '...')

  // Show distributed user IDs for 10 entities
  const distributedUserIds = scenario.idPoolManager.generateDistributedUserIds(10)
  console.log(`Distributed User IDs:`, distributedUserIds.slice(0, 5).join(', '), '...')
}

/**
 * runLiveSeeding actually executes the seeding against the database.
 * Only run this when you're ready to test with real database operations.
 */
async function runLiveSeeding() {
  console.log('⚠️  Running LIVE seeding against database')

  const scenario = ScenarioBuilder.buildRelational('development')

  // Run Phase 1 only for initial testing
  console.log('🌟 Running Phase 1: Foundation Entities')
  const phase1Refinements = scenario.buildPhaseRefinements(1)

  try {
    await seed(database, schema).refine(phase1Refinements)
    console.log('✅ Phase 1 seeding completed successfully')
  } catch (error) {
    console.error('❌ Phase 1 seeding failed:', error)
    throw error
  }
}

// Main execution
const args = process.argv.slice(2)
const runLive = args.includes('--live')

if (runLive) {
  runLiveSeeding().catch(error => {
    console.error('Live seeding failed:', error)
    process.exit(1)
  })
} else {
  testRelationalSeeding().catch(error => {
    console.error('Test failed:', error)
    process.exit(1)
  })
}

export { testRelationalSeeding, runLiveSeeding }