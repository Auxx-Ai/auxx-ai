// apps/extension/src/lib/parsers/gmail.ts

import { textOf } from '../dom'
import { gmailExternalId } from '../external-id'
import { EMPTY_PARSE_RESULT, type ParsedPerson, type ParseResult } from './types'

/**
 * Gmail parser — auto-detects between an open thread and a compose window.
 *
 * We deliberately drop the "phones-arrays / interactions / attached-company"
 * fields in v1 and only surface the minimum the iframe needs to create a
 * Contact record.
 */

function splitName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { firstName: parts[0] }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

function isLikelyAvatar(url: string | null | undefined): boolean {
  if (!url || !url.startsWith('http')) return false
  if (url.includes('googleusercontent.com/cm/')) return false // default avatar grid
  if (url.includes('default-user')) return false
  return true
}

function elementToPerson(el: Element, _self: string | null): ParsedPerson | null {
  const email = el.getAttribute('jid') ?? el.getAttribute('data-hovercard-id')
  if (!email || !email.includes('@')) return null

  const fullName =
    el.getAttribute('data-name')?.trim() ||
    el.getAttribute('name')?.trim() ||
    email.split('@')[0]?.replace(/[._+-]+/g, ' ')

  const avatar = el.getAttribute('src')

  return {
    ...splitName(fullName ?? ''),
    fullName,
    primaryEmail: email,
    avatarUrl: isLikelyAvatar(avatar) ? avatar! : undefined,
    externalId: gmailExternalId(email),
  }
}

async function parseOpenThread(): Promise<ParseResult> {
  // Expand the recipient list if it's collapsed.
  document
    .querySelector<HTMLElement>('[role=list] [aria-expanded=false][role=button] [aria-hidden]')
    ?.click()
  await new Promise((r) => setTimeout(r, 600))

  const headerNodes = Array.from(
    document.querySelectorAll<HTMLElement>('[data-hovercard-id][data-name]')
  ).filter((el) => el.offsetParent !== null)

  const self =
    document.querySelector('[data-hovercard-id][jid]:not([data-name])')?.getAttribute('jid') ?? null

  const byEmail = new Map<string, ParsedPerson>()

  // Reverse so the most recent recipient ends up first after dedup.
  for (const el of headerNodes.reverse()) {
    const person = elementToPerson(el, self)
    if (!person?.primaryEmail) continue
    if (person.primaryEmail === self) continue
    if (!byEmail.has(person.primaryEmail)) byEmail.set(person.primaryEmail, person)
  }

  const listItems = document.querySelectorAll(
    '[role="main"] [role="listitem"] [data-hovercard-id][name]'
  )
  for (const el of listItems) {
    const person = elementToPerson(el, self)
    if (!person?.primaryEmail) continue
    if (person.primaryEmail === self) continue
    if (!byEmail.has(person.primaryEmail)) byEmail.set(person.primaryEmail, person)
  }

  return { people: [...byEmail.values()], companies: [] }
}

async function parseCompose(): Promise<ParseResult> {
  const templateBtn = document.querySelector('button[aria-label="Insert template"]')
  const composer = templateBtn?.closest('table[role=presentation]') as HTMLElement | null
  const options =
    composer?.querySelectorAll<HTMLElement>('div[name=to] div[role="option"][data-name]') ?? []

  const byEmail = new Map<string, ParsedPerson>()
  for (const el of options) {
    const person = elementToPerson(el, null)
    if (!person?.primaryEmail) continue
    if (!byEmail.has(person.primaryEmail)) byEmail.set(person.primaryEmail, person)
  }

  return { people: [...byEmail.values()], companies: [] }
}

export async function parseGmail(): Promise<ParseResult> {
  // Heuristic: a compose window has the "Insert template" button.
  const isCompose = !!document.querySelector('button[aria-label="Insert template"]')
  if (isCompose) {
    const composeResult = await parseCompose()
    if (composeResult.people.length > 0) return composeResult
  }
  const thread = await parseOpenThread()
  if (thread.people.length > 0) return thread
  return EMPTY_PARSE_RESULT
}

/** Lightweight cache key for the iframe — same URL = same parse. */
export function gmailFingerprint(url: URL): string {
  return `gmail/${url.hash || url.pathname}`
}

// Silences TS unused-warnings around `textOf` in case a future extraction
// uses it; keeping it in scope avoids accidental tree-shaking while iterating.
void textOf
