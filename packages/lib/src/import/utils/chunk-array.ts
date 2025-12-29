// packages/lib/src/import/utils/chunk-array.ts

/**
 * Split an array into chunks of a specified size.
 *
 * @param array - Array to split
 * @param size - Maximum chunk size
 * @returns Array of chunks
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  if (size <= 0) {
    throw new Error('Chunk size must be positive')
  }

  const chunks: T[][] = []

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size))
  }

  return chunks
}
