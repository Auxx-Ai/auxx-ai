// apps/extension/src/lib/dom.ts

/**
 * DOM utilities for content scripts.
 */

/**
 * Run `cb()` once now, then again every time `document.body` mutates.
 * Used by content scripts to re-inject buttons after SPA navigations.
 */
export function observeDocumentBody(cb: () => void): MutationObserver {
  cb()
  const observer = new MutationObserver(() => cb())
  observer.observe(document.body, { childList: true, subtree: true })
  return observer
}

/**
 * Wait up to `timeoutMs` for `selector` (CSS) to resolve a non-null Element.
 * Resolves with the Element or `null` on timeout. No throwing.
 */
export function findBySelectorAsync(
  selector: string,
  { timeoutMs = 4000, root = document as ParentNode } = {}
): Promise<Element | null> {
  return new Promise((resolve) => {
    const found = root.querySelector(selector)
    if (found) {
      resolve(found)
      return
    }
    const observer = new MutationObserver(() => {
      const el = root.querySelector(selector)
      if (el) {
        observer.disconnect()
        clearTimeout(timer)
        resolve(el)
      }
    })
    observer.observe(root instanceof Document ? root.body : (root as Node), {
      childList: true,
      subtree: true,
    })
    const timer = setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeoutMs)
  })
}

// ─── XPath helpers ─────────────────────────────────────────────

function xpathRoot(container?: Node): Node {
  if (container instanceof ShadowRoot) return container.firstElementChild ?? document
  return container ?? document
}

/** Single-node XPath query. Returns the first matching Element or null. */
export function queryXpath(xpath: string, container?: Node): Element | null {
  try {
    const result = new XPathEvaluator()
      .createExpression(xpath)
      .evaluate(xpathRoot(container), XPathResult.FIRST_ORDERED_NODE_TYPE)
    return result.singleNodeValue instanceof Element ? result.singleNodeValue : null
  } catch (err) {
    console.error('[auxx] queryXpath error', err)
    return null
  }
}

/** All-nodes XPath query. Returns every matching Element (ordered). */
export function queryXpathAll(xpath: string, container?: Node): Element[] {
  try {
    const result = new XPathEvaluator()
      .createExpression(xpath)
      .evaluate(xpathRoot(container), XPathResult.ORDERED_NODE_SNAPSHOT_TYPE)
    const out: Element[] = []
    for (let i = 0; i < result.snapshotLength; i++) {
      const item = result.snapshotItem(i)
      if (item instanceof Element) out.push(item)
    }
    return out
  } catch (err) {
    console.error('[auxx] queryXpathAll error', err)
    return []
  }
}

/**
 * Cheap, deterministic host-side text snapshot — used by parsers to grab
 * "the visible text content of this node" without preserving inline markup.
 */
export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}
