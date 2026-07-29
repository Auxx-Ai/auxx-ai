// apps/web/src/components/signatures/hooks/index.ts

// Re-export types from @auxx/types/signature for convenience
export type { SignatureItem } from '@auxx/types/signature'
export { useDefaultSignature, useSignature, useSignatures } from './use-signature'
export { type SignatureAccess, useSignatureAccess } from './use-signature-access'
export { useSignatureMutations } from './use-signature-mutations'
