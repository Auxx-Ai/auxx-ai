// packages/lib/src/field-values/ai-autofill/index.ts

export {
  type AiValueMetadata,
  type GenerationResult,
  generateFieldValue,
} from './generation-service'
export { computeInputHash } from './input-hash'
export { buildJsonSchema, type JsonSchema } from './json-schema-builder'
export { type PreviewResult, previewFieldValue } from './preview-service'
export { type BuiltPrompt, buildPrompt } from './prompt-builder'
export { type ResolvedReference, resolveReferences } from './reference-resolver'
export { mintOrMatchTagOptions } from './tag-minting'
export {
  AI_TYPE_SPECS,
  type AiFieldContext,
  type AiNormalizeContext,
  type AiTypeSpec,
  allowsNewTagOptions,
  getAiTypeSpec,
  normalizeGeneratedValue,
} from './type-specs'
