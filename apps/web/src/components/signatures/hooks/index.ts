// apps/web/src/components/signatures/hooks/index.ts

export { useSignatures, useSignature, useDefaultSignature } from './use-signature'
export { useSignatureMutations } from './use-signature-mutations'

// Re-export types from @auxx/types/signature for convenience
export type { SignatureItem, SignatureRecord, SignatureVisibility } from '@auxx/types/signature'
