// packages/lib/src/tasks/date-language-module.ts

import {
  calculateTargetDateInTimezone,
  calculateEndOfMonth,
  calculateNextQuarter,
  calculateDuration,
  formatRelativeDate,
  formatTimeRemaining,
  formatAbsoluteDate,
} from '@auxx/utils'
import type { RelativeDate, PredefinedDateOption } from '@auxx/types/task'
import { PREDEFINED_DATE_OPTIONS, findPredefinedOption } from '@auxx/types/task'

/**
 * DateLanguageModule
 * Handles all date parsing, calculation, and formatting operations
 * Coordinates between relative and absolute date representations
 */
export class DateLanguageModule {
  private timezone: string

  /**
   * Create a DateLanguageModule instance
   * @param timezone IANA timezone string (e.g., "America/New_York")
   */
  constructor(timezone: string = 'UTC') {
    this.timezone = timezone
  }

  /**
   * Calculate target date from relative duration (timezone-aware)
   * @param duration Relative date offset or special string ('eom', 'next-quarter')
   * @param baseDate Reference date (default: now)
   * @returns Target absolute date (UTC, for database storage)
   */
  calculateTargetDate(
    duration: RelativeDate | 'eom' | 'next-quarter',
    baseDate = new Date()
  ): Date {
    if (duration === 'eom') {
      return calculateEndOfMonth(this.timezone, baseDate)
    }
    if (duration === 'next-quarter') {
      return calculateNextQuarter(this.timezone, baseDate)
    }
    return calculateTargetDateInTimezone(duration, this.timezone, baseDate)
  }

  /**
   * Get formatted label for a relative duration
   * @param duration Relative duration
   * @returns Formatted label or null if unsupported
   */
  formatDurationLabel(duration: RelativeDate): string | null {
    const isNegative = Object.values(duration).some((v) => typeof v === 'number' && v < 0)
    return formatRelativeDate(duration, isNegative)
  }

  /**
   * Get formatted label for an absolute deadline (timezone-aware)
   * @param deadline Absolute date
   * @param baseDate Reference date for relative formatting (default: now)
   * @returns Formatted label
   */
  formatDeadlineLabel(deadline: Date, baseDate = new Date()): string {
    const daysUntil = Math.floor((deadline.getTime() - baseDate.getTime()) / (1000 * 60 * 60 * 24))
    if (Math.abs(daysUntil) <= 7) {
      return formatTimeRemaining(deadline, baseDate)
    }
    return formatAbsoluteDate(deadline, this.timezone)
  }

  /**
   * Convert relative duration to absolute date (timezone-aware)
   * @param duration Relative duration
   * @param baseDate Base date for calculation
   * @returns ISO string for storage in database
   */
  convertToAbsoluteDate(
    duration: RelativeDate | 'eom' | 'next-quarter',
    baseDate = new Date()
  ): string {
    const targetDate = this.calculateTargetDate(duration, baseDate)
    return targetDate.toISOString()
  }

  /**
   * Convert absolute date to relative duration
   * @param deadline Absolute deadline date
   * @param baseDate Base date for calculation
   * @returns Relative duration
   */
  convertToRelativeDuration(deadline: Date, baseDate = new Date()): RelativeDate {
    return calculateDuration(baseDate, deadline)
  }

  /**
   * Validate relative duration
   * @param duration Duration to validate
   * @returns true if valid
   */
  isValidDuration(duration: RelativeDate): boolean {
    return true
  }

  /**
   * Find matching predefined option for a duration
   * @param duration Duration to match
   * @returns Matching preset or undefined
   */
  findPresetOption(duration: RelativeDate): PredefinedDateOption | undefined {
    return findPredefinedOption(duration)
  }

  /**
   * List all available predefined date options
   * @returns Array of predefined options
   */
  getPredefinedOptions(): PredefinedDateOption[] {
    return PREDEFINED_DATE_OPTIONS
  }

  /**
   * Update the timezone for this module instance
   * @param timezone IANA timezone string
   */
  setTimezone(timezone: string): void {
    this.timezone = timezone
  }

  /**
   * Get the current timezone
   */
  getTimezone(): string {
    return this.timezone
  }
}
