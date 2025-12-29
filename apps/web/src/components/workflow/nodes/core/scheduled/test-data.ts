// apps/web/src/components/workflow/nodes/core/scheduled/test-data.ts

import { ScheduledTriggerNodeData } from './types'

/**
 * Generate mock data for scheduled trigger testing
 */
export function generateScheduledTriggerTestData(nodeData: ScheduledTriggerNodeData) {
  const now = new Date()
  const { config } = nodeData

  // Generate test data based on the schedule configuration
  const testData: Record<string, any> = {
    triggered_at: now.toISOString(),
  }

  if (config.triggerInterval === 'custom') {
    // For custom cron schedules
    testData.schedule_type = 'cron'
    testData.cron_expression = config.customCron || '0 * * * *'
  } else {
    // For interval-based schedules
    testData.schedule_type = 'interval'
    testData.interval_config = {
      value: config.timeBetweenTriggers[config.triggerInterval] || 1,
      unit: config.triggerInterval,
    }
  }

  // Add timezone information if configured
  if (config.timezone) {
    testData.timezone = config.timezone
    testData.local_time = now.toLocaleString('en-US', {
      timeZone: config.timezone,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    })
  }

  // Add schedule description for context
  testData.schedule_description = getScheduleDescription(config)

  // Add next execution time estimates (for display purposes)
  if (config.triggerInterval !== 'custom') {
    const nextExecution = calculateNextExecution(config)
    if (nextExecution) {
      testData.next_execution = nextExecution.toISOString()
      testData.next_execution_local = config.timezone
        ? nextExecution.toLocaleString('en-US', { timeZone: config.timezone })
        : nextExecution.toLocaleString()
    }
  }

  return testData
}

/**
 * Get human-readable schedule description
 */
function getScheduleDescription(config: ScheduledTriggerNodeData['config']): string {
  if (config.triggerInterval === 'custom') {
    return config.customCron ? `Custom cron: ${config.customCron}` : 'Custom cron expression'
  }

  const value = config.timeBetweenTriggers[config.triggerInterval]
  if (!value) return 'Invalid configuration'

  const unit = config.triggerInterval
  const unitDisplay = value === 1 ? unit.slice(0, -1) : unit

  return `Every ${value} ${unitDisplay}`
}

/**
 * Calculate next execution time for interval-based schedules
 */
function calculateNextExecution(config: ScheduledTriggerNodeData['config']): Date | null {
  if (config.triggerInterval === 'custom') return null

  const value = config.timeBetweenTriggers[config.triggerInterval]
  if (!value) return null

  const now = new Date()
  let intervalMs: number

  switch (config.triggerInterval) {
    case 'minutes':
      intervalMs = value * 60 * 1000
      break
    case 'hours':
      intervalMs = value * 60 * 60 * 1000
      break
    case 'days':
      intervalMs = value * 24 * 60 * 60 * 1000
      break
    case 'weeks':
      intervalMs = value * 7 * 24 * 60 * 60 * 1000
      break
    default:
      return null
  }

  return new Date(now.getTime() + intervalMs)
}

/**
 * Generate sample inputs for testing (empty since scheduled triggers don't take inputs)
 */
export function generateScheduledTriggerInputs(): Record<string, any> {
  return {
    // Scheduled triggers don't have input variables
    // They generate their own output based on timing
  }
}

/**
 * Get test scenario descriptions for different schedule types
 */
export function getScheduledTriggerTestScenarios(nodeData: ScheduledTriggerNodeData) {
  const scenarios = []

  scenarios.push({
    name: 'Current Execution',
    description: 'Simulates the scheduled trigger executing right now',
    data: generateScheduledTriggerTestData(nodeData),
  })

  // Add scenario for different times of day if relevant
  if (nodeData.config.triggerInterval === 'custom' && nodeData.config.customCron) {
    const cron = nodeData.config.customCron
    if (cron.includes('9') || cron.includes('18')) {
      scenarios.push({
        name: 'Business Hours',
        description: 'Simulates execution during typical business hours',
        data: {
          ...generateScheduledTriggerTestData(nodeData),
          triggered_at: new Date(
            Date.now() - (Date.now() % (24 * 60 * 60 * 1000)) + 9 * 60 * 60 * 1000
          ).toISOString(),
          execution_context: 'business_hours',
        },
      })
    }
  }

  // Add weekend scenario for weekly schedules
  if (nodeData.config.triggerInterval === 'weeks') {
    const weekendDate = new Date()
    weekendDate.setDate(weekendDate.getDate() - weekendDate.getDay()) // Sunday
    scenarios.push({
      name: 'Weekend Execution',
      description: 'Simulates execution on a weekend',
      data: {
        ...generateScheduledTriggerTestData(nodeData),
        triggered_at: weekendDate.toISOString(),
        execution_context: 'weekend',
      },
    })
  }

  return scenarios
}
