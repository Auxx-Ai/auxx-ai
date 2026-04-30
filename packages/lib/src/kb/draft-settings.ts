// packages/lib/src/kb/draft-settings.ts

/**
 * Pending draft of KB-level presentation settings. Lives in
 * `KnowledgeBase.draftSettings` (jsonb). Public-site reads always come from
 * the flat columns; admin views merge this draft on top via
 * {@link mergeDraftOverLive}.
 */
export interface KBDraftSettings {
  name?: string
  description?: string | null
  logoDark?: string | null
  logoLight?: string | null
  logoDarkId?: string | null
  logoLightId?: string | null
  theme?: string
  showMode?: boolean
  defaultMode?: string
  primaryColorLight?: string | null
  primaryColorDark?: string | null
  tintColorLight?: string | null
  tintColorDark?: string | null
  infoColorLight?: string | null
  infoColorDark?: string | null
  successColorLight?: string | null
  successColorDark?: string | null
  warningColorLight?: string | null
  warningColorDark?: string | null
  dangerColorLight?: string | null
  dangerColorDark?: string | null
  fontFamily?: string | null
  iconsFamily?: string
  cornerStyle?: string
  sidebarListStyle?: string
  searchbarPosition?: string
  headerEnabled?: boolean
  footerEnabled?: boolean
  headerNavigation?: Array<{ title: string; link: string }> | null
  footerNavigation?: Array<{ title: string; link: string }> | null
}

/** Apply pending draft over the live row. Used by all admin reads. */
export function mergeDraftOverLive<KB extends Record<string, unknown>>(
  kb: KB & { draftSettings?: KBDraftSettings | null }
): KB {
  if (!kb.draftSettings) return kb
  return { ...kb, ...kb.draftSettings }
}

/** True iff there is at least one pending draft key. */
export function hasUnpublishedSettings(draft: KBDraftSettings | null | undefined): boolean {
  return !!draft && Object.keys(draft).length > 0
}

/** Which top-level sections of the settings UI currently have drafted fields. */
export const DRAFT_SECTION_FIELDS = {
  identity: ['name', 'description'],
  logos: ['logoLight', 'logoDark', 'logoLightId', 'logoDarkId'],
  theme: ['theme'],
  colors: [
    'primaryColorLight',
    'primaryColorDark',
    'tintColorLight',
    'tintColorDark',
    'infoColorLight',
    'infoColorDark',
    'successColorLight',
    'successColorDark',
    'warningColorLight',
    'warningColorDark',
    'dangerColorLight',
    'dangerColorDark',
  ],
  modes: ['showMode', 'defaultMode'],
  styling: ['fontFamily', 'iconsFamily', 'cornerStyle', 'sidebarListStyle', 'searchbarPosition'],
  header: ['headerEnabled', 'headerNavigation'],
  footer: ['footerEnabled', 'footerNavigation'],
} as const

export type DraftSection = keyof typeof DRAFT_SECTION_FIELDS

export function draftedSections(draft: KBDraftSettings | null | undefined): Set<DraftSection> {
  const out = new Set<DraftSection>()
  if (!draft) return out
  const keys = new Set(Object.keys(draft))
  for (const [section, fields] of Object.entries(DRAFT_SECTION_FIELDS)) {
    if ((fields as readonly string[]).some((f) => keys.has(f))) {
      out.add(section as DraftSection)
    }
  }
  return out
}
