// packages/lib/src/datasets/services/__tests__/dataset-embedding-validator.test.ts

import { DatasetEmbeddingValidator } from '../dataset-embedding-validator'

describe('DatasetEmbeddingValidator', () => {
  describe('getDefaultEmbeddingConfig', () => {
    it('should return default configuration', () => {
      const config = DatasetEmbeddingValidator.getDefaultEmbeddingConfig()

      expect(config).toEqual({
        modelId: 'openai:text-embedding-3-small',
        dimensions: 1536,
      })
    })
  })

  describe('getModelDimensions', () => {
    it('should return correct dimensions for known models', () => {
      expect(DatasetEmbeddingValidator.getModelDimensions('text-embedding-3-small')).toBe(1536)
      expect(DatasetEmbeddingValidator.getModelDimensions('text-embedding-3-large')).toBe(3072)
      expect(DatasetEmbeddingValidator.getModelDimensions('text-embedding-ada-002')).toBe(1536)
    })

    it('should return default dimensions for unknown models', () => {
      expect(DatasetEmbeddingValidator.getModelDimensions('unknown-model')).toBe(1536)
    })
  })
})
