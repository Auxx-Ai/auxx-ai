// packages/lib/src/snippets/__tests__/system-snippets-purchase-order.test.ts
//
// `purchase_order_email` is the third seeded system snippet (purchasing plan 07). It follows
// `quote_email`/`invoice_email` exactly — same placeholder vocabulary, same span shape, same
// def guard — but reads as a message to a SUPPLIER rather than a sales document.

import { describe, expect, it } from 'vitest'
import { buildSystemSnippetTemplates } from '../system-snippets'

const ENTITY_DEFS: Record<string, string> = {
  quote: 'def_quote',
  invoice: 'def_invoice',
  purchase_order: 'def_po',
  contact: 'def_contact',
}

function purchaseOrderTemplate(entityDefs: Record<string, string> = ENTITY_DEFS) {
  return buildSystemSnippetTemplates(entityDefs).find(
    (t) => t.systemType === 'purchase_order_email'
  )
}

describe('purchase_order_email system snippet', () => {
  it('is built alongside quote_email and invoice_email', () => {
    const systemTypes = buildSystemSnippetTemplates(ENTITY_DEFS).map((t) => t.systemType)
    expect(systemTypes).toEqual(['quote_email', 'invoice_email', 'purchase_order_email'])
  })

  it('is omitted when the purchase_order def does not exist yet', () => {
    const { purchase_order: _omitted, ...withoutPo } = ENTITY_DEFS
    expect(purchaseOrderTemplate(withoutPo)).toBeUndefined()
    // ...and the other two are unaffected.
    expect(buildSystemSnippetTemplates(withoutPo).map((t) => t.systemType)).toEqual([
      'quote_email',
      'invoice_email',
    ])
  })

  it('is omitted when the contact def does not exist — the greeting has no root', () => {
    const { contact: _omitted, ...withoutContact } = ENTITY_DEFS
    expect(purchaseOrderTemplate(withoutContact)).toBeUndefined()
  })

  // 🛑 A placeholder that cannot resolve throws in `resolvePlaceholdersInHtml`, so every token
  // must name a real `key` on `purchase-order-fields.ts` / the contact def.
  it('only uses field keys that exist on purchase_order and contact', () => {
    const template = purchaseOrderTemplate()
    const tokens = [...(template?.contentHtml ?? '').matchAll(/data-id="([^"]+)"/g)].map(
      (m) => m[1] as string
    )
    expect(tokens).toEqual([
      'def_contact:firstName',
      'def_po:number',
      'def_po:total',
      'def_po:expectedAt',
    ])
  })

  it('carries fallbacks for the two tokens that are commonly empty', () => {
    const html = purchaseOrderTemplate()?.contentHtml ?? ''
    // firstName and expectedAt (nullable, nothing prefills it) fall back; number/total do not.
    expect(html.match(/data-fallback=/g)).toHaveLength(2)
  })

  it('reads as an instruction to a supplier, not a sales document', () => {
    const template = purchaseOrderTemplate()
    expect(template?.title).toBe('Purchase order attached')
    expect(template?.content).toContain('Please find our purchase order')
    expect(template?.content).toContain('confirm receipt of this order and your expected ship date')
  })

  it('mirrors the quote/invoice mechanics — no hard-coded sign-off, plain-text twin', () => {
    const template = purchaseOrderTemplate()
    expect(template?.contentHtml).not.toMatch(/Best,|Regards|Thanks,/)
    // The plain-text mirror carries the same `{{id}}` tokens as the HTML spans.
    for (const token of ['def_contact:firstName', 'def_po:number', 'def_po:total']) {
      expect(template?.content).toContain(`{{${token}}}`)
    }
  })
})
