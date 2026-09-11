// packages/lib/src/resources/registry/system-entity-behavior.ts

/**
 * One static, code-owned record per system `entityType` declaring six
 * independent behaviors, merged into `Resource` at the registry construction
 * site (`resource-registry-service.ts`). Replaces `EntityDefinition.isVisible`
 * and three hardcoded lists that reused it for unrelated decisions.
 *
 * A leaf module by design: imports nothing, so any caller (including the
 * frontend, via `resources/client.ts`) can take it without dragging in a
 * server-only dependency graph.
 *
 * See plans/entity/system-entity-behavior-map.md for the full design.
 */
export interface SystemEntityBehavior {
  /**
   * Reachable by the agent tools: `list_entities`, `list_entity_fields`,
   * `search_entities`, `create_entity`. NOT an access check -
   * `canViewEntity` / `hasDefPresence` still gate every def and the picker
   * still narrows per row.
   *
   * `false` is a hard wall, not a tidying. The allowlist closed the old
   * hand-typed-slug fallback (`list-entities.ts:105`), so an off def cannot be
   * reached even when the user names it. Use `inPromptCatalog` to keep the
   * prompt small; use this only when the agent genuinely may not have the data.
   */
  aiVisible: boolean

  /**
   * Preloaded into the system prompt's entity catalog (`agents/agent.ts:147`).
   * Implies nothing about reachability: a def that is `aiVisible` but not in
   * the catalog is still returned by `list_entities`, which the model calls on
   * demand. This is the axis to turn down when the prompt grows, NOT
   * `aiVisible`.
   *
   * Ignored when `aiVisible` is false.
   */
  inPromptCatalog: boolean

  /** In the global cmd+K search corpus (`kbar/pages/search.tsx`). */
  searchable: boolean

  /**
   * Offers a "Create <Entity>" affordance. Governs BOTH create doors: the
   * command palette (`kbar/actions/create.ts`) and the records page header
   * button (`records-view.tsx`, which previously gated on `canEdit` alone).
   * Composed with the permission rung, never instead of it.
   *
   * `false` means the record is minted by a system, not by a person. See
   * `parcel` below and plans/entity/system-entity-behavior-map.md §6b.
   *
   * 🔴 The default is DERIVED, not flat: absent an override it is
   * `sidebar !== 'never'`. That reproduces today's behavior exactly, since
   * `create.ts` filtered on `isVisible` and so already offered nothing for a
   * nav-hidden def. An explicit override always wins, which is how `parcel`
   * is `sidebar: 'off'` and still not creatable.
   */
  creatable: boolean

  /**
   * Records sidebar placement.
   *   'on'    - listed and checked by default
   *   'off'   - listed in Edit sidebar, UNCHECKED by default
   *   'never' - structural. No route page, not in the Edit list at all.
   */
  sidebar: 'on' | 'off' | 'never'

  /** Appears on Settings > Custom fields. Replaces `HIDDEN_ENTITY_TYPES`. */
  fieldsSettings: boolean
}

/**
 * `DEFAULTS` is permissive on purpose. A user-authored def has
 * `entityType === undefined` and falls straight through, so custom entities get
 * `aiVisible: true` with no rule to remember. That is also the fix for a newly
 * added system def being AI-visible unless someone writes down that it is not,
 * which is the opposite of the old `isVisible`-derived allowlist.
 */
export const DEFAULTS: Omit<SystemEntityBehavior, 'creatable'> = {
  aiVisible: true,
  inPromptCatalog: true,
  searchable: true,
  sidebar: 'on',
  fieldsSettings: true,
}

/**
 * Per-`entityType` overrides for the 34 system defs that differ from
 * {@link DEFAULTS}. The other 14 system defs (`contact`, `ticket`, `part`,
 * `company`, `product`, `order`, `quote`, `invoice`, `credit_memo`,
 * `purchase_order`, `vendor_bill`, `work_order`, `service_request`, `build`)
 * carry no entry here and resolve to pure `DEFAULTS`.
 *
 * See plans/entity/system-entity-behavior-map.md §5 for the full inventory and
 * the reasoning behind each row.
 *
 * 🔴 Bump `resources` in `cache/org-cache-keys.ts` on every edit here — the
 * resolved behavior is baked into the cached `Resource` blob at
 * `toCustomResourceBase` / `toSystemResourceBase`, so an edit without a
 * version bump serves the old behavior for up to the cache's TTL.
 */
export const SYSTEM_ENTITY_BEHAVIOR: Record<string, Partial<SystemEntityBehavior>> = {
  // §5.1 - structural (no name to render), reachable but not preloaded, five
  // exceptions genuinely off (child-of-parent or deliberate exclusions).
  line_item: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // already AI-visible today
  tax_line: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  },
  credit_memo_line: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  },
  credit_memo_application: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  },
  purchase_order_line: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // new to AI
  vendor_bill_line: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // new to AI
  stock_movement: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // new to AI; append-only ledger
  vendor_part: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // new to AI
  subpart: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
  }, // child of part, reach it through the parent
  vendor_payment_allocation: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
  }, // child of vendor_payment
  entity_group: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
    fieldsSettings: false,
  }, // infra, not a record
  signature: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
    fieldsSettings: false,
  }, // plan 36 closed this deliberately
  personal_inbox: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
    fieldsSettings: false,
  }, // private by construction

  // §5.2 - own door, not the sidebar: real records with a dedicated page.
  gl_account: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Accounting > Settings > Accounts
  journal_entry: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Accounting > Ledger
  bank_account: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Accounting > Settings > Bank accounts
  bank_transaction: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // For Review queue
  bank_deposit: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Accounting
  payout: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Accounting
  payment_gateway: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Accounting > Settings
  payment: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // invoice drawer; already AI-visible
  vendor_payment: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // new to AI
  tariff_code: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // new to AI
  tariff_rate: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
  }, // child of tariff_code
  bank_rule: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
  }, // automation config, not a record a user asks about
  catalog_item: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // dispatch settings; already AI-visible
  catalog_group: {
    searchable: false,
    inPromptCatalog: false,
    sidebar: 'never',
  }, // dispatch settings; already AI-visible
  inbox: {
    sidebar: 'never',
    fieldsSettings: false,
  }, // mail; already AI-visible
  tag: {
    searchable: false,
    sidebar: 'never',
    fieldsSettings: false,
  }, // already AI-visible
  meeting: {
    inPromptCatalog: false,
    sidebar: 'never',
  }, // Meetings page; already AI-visible
  article: {
    aiVisible: false,
    sidebar: 'never',
  }, // own tools + pass-through gate
  thread: {
    searchable: false,
    aiVisible: false,
    sidebar: 'never',
  }, // mail lens, §4.4 - `isAiBlockedResource` enforces this independently too

  // §5.3 - hidden by default, checkable in Edit sidebar. `sidebar: 'off'` is
  // safe here ONLY because `app/shipments/` and `app/parcels/` exist: migration
  // 110 warns that a def made visible with no route folder 404s its nav entry.
  // These two are the only defs where the behavior map intentionally departs
  // from today's `isVisible`, so they are the documented exceptions in the
  // no-op test.
  shipment: {
    sidebar: 'off',
    fieldsSettings: false,
  }, // support agents ask about shipments constantly; creatable derives true, a merchant raising a dispatch by hand is coherent
  parcel: {
    searchable: false,
    creatable: false,
    sidebar: 'off',
    fieldsSettings: false,
  }, // plan §6 (tracking numbers flood the corpus) and §6b (carrier-minted, never hand-created)
}

/**
 * Resolve the behavior for a system `entityType`. A `null`/`undefined`
 * `entityType` names a user-authored def and gets pure {@link DEFAULTS} - there
 * is no rule to remember for a custom entity.
 */
/**
 * The base for a TABLE-BACKED system resource (`RESOURCE_TABLE_REGISTRY`:
 * `thread`, `message`, `user`, `dataset`, `dashboard`, `workflow`, `kb`,
 * `sequence`, ...), as opposed to an `EntityDefinition`-backed def.
 *
 * 🛑 **Restrictive, and that is load-bearing.** These rows previously carried a
 * hardcoded `isVisible: false` in `toSystemResourceBase`, which is what kept
 * them out of the AI catalog under the old
 * `isVisible !== false || allowlist.has(key)` rule. Resolving them through the
 * permissive {@link DEFAULTS} instead would hand the model `dataset`,
 * `dashboard`, `workflow`, `kb` and `sequence` - and those are exactly the defs
 * that have NO def-level gate to fall back on: they are
 * `NON_RECORD_DEF_SLUGS`, so `canViewEntity` is an unconditional pass-through
 * for every one of them.
 *
 * The module this replaced warned about precisely this: "for the ten
 * `NON_RECORD_DEF_SLUGS` there is no def-level gate at all, so it would
 * advertise threads, messages, datasets, articles, dashboards and workflows
 * through a gate that always returns true."
 *
 * A table-backed resource that SHOULD be reachable opts in by name through
 * {@link SYSTEM_ENTITY_BEHAVIOR}, never by relaxing this base.
 */
const TABLE_BACKED_BASE: SystemEntityBehavior = {
  aiVisible: false,
  inPromptCatalog: false,
  searchable: false,
  creatable: false,
  sidebar: 'never',
  fieldsSettings: false,
}

/**
 * Behavior for a table-backed system resource. Same override map, restrictive
 * base. Call this from `toSystemResourceBase`; call
 * {@link resolveSystemEntityBehavior} for `EntityDefinition`-backed defs.
 */
export function resolveTableBackedBehavior(tableId: string): SystemEntityBehavior {
  return { ...TABLE_BACKED_BASE, ...(SYSTEM_ENTITY_BEHAVIOR[tableId] ?? {}) }
}

export function resolveSystemEntityBehavior(
  entityType: string | null | undefined
): SystemEntityBehavior {
  const override = entityType ? (SYSTEM_ENTITY_BEHAVIOR[entityType] ?? {}) : {}
  const merged = { ...DEFAULTS, ...override }
  return {
    ...merged,
    // Derived, and overridable. See the `creatable` docblock for why a flat
    // `true` would newly offer "Create GL Account" in the palette.
    creatable: override.creatable ?? merged.sidebar !== 'never',
  }
}
