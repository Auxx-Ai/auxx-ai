// packages/lib/src/ai/quota/client.ts
//
// Client-safe quota exports. The `./ai/quota` barrel pulls in QuotaService
// (drizzle, server-only); UI code imports the pure credit/cost math from here.

export { CREDIT_USD_VALUE, UNPRICED_FALLBACK_CREDITS, usdToCredits } from './credit-conversion'
export {
  blendedCostPer1kTokens,
  type CostPer1kTokens,
  type CostTier,
  creditsPer1kInputTokens,
  creditsPer1kOutputTokens,
  getModelCostTier,
} from './model-cost'
