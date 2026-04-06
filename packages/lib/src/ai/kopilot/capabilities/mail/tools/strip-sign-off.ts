// packages/lib/src/ai/kopilot/capabilities/mail/tools/strip-sign-off.ts

/**
 * Closing phrases that LLMs add to email drafts.
 * Matched case-insensitively against trailing lines of the body.
 */
const CLOSING_PATTERNS = [
  /^(best|kind|warm)?\s*regards,?$/i,
  /^with (best |kind )?regards,?$/i,
  /^sincerely,?$/i,
  /^best,?$/i,
  /^thanks,?$/i,
  /^thank you,?$/i,
  /^thanks (again|so much),?$/i,
  /^many thanks,?$/i,
  /^cheers,?$/i,
  /^all the best,?$/i,
  /^take care,?$/i,
  /^yours truly,?$/i,
  /^respectfully,?$/i,
  /^cordially,?$/i,
  /^hope this helps,?$/i,

  // Bracketed placeholders — always safe to strip
  /^\[your\s*name\]$/i,
  /^\[name\]$/i,
  /^\[team\s*name\]$/i,
  /^\[your\s*team\]$/i,
]

/**
 * Name-like lines (1-3 capitalized words, no other content).
 * Only stripped when a closing phrase was already matched above them.
 * Catches "Markus", "The Auxx Team", "John Smith", etc.
 */
const NAME_PATTERNS = [/^[A-Z][a-z]+(\s[A-Z][a-z]+){0,2}$/]

/**
 * Strip trailing sign-off lines from AI-generated email body text.
 *
 * Works from the bottom up: removes blank lines, then checks each line
 * against known sign-off patterns. Stops as soon as a line doesn't match
 * (that's real content). Only counts non-blank lines toward the removal
 * limit to avoid edge cases with extra whitespace.
 */
export function stripSignOff(body: string): string {
  const lines = body.split('\n')

  // Trim trailing empty lines first
  while (lines.length > 0 && lines.at(-1)!.trim() === '') {
    lines.pop()
  }

  let removed = 0
  const maxRemove = 4
  let foundClosingPhrase = false

  while (lines.length > 0 && removed < maxRemove) {
    const lastLine = lines.at(-1)!.trim()

    // Skip empty lines between sign-off parts (don't count toward limit)
    if (lastLine === '') {
      lines.pop()
      continue
    }

    if (CLOSING_PATTERNS.some((p) => p.test(lastLine))) {
      lines.pop()
      removed++
      foundClosingPhrase = true
      continue
    }

    // Only strip name-like lines if we already matched a closing phrase
    if (foundClosingPhrase && NAME_PATTERNS.some((p) => p.test(lastLine))) {
      lines.pop()
      removed++
      continue
    }

    break
  }

  // Trim any trailing whitespace left over
  while (lines.length > 0 && lines.at(-1)!.trim() === '') {
    lines.pop()
  }

  return lines.join('\n')
}
