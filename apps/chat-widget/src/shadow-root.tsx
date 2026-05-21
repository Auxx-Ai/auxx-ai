// apps/chat-widget/src/shadow-root.tsx
//
// Encapsulates the widget inside a closed Shadow DOM so host-page CSS cannot
// leak in and Tailwind's preflight cannot leak out. Exposes the shadow root
// via context so Radix portal consumers can target it instead of
// `document.body` (which lives outside the shadow tree and breaks styling).

import type { ComponentChildren, VNode } from 'preact'
import { createContext, render } from 'preact'
import { useContext } from 'preact/hooks'
import widgetCss from './styles.css?inline'
import { PortalContainerProvider } from './ui/portal-container'

const HOST_ID = 'auxx-chat-widget-root'
const PROPERTIES_STYLE_ID = 'auxx-chat-widget-properties'
const ROOT_CLASS = 'auxx-root'

interface Mount {
  shadowRoot: ShadowRoot
  rootEl: HTMLElement
}

// Browsers ignore `@property` rules that live inside a Shadow Root — they only
// register in the main document's property registry. Tailwind v4 relies on
// `@property` to give vars like `--tw-border-style` an `initial-value: solid`,
// so we extract every `@property` block from the bundled CSS, hoist it to
// `document.head` (registers globally → inherits into the shadow root), and
// keep the rest of the stylesheet scoped to the shadow root.
const PROPERTY_RULE_RE = /@property\s+--[^{]+\{[^}]*\}/g

function splitProperties(css: string): { properties: string; rest: string } {
  const properties = css.match(PROPERTY_RULE_RE)?.join('') ?? ''
  const rest = css.replace(PROPERTY_RULE_RE, '')
  return { properties, rest }
}

function injectStyles(shadowRoot: ShadowRoot): void {
  const { properties, rest } = splitProperties(widgetCss)

  if (properties && !document.getElementById(PROPERTIES_STYLE_ID)) {
    const headTag = document.createElement('style')
    headTag.id = PROPERTIES_STYLE_ID
    headTag.textContent = properties
    document.head.appendChild(headTag)
  }

  const tag = document.createElement('style')
  tag.textContent = rest
  shadowRoot.appendChild(tag)
}

function createMount(): Mount {
  let host = document.getElementById(HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = HOST_ID
    document.body.appendChild(host)
  }
  const shadowRoot = host.attachShadow({ mode: 'closed' })
  injectStyles(shadowRoot)
  const rootEl = document.createElement('div')
  rootEl.className = ROOT_CLASS
  shadowRoot.appendChild(rootEl)
  return { shadowRoot, rootEl }
}

const ShadowRootContext = createContext<ShadowRoot | null>(null)

export function useShadowRoot(): ShadowRoot | null {
  return useContext(ShadowRootContext)
}

interface ShadowRootProviderProps {
  shadowRoot: ShadowRoot
  children: ComponentChildren
}

export function ShadowRootProvider({ shadowRoot, children }: ShadowRootProviderProps) {
  return <ShadowRootContext.Provider value={shadowRoot}>{children}</ShadowRootContext.Provider>
}

export function mountWidget(tree: VNode): ShadowRoot {
  const { shadowRoot, rootEl } = createMount()
  render(
    <ShadowRootProvider shadowRoot={shadowRoot}>
      <PortalContainerProvider value={rootEl}>{tree}</PortalContainerProvider>
    </ShadowRootProvider>,
    rootEl
  )
  return shadowRoot
}
