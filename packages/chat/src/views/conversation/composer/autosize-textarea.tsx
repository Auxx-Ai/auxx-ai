// packages/chat/src/views/conversation/composer/autosize-textarea.tsx
//
// Trimmed preact port of `packages/ui/src/components/autosize-field.tsx`.
// Drops `autoWidth`, `widthSizer`, `cva` variants — the composer wrapper owns
// styling. Same measurement strategy (hidden singleton textarea + computed-
// style copy) so jitter behavior matches the dashboard.

import type { CSSProperties, JSX } from 'preact/compat'
import { forwardRef, useCallback, useLayoutEffect, useRef } from 'preact/compat'
import { cn } from '~/lib/cn'

const SIZING_STYLE_KEYS = [
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'boxSizing',
  'fontFamily',
  'fontSize',
  'fontStyle',
  'fontWeight',
  'letterSpacing',
  'lineHeight',
  'paddingBottom',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'tabSize',
  'textIndent',
  'textRendering',
  'textTransform',
  'width',
  'wordBreak',
] as const

const HIDDEN_TEXTAREA_STYLE: Record<string, string> = {
  'min-height': '0',
  'max-height': 'none',
  height: '0',
  visibility: 'hidden',
  overflow: 'hidden',
  position: 'absolute',
  'z-index': '-1000',
  top: '0',
  right: '0',
}

let hiddenTextarea: HTMLTextAreaElement | null = null

interface SizingInfo {
  sizingStyle: Record<string, string>
  paddingSize: number
  borderSize: number
}

/** `borderTopWidth` -> `border-top-width`, the form `CSSStyleDeclaration` APIs take. */
function toCssProperty(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
}

function applyHiddenStyles(element: HTMLTextAreaElement): void {
  for (const [key, value] of Object.entries(HIDDEN_TEXTAREA_STYLE)) {
    element.style.setProperty(key, value, 'important')
  }
}

function getSizingInfo(element: HTMLTextAreaElement): SizingInfo | null {
  const computedStyle = window.getComputedStyle(element)
  if (!computedStyle) return null
  const sizingStyle: Record<string, string> = {}
  for (const key of SIZING_STYLE_KEYS) {
    sizingStyle[key] = computedStyle.getPropertyValue(toCssProperty(key))
  }
  if (sizingStyle.boxSizing === '') return null
  const paddingSize =
    parseFloat(sizingStyle.paddingBottom || '0') + parseFloat(sizingStyle.paddingTop || '0')
  const borderSize =
    parseFloat(sizingStyle.borderBottomWidth || '0') + parseFloat(sizingStyle.borderTopWidth || '0')
  return { sizingStyle, paddingSize, borderSize }
}

function getScrollHeight(element: HTMLTextAreaElement, info: SizingInfo): number {
  return info.sizingStyle.boxSizing === 'border-box'
    ? element.scrollHeight + info.borderSize
    : element.scrollHeight - info.paddingSize
}

function calculateHeight(
  value: string,
  info: SizingInfo,
  minRows: number,
  maxRows: number
): number {
  if (!hiddenTextarea) {
    hiddenTextarea = document.createElement('textarea')
    hiddenTextarea.setAttribute('tabindex', '-1')
    hiddenTextarea.setAttribute('aria-hidden', 'true')
    applyHiddenStyles(hiddenTextarea)
  }
  const sizer = hiddenTextarea
  if (!sizer.parentNode) document.body.appendChild(sizer)
  for (const [key, val] of Object.entries(info.sizingStyle)) {
    sizer.style.setProperty(toCssProperty(key), val)
  }
  applyHiddenStyles(sizer)

  sizer.value = value || 'x'
  let contentHeight = getScrollHeight(sizer, info)
  sizer.value = 'x'
  const rowHeight = sizer.scrollHeight - info.paddingSize

  let minHeight = rowHeight * minRows
  if (info.sizingStyle.boxSizing === 'border-box') {
    minHeight = minHeight + info.paddingSize + info.borderSize
  }
  contentHeight = Math.max(minHeight, contentHeight)

  let maxHeight = rowHeight * maxRows
  if (info.sizingStyle.boxSizing === 'border-box') {
    maxHeight = maxHeight + info.paddingSize + info.borderSize
  }
  return Math.min(maxHeight, contentHeight)
}

// `JSX.HTMLAttributes` is the element-agnostic base and has no `value` — the
// textarea-specific attribute set is what carries `value` / `rows` / `wrap`.
//
// `value` is then re-declared rather than inherited: how the intrinsic type
// resolves through `forwardRef`'s `PropsWithoutRef` is not stable here (a
// byte-identical copy of `composer.tsx` typechecks while the original does not),
// and the measurement code reads `value` as a plain string anyway.
interface AutosizeTextareaProps extends Omit<JSX.IntrinsicElements['textarea'], 'style' | 'value'> {
  minRows?: number
  maxRows?: number
  cacheMeasurements?: boolean
  style?: CSSProperties
  value?: string
}

export const AutosizeTextarea = forwardRef<HTMLTextAreaElement, AutosizeTextareaProps>(
  function AutosizeTextarea(
    {
      minRows = 1,
      maxRows = 6,
      cacheMeasurements = true,
      value,
      className,
      style,
      onInput,
      ...props
    },
    forwardedRef
  ) {
    const localRef = useRef<HTMLTextAreaElement | null>(null)
    const heightRef = useRef(0)
    const cachedRef = useRef<SizingInfo | null>(null)

    const setRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        localRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef)
          (forwardedRef as { current: HTMLTextAreaElement | null }).current = node
      },
      [forwardedRef]
    )

    const recalc = useCallback(() => {
      const el = localRef.current
      if (!el) return
      const info = cacheMeasurements && cachedRef.current ? cachedRef.current : getSizingInfo(el)
      if (!info) return
      if (cacheMeasurements) cachedRef.current = info
      const current = el.value || el.placeholder || 'x'
      const height = calculateHeight(current, info, minRows, maxRows)
      if (heightRef.current !== height) {
        heightRef.current = height
        el.style.setProperty('height', `${height}px`, 'important')
      }
    }, [cacheMeasurements, minRows, maxRows])

    useLayoutEffect(() => {
      recalc()
    })

    useLayoutEffect(() => {
      const handler = () => recalc()
      window.addEventListener('resize', handler)
      if (document.fonts?.addEventListener) {
        document.fonts.addEventListener('loadingdone', handler)
      }
      return () => {
        window.removeEventListener('resize', handler)
        if (document.fonts?.removeEventListener) {
          document.fonts.removeEventListener('loadingdone', handler)
        }
      }
    }, [recalc])

    return (
      <textarea
        {...props}
        ref={setRef}
        value={value}
        onInput={onInput}
        className={cn(
          'block w-full resize-none border-0 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground',
          className
        )}
        style={style}
      />
    )
  }
)
