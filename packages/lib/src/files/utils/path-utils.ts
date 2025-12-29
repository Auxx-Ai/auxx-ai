// packages/lib/src/files/utils/path-utils.ts

/**
 * Path manipulation utilities for file and folder operations
 */

/**
 * Normalize a path string to use forward slashes and remove redundant separators
 */
export function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/') // Convert backslashes to forward slashes
    .replace(/\/+/g, '/') // Remove duplicate slashes
    .replace(/\/$/, '') // Remove trailing slash
    || '/' // Default to root if empty
}

/**
 * Join multiple path segments into a single path
 */
export function joinPaths(...segments: (string | null | undefined)[]): string {
  const validSegments = segments
    .filter((segment): segment is string => segment != null)
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)

  if (validSegments.length === 0) {
    return '/'
  }

  let result = validSegments.join('/')
  
  // Ensure it starts with /
  if (!result.startsWith('/')) {
    result = '/' + result
  }

  return normalizePath(result)
}

/**
 * Get the parent path of a given path
 */
export function getParentPath(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return '/'
  }

  const lastSlashIndex = normalized.lastIndexOf('/')
  if (lastSlashIndex <= 0) {
    return '/'
  }

  return normalized.substring(0, lastSlashIndex) || '/'
}

/**
 * Get the name (last segment) of a path
 */
export function getPathName(path: string): string {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return ''
  }

  const lastSlashIndex = normalized.lastIndexOf('/')
  return normalized.substring(lastSlashIndex + 1)
}

/**
 * Split a path into its segments
 */
export function splitPath(path: string): string[] {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return []
  }

  return normalized.split('/').filter(segment => segment.length > 0)
}

/**
 * Check if one path is a descendant of another
 */
export function isDescendantPath(childPath: string, parentPath: string): boolean {
  if (childPath === parentPath) {
    return false // Not a descendant, it's the same path
  }

  const normalizedChild = normalizePath(childPath)
  const normalizedParent = normalizePath(parentPath)

  // Root is parent of everything except itself
  if (normalizedParent === '/') {
    return normalizedChild !== '/'
  }

  return normalizedChild.startsWith(normalizedParent + '/')
}

/**
 * Check if one path is an ancestor of another
 */
export function isAncestorPath(parentPath: string, childPath: string): boolean {
  return isDescendantPath(childPath, parentPath)
}

/**
 * Get the relative path from one path to another
 */
export function getRelativePath(fromPath: string, toPath: string): string {
  const normalizedFrom = normalizePath(fromPath)
  const normalizedTo = normalizePath(toPath)

  if (normalizedFrom === normalizedTo) {
    return '.'
  }

  const fromSegments = splitPath(normalizedFrom)
  const toSegments = splitPath(normalizedTo)

  // Find common prefix
  let commonLength = 0
  const minLength = Math.min(fromSegments.length, toSegments.length)
  
  for (let i = 0; i < minLength; i++) {
    if (fromSegments[i] === toSegments[i]) {
      commonLength++
    } else {
      break
    }
  }

  // Build relative path
  const upSteps = fromSegments.length - commonLength
  const downSteps = toSegments.slice(commonLength)

  const relativeParts: string[] = []
  
  // Add .. for each level up
  for (let i = 0; i < upSteps; i++) {
    relativeParts.push('..')
  }
  
  // Add down path segments
  relativeParts.push(...downSteps)

  return relativeParts.length > 0 ? relativeParts.join('/') : '.'
}

/**
 * Get the common ancestor path of multiple paths
 */
export function getCommonAncestorPath(paths: string[]): string {
  if (paths.length === 0) {
    return '/'
  }

  if (paths.length === 1) {
    return getParentPath(paths[0])
  }

  const segmentArrays = paths.map(path => splitPath(path))
  const minLength = Math.min(...segmentArrays.map(segments => segments.length))

  let commonSegments: string[] = []

  for (let i = 0; i < minLength; i++) {
    const segment = segmentArrays[0][i]
    const allMatch = segmentArrays.every(segments => segments[i] === segment)
    
    if (allMatch) {
      commonSegments.push(segment)
    } else {
      break
    }
  }

  return commonSegments.length > 0 ? '/' + commonSegments.join('/') : '/'
}

/**
 * Calculate the depth of a path (number of segments)
 */
export function getPathDepth(path: string): number {
  const normalized = normalizePath(path)
  if (normalized === '/') {
    return 0
  }

  return splitPath(normalized).length
}

/**
 * Generate a unique path by appending a number if the path already exists
 */
export function generateUniquePath(
  basePath: string,
  existingPaths: Set<string>,
  maxAttempts = 1000
): string {
  let path = basePath
  let counter = 1

  while (existingPaths.has(path) && counter <= maxAttempts) {
    const parentPath = getParentPath(basePath)
    const name = getPathName(basePath)
    const lastDotIndex = name.lastIndexOf('.')
    
    if (lastDotIndex > 0) {
      // Has extension
      const nameWithoutExt = name.substring(0, lastDotIndex)
      const extension = name.substring(lastDotIndex)
      path = joinPaths(parentPath, `${nameWithoutExt} (${counter})${extension}`)
    } else {
      // No extension
      path = joinPaths(parentPath, `${name} (${counter})`)
    }
    
    counter++
  }

  if (counter > maxAttempts) {
    throw new Error(`Could not generate unique path after ${maxAttempts} attempts`)
  }

  return path
}

/**
 * Validate that a path is safe (no directory traversal attempts)
 */
export function validateSafePath(path: string): { isValid: boolean; errors: string[] } {
  const errors: string[] = []

  // Check for directory traversal attempts
  if (path.includes('..')) {
    errors.push('Path cannot contain ".." (directory traversal)')
  }

  // Check for absolute paths that try to escape the root
  if (path.startsWith('//') || path.includes('\\')) {
    errors.push('Invalid path format')
  }

  // Check for null bytes
  if (path.includes('\0')) {
    errors.push('Path cannot contain null bytes')
  }

  // Check for control characters
  if (/[\x00-\x1f\x7f]/.test(path)) {
    errors.push('Path cannot contain control characters')
  }

  return {
    isValid: errors.length === 0,
    errors
  }
}

/**
 * Sanitize a path by removing dangerous elements
 */
export function sanitizePath(path: string): string {
  return normalizePath(
    path
      .replace(/\.\./g, '') // Remove directory traversal
      .replace(/[\x00-\x1f\x7f]/g, '') // Remove control characters
      .replace(/\\/g, '/') // Normalize separators
  )
}

/**
 * Check if a path matches a glob pattern (simple implementation)
 */
export function matchesGlob(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/\*\*/g, '.*') // ** matches any number of directories
    .replace(/\*/g, '[^/]*') // * matches any characters except /
    .replace(/\?/g, '[^/]') // ? matches any single character except /
    .replace(/\./g, '\\.') // Escape dots

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(normalizePath(path))
}

/**
 * Get all paths that would be affected by moving a folder
 */
export function getAffectedPaths(oldPath: string, newPath: string, allPaths: string[]): {
  updated: Array<{ old: string; new: string }>
  conflicts: string[]
} {
  const normalizedOldPath = normalizePath(oldPath)
  const normalizedNewPath = normalizePath(newPath)
  
  const updated: Array<{ old: string; new: string }> = []
  const conflicts: string[] = []

  for (const path of allPaths) {
    const normalizedPath = normalizePath(path)
    
    if (normalizedPath === normalizedOldPath) {
      // This is the path being moved
      updated.push({ old: normalizedPath, new: normalizedNewPath })
    } else if (normalizedPath.startsWith(normalizedOldPath + '/')) {
      // This is a descendant path
      const relativePart = normalizedPath.substring(normalizedOldPath.length)
      const newDescendantPath = normalizedNewPath + relativePart
      updated.push({ old: normalizedPath, new: newDescendantPath })
    }
  }

  // Check for conflicts
  const newPaths = new Set(updated.map(u => u.new))
  for (const path of allPaths) {
    const normalizedPath = normalizePath(path)
    if (newPaths.has(normalizedPath) && !updated.some(u => u.old === normalizedPath)) {
      conflicts.push(normalizedPath)
    }
  }

  return { updated, conflicts }
}