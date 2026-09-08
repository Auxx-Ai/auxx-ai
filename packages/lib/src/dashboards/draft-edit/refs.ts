// packages/lib/src/dashboards/draft-edit/refs.ts

/**
 * Widget and tab reference resolution, pure and browser-safe. The dashboard
 * twin of `workflows/graph-edit/refs.ts`, and it exists for the same reason: a
 * model that has to round-trip a generated id spends tokens and gets them
 * wrong, while a title is what the user actually says out loud.
 *
 * Resolution order, tried in turn and stopping at the first stage that yields
 * exactly one candidate:
 *
 * 1. **Exact title.**
 * 2. **Case-insensitive title**, because a model reliably reproduces the words
 *    and unreliably reproduces the capitalisation.
 * 3. **Unique title prefix**, so "Revenue" reaches "Revenue by month" without
 *    the model having to quote the whole label back.
 * 4. **Raw id**, so a tool result can be fed straight back in unmodified.
 *
 * Two or more candidates at any stage is an ERROR listing every candidate with
 * its id, never a guess: the canvas does not enforce title uniqueness, so
 * ambiguity is a common path rather than an edge case. A miss comes back with
 * {@link closestMatches} attached, both in the message and in `details`, so the
 * caller can retry without a second read.
 *
 * No db, no permission checks (house rule).
 */

import { err, ok, type Result } from 'neverthrow'
import { type AuxxError, BadRequestError, NotFoundError } from '../../errors'
import type { DashboardLayoutDoc, LayoutTab, LayoutWidget } from '../client'

/** Which resolution stage produced the match. Useful for phrasing a reply. */
export type RefMatchKind = 'title' | 'title-ci' | 'prefix' | 'id'

/** A widget plus the tab it lives on, which the caller almost always needs next. */
export interface ResolvedWidgetRef {
  widget: LayoutWidget
  tab: LayoutTab
  matchedBy: RefMatchKind
}

export interface ResolvedTabRef {
  tab: LayoutTab
  matchedBy: RefMatchKind
}

/** A widget paired with its owning tab. The doc's flat view. */
export interface WidgetWithTab {
  widget: LayoutWidget
  tab: LayoutTab
}

/** Every widget in the doc, in document order, each with its tab. */
export function allWidgets(doc: DashboardLayoutDoc): WidgetWithTab[] {
  return doc.tabs.flatMap((tab) => tab.widgets.map((widget) => ({ widget, tab })))
}

/** `"Title" (id)`: the candidate format every ambiguity / not-found error uses. */
export function describeTarget(target: { id: string; title: string }): string {
  return target.title ? `"${target.title}" (${target.id})` : `(${target.id})`
}

/** Levenshtein edit distance. Small inputs only (titles). */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1
  const cols = b.length + 1
  const dist: number[] = Array.from({ length: cols }, (_, j) => j)
  for (let i = 1; i < rows; i++) {
    let prevDiagonal = dist[0]!
    dist[0] = i
    for (let j = 1; j < cols; j++) {
      const current = dist[j]!
      dist[j] = Math.min(
        current + 1,
        dist[j - 1]! + 1,
        prevDiagonal + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
      prevDiagonal = current
    }
  }
  return dist[cols - 1]!
}

/**
 * The candidates closest to `input` by case-insensitive edit distance, nearest
 * first. Only near misses qualify (distance <= max(2, floor(len/3))): a "did
 * you mean" that suggests something unrelated is worse than none at all.
 */
export function closestMatches(input: string, candidates: string[], limit = 3): string[] {
  const needle = input.toLowerCase()
  const maxDistance = Math.max(2, Math.floor(needle.length / 3))
  return candidates
    .map((candidate) => ({ candidate, distance: editDistance(needle, candidate.toLowerCase()) }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ candidate }) => candidate)
}

/** The generic shape both resolvers walk: anything with an id and a title. */
interface RefTarget {
  id: string
  title: string
}

function ambiguityError(noun: string, ref: string, matches: RefTarget[]): AuxxError {
  return new BadRequestError(
    `${noun} reference "${ref}" is ambiguous: ${matches.length} ${noun.toLowerCase()}s match ` +
      `(${matches.map(describeTarget).join(', ')}). Use the id instead.`,
    { candidates: matches.map((m) => m.id) }
  )
}

function notFoundError(noun: string, ref: string, targets: RefTarget[]): AuxxError {
  const titles = targets.map((t) => t.title).filter((t) => t !== '')
  const near = closestMatches(ref, titles)
  const shown = near.length > 0 ? near : titles.slice(0, 10)
  const hint =
    shown.length === 0
      ? ` The dashboard has no ${noun.toLowerCase()}s.`
      : near.length > 0
        ? ` Did you mean ${shown.map((t) => `"${t}"`).join(' or ')}?`
        : ` Available: ${shown.map((t) => `"${t}"`).join(', ')}.`
  return new NotFoundError(`No ${noun.toLowerCase()} matches "${ref}".${hint}`, {
    closestMatches: near,
  })
}

/**
 * The shared four-stage walk. Returns the single match and how it was found, or
 * a typed refusal. Exported only through the two wrappers below.
 */
function resolve<T extends RefTarget>(
  noun: string,
  targets: T[],
  ref: string
): Result<{ target: T; matchedBy: RefMatchKind }, AuxxError> {
  const trimmed = ref.trim()
  if (!trimmed) return err(new BadRequestError(`${noun} reference is empty`))

  const exact = targets.filter((t) => t.title === trimmed)
  if (exact.length === 1) return ok({ target: exact[0]!, matchedBy: 'title' })
  if (exact.length > 1) return err(ambiguityError(noun, trimmed, exact))

  const needle = trimmed.toLowerCase()
  const insensitive = targets.filter((t) => t.title.toLowerCase() === needle)
  if (insensitive.length === 1) return ok({ target: insensitive[0]!, matchedBy: 'title-ci' })
  if (insensitive.length > 1) return err(ambiguityError(noun, trimmed, insensitive))

  const byId = targets.find((t) => t.id === trimmed)

  const prefixed = targets.filter((t) => t.title.toLowerCase().startsWith(needle))
  if (prefixed.length === 1) return ok({ target: prefixed[0]!, matchedBy: 'prefix' })
  // An exact id beats an ambiguous prefix: it is the one form that cannot be
  // misread, and refusing it would make a tool result unusable as an input.
  if (byId) return ok({ target: byId, matchedBy: 'id' })
  if (prefixed.length > 1) return err(ambiguityError(noun, trimmed, prefixed))

  return err(notFoundError(noun, trimmed, targets))
}

/**
 * Resolve a model-supplied string to one widget anywhere in the doc, plus the
 * tab it sits on. See the file docblock for the order and the refusals.
 */
export function resolveWidgetRef(
  doc: DashboardLayoutDoc,
  ref: string
): Result<ResolvedWidgetRef, AuxxError> {
  const pairs = allWidgets(doc)
  const resolved = resolve('Widget', pairs.map(toWidgetTarget), ref)
  if (resolved.isErr()) return err(resolved.error)
  const pair = pairs[resolved.value.target.index]!
  return ok({ widget: pair.widget, tab: pair.tab, matchedBy: resolved.value.matchedBy })
}

/** Index-carrying projection so the resolver can hand back the original pair. */
function toWidgetTarget(pair: WidgetWithTab, index: number): RefTarget & { index: number } {
  return { id: pair.widget.id, title: pair.widget.title, index }
}

/** Resolve a model-supplied string to one tab. */
export function resolveTabRef(
  doc: DashboardLayoutDoc,
  ref: string
): Result<ResolvedTabRef, AuxxError> {
  const resolved = resolve('Tab', doc.tabs, ref)
  if (resolved.isErr()) return err(resolved.error)
  return ok({ tab: resolved.value.target, matchedBy: resolved.value.matchedBy })
}

/**
 * Render a widget id as the ref the model should see: the title when it is
 * unique in the doc (case-insensitively), the raw id otherwise. A duplicated
 * title would round-trip straight back into an ambiguity error, so the id is
 * the only honest rendering. Unknown ids pass through unchanged.
 */
export function formatWidgetRef(doc: DashboardLayoutDoc, widgetId: string): string {
  const pairs = allWidgets(doc)
  const match = pairs.find((p) => p.widget.id === widgetId)
  if (!match) return widgetId
  const title = match.widget.title
  if (!title) return widgetId
  const needle = title.toLowerCase()
  const sharing = pairs.filter((p) => p.widget.title.toLowerCase() === needle)
  return sharing.length === 1 ? title : widgetId
}

/** {@link formatWidgetRef} for tabs. */
export function formatTabRef(doc: DashboardLayoutDoc, tabId: string): string {
  const tab = doc.tabs.find((t) => t.id === tabId)
  if (!tab?.title) return tabId
  const needle = tab.title.toLowerCase()
  const sharing = doc.tabs.filter((t) => t.title.toLowerCase() === needle)
  return sharing.length === 1 ? tab.title : tabId
}
