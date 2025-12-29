// packages/seed/src/utils/progress-tracker.ts
// Spinner-based progress helper for CLI feedback during seeding

import ora, { type Ora } from 'ora'

/** ProgressTracker wraps an Ora spinner respecting the CLI progress flag. */
export class ProgressTracker {
  /** spinner holds the underlying Ora instance when enabled. */
  private spinner: Ora | null = null
  /** enabled determines whether progress output is active. */
  private readonly enabled: boolean

  /**
   * Creates a new tracker instance.
   * @param enabled - When false the tracker becomes a no-op.
   */
  constructor(enabled: boolean) {
    this.enabled = enabled
  }

  /**
   * start begins the spinner with the provided text.
   * @param text - Message to display while the spinner is active.
   */
  start(text: string): void {
    if (!this.enabled) return
    this.spinner = ora(text).start()
  }

  /**
   * succeed marks the spinner as successful and optionally updates the message.
   * @param text - Optional success message.
   */
  succeed(text?: string): void {
    if (!this.enabled || !this.spinner) return
    this.spinner.succeed(text)
    this.spinner = null
  }

  /**
   * fail marks the spinner as failed with an optional failure message.
   * @param text - Optional failure message.
   */
  fail(text?: string): void {
    if (!this.enabled || !this.spinner) return
    this.spinner.fail(text)
    this.spinner = null
  }

  /**
   * info logs an informational message without affecting spinner lifecycle.
   * @param text - Message to output alongside the spinner.
   */
  info(text: string): void {
    if (!this.enabled) return
    if (this.spinner) {
      this.spinner.info(text)
    } else {
      ora(text).info(text)
    }
  }
}
