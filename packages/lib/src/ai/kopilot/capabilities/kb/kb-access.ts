// packages/lib/src/ai/kopilot/capabilities/kb/kb-access.ts

/**
 * Instance-access READ gate for the Kopilot KB tools (permissions v2 §3.3).
 *
 * 🔴 **This file no longer implements the rule — it names it** (plan v3/06 P5,
 * implementation I2). It used to spell the KB-inheritance check itself
 * (`capabilities.canViewInstance('kb', kbId)`), which was one of six independent
 * spellings across the tree. The single authoring point is now
 * `permissions/capabilities/article-read-access.ts`; everything below is a
 * re-export whose only job is to keep the Kopilot-specific *semantics* documented
 * at the place the tools import from.
 *
 * **Silent-filter semantics.** Reads keep what humans get: a KB the principal
 * can't view is reported as "not found" / dropped from a list, never as a 403.
 * Write gates are the opposite — they `assertEditInstance` and throw, so the
 * model can explain the denial. See `tools/write-helpers.ts`, which stays
 * **home-strict** and must NOT be converged onto the read rule (§7.3).
 *
 * **`capabilities === undefined` ⇒ unrestricted** (the workflow AI node is the
 * one remaining un-threaded caller), preserved by the shared module.
 *
 * ⚠ **Behaviour change, deliberate:** the shared rule also applies the `kind`
 * policy, so `kind: 'source'` KBs are no longer readable through these tools
 * whatever the grants say (§6.1). Source KBs are hidden `KnowledgeSource`
 * containers with no editor; their content still reaches answering agents
 * through `search_knowledge`'s managed datasets, which this plan deliberately
 * does not narrow (§8.2).
 */

export {
  type ArticleReadScope,
  canReadArticle,
  canReadKnowledgeBase,
  resolveArticleReadScope,
} from '../../../../permissions/capabilities/article-read-access'
