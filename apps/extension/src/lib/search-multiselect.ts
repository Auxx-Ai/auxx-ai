// apps/extension/src/lib/search-multiselect.ts

/**
 * Generic search-results multi-select controller shared between LinkedIn and
 * Twitter (and any future host with a rows-of-people list). The host wires:
 *
 *   - how to find cards (`getCards()` returning `{externalId, element}[]`)
 *   - where to insert the sticky header (optional — modals skip it)
 *   - a per-host `hostId` used to scope DOM ids / checkbox CSS
 *   - optional `decorateCard(element)` callback for host-specific layout
 *     tweaks (LinkedIn needs `display: flex` + lastChild flex-fill; Twitter
 *     doesn't).
 *
 * Selection state is kept in-module per controller instance. Opening the
 * iframe reads the state via `controller.selected()` so the iframe can
 * render a bulk-add list once the selection-sync pass lands (plan 18).
 */

/** Shared class name for the hand-rolled checkbox. */
const CHECKBOX_CLASS = 'auxx-checkbox'
const CHECKBOX_STYLE_ID = 'auxx-search-checkbox-styles'

export type SearchCard = { externalId: string; element: Element }

type BuildHeaderOptions = {
  onCheckboxChange: (checked: boolean) => void
  onButtonClick: () => void
  /** CSS applied to the sticky-header wrapper. LinkedIn inherits artdeco-card styling via `extraClassName`. */
  extraClassName?: string
  /** Inline style override for the header wrapper. Defaults to LinkedIn's padded flex row. */
  style?: string
}

export type SearchMultiselectController = {
  /** Selected external IDs (current value, not a snapshot). */
  selected: () => string[]
  /** Replace the selected set and re-sync all checkboxes / header. */
  setSelected: (ids: string[]) => void
  /**
   * Run a full mount tick: inject styles, add missing per-card checkboxes,
   * optionally ensure the sticky header, sync header + checkbox state.
   */
  mount: () => void
}

export type SearchMultiselectConfig = {
  /** e.g. 'linkedin' / 'twitter' — used to scope DOM ids. */
  hostId: string
  /** Enumerate current cards + their stable externalId. Called on every tick. */
  getCards: () => SearchCard[]
  /**
   * Where to prepend the sticky header. Return null to skip the header (e.g.
   * inside a modal). Called on every mount tick.
   */
  getHeaderContainer?: () => Element | null
  /** Header styling hooks. */
  header?: Omit<BuildHeaderOptions, 'onCheckboxChange' | 'onButtonClick'>
  /** Fires when the bulk-add button is clicked. Host opens the panel. */
  onBulkAdd: (selected: string[]) => void
  /** Per-host tweak to the card element right after the checkbox is prepended. */
  decorateCard?: (element: HTMLElement) => void
  /** Override the checkbox wrapper margin. Defaults to LinkedIn spacing. */
  cardCheckboxWrapperStyle?: string
}

export function createSearchMultiselect(
  config: SearchMultiselectConfig
): SearchMultiselectController {
  const CHECKBOX_PREFIX = `auxx-search-checkbox-${config.hostId}`
  const HEADER_ID = `auxx-search-header-${config.hostId}`
  const HEADER_BUTTON_ID = `auxx-search-header-button-${config.hostId}`
  const SELECT_ALL_ID = `auxx-search-select-all-${config.hostId}`
  const SELECT_ALL_LABEL_ID = `auxx-search-select-all-label-${config.hostId}`

  let selectedExternalIds: string[] = []

  function checkboxIdFor(externalId: string): string {
    return `${CHECKBOX_PREFIX}-${externalId.replace(/[^\w-]/g, '_')}`
  }

  function setSelected(ids: string[]): void {
    selectedExternalIds = ids
    sync()
  }

  function mount(): void {
    ensureCheckboxStylesInjected()

    const cards = config.getCards()
    for (const { externalId, element } of cards) {
      const id = checkboxIdFor(externalId)
      if (document.getElementById(id)) continue

      config.decorateCard?.(element as HTMLElement)

      element.prepend(
        buildCardCheckbox({
          id,
          checked: selectedExternalIds.includes(externalId),
          wrapperStyle: config.cardCheckboxWrapperStyle,
          onChange: (checked) =>
            setSelected(
              checked
                ? [...selectedExternalIds, externalId]
                : selectedExternalIds.filter((x) => x !== externalId)
            ),
        })
      )
    }

    if (cards.length === 0) return

    const headerContainer = config.getHeaderContainer?.()
    if (headerContainer && !document.getElementById(HEADER_ID)) {
      headerContainer.prepend(
        buildSearchHeader({
          headerId: HEADER_ID,
          buttonId: HEADER_BUTTON_ID,
          selectAllId: SELECT_ALL_ID,
          selectAllLabelId: SELECT_ALL_LABEL_ID,
          extraClassName: config.header?.extraClassName,
          style: config.header?.style,
          onCheckboxChange: (checked) =>
            setSelected(checked ? config.getCards().map((c) => c.externalId) : []),
          onButtonClick: () => {
            const all = config.getCards().map((c) => c.externalId)
            if (selectedExternalIds.length === 0) setSelected(all)
            config.onBulkAdd(selectedExternalIds)
          },
        })
      )
    }

    sync()
  }

  function sync(): void {
    const cards = config.getCards()
    const visibleSelected = cards
      .map((c) => c.externalId)
      .filter((id) => selectedExternalIds.includes(id))

    const buttonSpan = document.querySelector<HTMLSpanElement>(
      `#${CSS.escape(HEADER_BUTTON_ID)} span`
    )
    if (buttonSpan) {
      const count = visibleSelected.length > 0 ? visibleSelected.length : cards.length
      const next = `Add ${count} ${count === 1 ? 'person' : 'people'} to Auxx`
      if (buttonSpan.textContent !== next) buttonSpan.textContent = next
    }

    for (const { externalId } of cards) {
      const checkbox = document.getElementById(checkboxIdFor(externalId)) as HTMLInputElement | null
      if (!checkbox) continue
      const checked = selectedExternalIds.includes(externalId)
      checkbox.checked = checked
      checkbox.setAttribute('aria-checked', String(checked))
    }

    const selectAll = document.getElementById(SELECT_ALL_ID) as HTMLInputElement | null
    const selectAllLabel = document.getElementById(SELECT_ALL_LABEL_ID)
    if (!selectAll || !selectAllLabel) return
    const status =
      cards.length === visibleSelected.length
        ? 'all'
        : visibleSelected.length === 0
          ? 'none'
          : 'mixed'
    switch (status) {
      case 'none':
        selectAll.checked = false
        selectAll.indeterminate = false
        selectAll.setAttribute('aria-checked', 'false')
        if (selectAllLabel.textContent !== 'Select all') selectAllLabel.textContent = 'Select all'
        break
      case 'all':
        selectAll.checked = true
        selectAll.indeterminate = false
        selectAll.setAttribute('aria-checked', 'true')
        if (selectAllLabel.textContent !== 'Unselect all')
          selectAllLabel.textContent = 'Unselect all'
        break
      case 'mixed':
        selectAll.checked = false
        selectAll.indeterminate = true
        selectAll.setAttribute('aria-checked', 'mixed')
        if (selectAllLabel.textContent !== 'Select all') selectAllLabel.textContent = 'Select all'
        break
    }
  }

  return {
    selected: () => selectedExternalIds,
    setSelected,
    mount,
  }
}

// ─── Building blocks ────────────────────────────────────────────

function buildCardCheckbox(opts: {
  id: string
  checked: boolean
  wrapperStyle?: string
  onChange: (checked: boolean) => void
}): HTMLElement {
  const wrap = document.createElement('div')
  wrap.style.cssText = opts.wrapperStyle ?? 'margin: 2.4rem 0 1.2rem 1.6rem'
  const { checkbox, label } = buildCheckboxPair({
    id: opts.id,
    onChange: opts.onChange,
  })
  checkbox.checked = opts.checked
  wrap.appendChild(checkbox)
  wrap.appendChild(label)
  return wrap
}

function buildSearchHeader(opts: {
  headerId: string
  buttonId: string
  selectAllId: string
  selectAllLabelId: string
  extraClassName?: string
  style?: string
  onCheckboxChange: (checked: boolean) => void
  onButtonClick: () => void
}): HTMLElement {
  const section = document.createElement('section')
  if (opts.extraClassName) section.className = opts.extraClassName
  section.id = opts.headerId
  section.style.cssText =
    opts.style ??
    'display: flex; flex-direction: row; align-items: center; padding: 1.6rem; margin-bottom: 4rem; gap: 1rem;'

  const { checkbox, label } = buildCheckboxPair({
    id: opts.selectAllId,
    labelId: opts.selectAllLabelId,
    labelText: 'Select all',
    onChange: opts.onCheckboxChange,
  })
  label.style.cssText = 'margin: 0; font-size: 14px; color: rgba(0,0,0,0.75);'

  const button = buildBulkAddButton({ id: opts.buttonId, onClick: opts.onButtonClick })
  button.style.marginLeft = 'auto'

  section.appendChild(checkbox)
  section.appendChild(label)
  section.appendChild(button)
  return section
}

function buildBulkAddButton(opts: { id: string; onClick: () => void }): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.id = opts.id
  btn.type = 'button'
  btn.innerHTML = `
    <svg viewBox="0 0 68 68" width="20" height="20" aria-hidden="true">
      <g fill="currentColor">
        <path d="M7.74,39.14c-.69,0-1.39-.24-1.95-.72-1.37-1.17-1.29-3.34-.02-4.62L31.78,7.59c1.19-1.2,3.13-1.2,4.32,0l26.06,26.25c1.05,1.05,1.31,2.73.47,3.96-1.11,1.61-3.31,1.75-4.62.44l-24.04-24.22s-.04-.02-.06,0l-24.04,24.22c-.59.59-1.36.89-2.13.89Z"/>
        <rect x="18.88" y="31.89" width="13.68" height="13.79" rx="2.46" ry="2.46"/>
        <rect x="33.93" y="31.89" width="13.68" height="13.79" rx="2.39" ry="2.39"/>
        <rect x="33.93" y="47.06" width="13.68" height="13.79" rx="2.5" ry="2.5"/>
      </g>
    </svg>
    <span>Add to Auxx</span>
  `
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    opts.onClick()
  })
  const styleId = `${opts.id}-style`
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = `
      #${CSS.escape(opts.id)} {
        background-color: #000;
        color: #fff;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: center;
        border: 1px solid transparent;
        cursor: pointer;
        padding-inline: 8px 10px;
        height: 32px;
        border-radius: 100px;
        flex-shrink: 0;
        font-size: 16px;
        line-height: 20px;
        font-weight: 600;
      }
      #${CSS.escape(opts.id)} svg {
        width: 20px;
        height: 20px;
        color: white;
        flex-shrink: 0;
        margin: 0 4px 0 -2px;
      }
      #${CSS.escape(opts.id)}:hover { background-color: rgba(0, 0, 0, 0.8); }
    `
    document.head.appendChild(style)
  }
  return btn
}

function buildCheckboxPair(opts: {
  id: string
  labelId?: string
  labelText?: string
  onChange: (checked: boolean) => void
}): { checkbox: HTMLInputElement; label: HTMLLabelElement } {
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = CHECKBOX_CLASS
  checkbox.id = opts.id
  checkbox.addEventListener('change', () => opts.onChange(checkbox.checked))

  const label = document.createElement('label')
  label.htmlFor = opts.id
  if (opts.labelId) label.id = opts.labelId
  label.style.userSelect = 'none'
  label.textContent = opts.labelText ?? ''

  return { checkbox, label }
}

function ensureCheckboxStylesInjected(): void {
  if (document.getElementById(CHECKBOX_STYLE_ID)) return
  const style = document.createElement('style')
  style.id = CHECKBOX_STYLE_ID
  style.textContent = `
    .${CHECKBOX_CLASS}[type="checkbox"] {
      -webkit-appearance: none !important;
      appearance: none !important;
      accent-color: initial !important;
      box-sizing: border-box !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff;
      border: 1.5px solid #000;
      outline: none;
      inline-size: 24px;
      block-size: 24px;
      display: inline-grid;
      place-items: center;
      border-radius: 0.4rem;
      cursor: pointer;
    }
    .${CHECKBOX_CLASS}[type="checkbox"]:hover:not(:disabled) {
      box-shadow: 0 0 0 1px rgba(0,0,0,0.8) inset;
    }
    .${CHECKBOX_CLASS}[type="checkbox"]::before {
      content: "";
      width: 100%;
      height: 100%;
      background: #000;
      transform: scale(0);
      clip-path: polygon(41.67% 68.33%, 25% 51.67%, 30.83% 45.83%, 41.67% 56.67%, 69.17% 29.17%, 75% 35%);
    }
    .${CHECKBOX_CLASS}[type="checkbox"]:checked::before { transform: scale(1); }
    .${CHECKBOX_CLASS}[type="checkbox"]:indeterminate::before {
      clip-path: polygon(25% 45%, 25% 55%, 75% 55%, 75% 45%);
      transform: scale(1);
    }
  `
  document.head.appendChild(style)
}
