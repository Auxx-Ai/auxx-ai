// apps/extension/src/iframe/routes/root/detect-target.ts

import type { GenericPage, Target } from './types'

/**
 * Map an active tab's URL to a parser target (host + entityType + parseOp),
 * or null when we're on a page Auxx can't capture from. Reserved-path
 * guards keep us from trying to parse a profile out of feed/inbox/search
 * URLs that share a host with the supported pages.
 */

/**
 * Top-level x.com / twitter.com paths that aren't usernames. Without this
 * guard, the iframe would try to parse a profile out of `x.com/home` and
 * silently fail.
 */
const TWITTER_RESERVED_PATHS = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'i',
  'compose',
  'settings',
  'tos',
  'privacy',
  'about',
  'search',
  'login',
  'signup',
  'logout',
  'account',
  'jobs',
  'premium_sign_up',
])

/**
 * Top-level facebook.com paths that aren't profiles. `profile.php` is
 * whitelisted by falling through — we key dedup off the `id` query param.
 */
const FACEBOOK_RESERVED_PATHS = new Set([
  'home',
  'marketplace',
  'groups',
  'watch',
  'events',
  'messages',
  'friends',
  'bookmarks',
  'notifications',
  'settings',
  'gaming',
  'reel',
  'pages',
  'stories',
  'policies',
  'help',
  'business',
  'login',
  'signup',
  'logout',
])

/**
 * Top-level instagram.com paths that aren't profiles. `/<username>/followers`,
 * `/<username>/tagged`, etc. aren't listed here — the first segment is the
 * username, so the parser's `h2 === url slug` guard gates parse success.
 */
const INSTAGRAM_RESERVED_PATHS = new Set([
  'accounts',
  'direct',
  'explore',
  'p',
  'reel',
  'reels',
  'stories',
  'tv',
  'tags',
  'locations',
  'legal',
  'about',
  'developer',
  'press',
  'web',
  'emails',
  'privacy',
  'session',
  'challenge',
  'oauth',
  'api',
])

export function readGenericPage(tab: chrome.tabs.Tab | null): GenericPage | null {
  const rawUrl = tab?.url
  if (!rawUrl) return null
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const hostname = u.hostname.replace(/^www\./, '').toLowerCase()
    if (!hostname) return null
    const title = (tab?.title ?? '').trim() || hostname
    return { url: rawUrl, title, hostname }
  } catch {
    return null
  }
}

/**
 * Returns the deep-link to the Contact and Basic Info sub-tab of the current
 * Facebook profile, or null when the URL already points there. The parser
 * only succeeds inside that tab so we route the user there via a hint before
 * dispatching.
 */
export function facebookContactInfoUrl(u: URL): string | null {
  if (u.pathname.includes('about_contact_and_basic_info')) return null
  if (u.searchParams.get('sk') === 'about_contact_and_basic_info') return null
  if (u.pathname.includes('profile.php')) {
    const id = u.searchParams.get('id')
    if (!id) return null
    return `https://www.facebook.com/profile.php?id=${id}&sk=about_contact_and_basic_info`
  }
  const vanity = u.pathname.split('/').filter(Boolean)[0]
  if (!vanity) return null
  return `https://www.facebook.com/${vanity}/about_contact_and_basic_info`
}

export function detectTarget(url: string | undefined): Target | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.hostname === 'mail.google.com') {
      return { host: 'gmail', entityType: 'contact', parseOp: 'parseGmail' }
    }
    if (u.hostname === 'www.linkedin.com') {
      if (u.pathname.startsWith('/sales/')) {
        return {
          host: 'sales-navigator',
          entityType: 'contact',
          parseOp: 'parseSalesNavigator',
        }
      }
      if (u.pathname.startsWith('/company/')) {
        return {
          host: 'linkedin',
          entityType: 'company',
          parseOp: 'parseLinkedInCompany',
        }
      }
      return { host: 'linkedin', entityType: 'contact', parseOp: 'parseLinkedIn' }
    }
    if (u.hostname === 'twitter.com' || u.hostname === 'x.com' || u.hostname === 'www.x.com') {
      if (u.pathname.startsWith('/search') || u.pathname.startsWith('/i/lists/')) {
        return { host: 'twitter', entityType: 'contact', parseOp: 'parseTwitterSearch' }
      }
      const firstSegment = u.pathname.split('/')[1] ?? ''
      if (!firstSegment || TWITTER_RESERVED_PATHS.has(firstSegment)) return null
      return { host: 'twitter', entityType: 'contact', parseOp: 'parseTwitterProfile' }
    }
    if (u.hostname === 'www.facebook.com' || u.hostname === 'facebook.com') {
      const firstSegment = u.pathname.split('/')[1] ?? ''
      if (firstSegment !== 'profile.php' && FACEBOOK_RESERVED_PATHS.has(firstSegment)) return null
      if (!firstSegment) return null
      // entityType is provisional — the parser self-detects and the
      // parse-result handler re-routes to 'company' when the result
      // populates the companies array. See the run() effect in root-route.
      return { host: 'facebook', entityType: 'contact', parseOp: 'parseFacebook' }
    }
    if (u.hostname === 'www.instagram.com' || u.hostname === 'instagram.com') {
      const firstSegment = u.pathname.split('/')[1] ?? ''
      if (!firstSegment) return null
      if (INSTAGRAM_RESERVED_PATHS.has(firstSegment)) return null
      return { host: 'instagram', entityType: 'contact', parseOp: 'parseInstagramProfile' }
    }
    return null
  } catch {
    return null
  }
}
