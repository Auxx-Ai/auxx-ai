// apps/web/src/components/workflow/utils/branch-name-correct.ts

/**
 * Assigns display names to a node's outgoing branches.
 *
 * Two branches read as IF/ELSE; three or more read as CASE n/ELSE. The `false`
 * branch is always the ELSE. Generic over the branch shape so callers that carry
 * extra fields (e.g. `type`) keep them on the result.
 */
export const branchNameCorrect = <T extends { id: string; name: string }>(branches: T[]): T[] => {
  const branchLength = branches.length
  if (branchLength < 2) throw new Error('if-else node branch number must than 2')

  if (branchLength === 2) {
    return branches.map((branch) => {
      return { ...branch, name: branch.id === 'false' ? 'ELSE' : 'IF' }
    })
  }

  return branches.map((branch, index) => {
    return { ...branch, name: branch.id === 'false' ? 'ELSE' : `CASE ${index + 1}` }
  })
}
