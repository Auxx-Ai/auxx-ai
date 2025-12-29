// packages/sdk/src/util/find-surface-exports/parse-file-exports.ts
import { SyntaxKind, type Node, type SourceFile, type Symbol as MorphSymbol, type Type, type TypeChecker } from 'ts-morph'
import { SURFACE_TYPES } from '../generate-app-entry-point.js'
import { getSurfaceTypeName } from './surface-types.js'

/**
 * Union type representing all valid surface type names.
 * Derived from the SURFACE_TYPES array constant.
 */
export type SurfaceType = (typeof SURFACE_TYPES)[number]

/**
 * Represents a discovered surface export containing its type and unique identifier.
 */
export type SurfaceExport = {
  /** The type of surface (e.g., 'recordAction', 'workflowBlock') */
  surfaceType: SurfaceType
  /** The unique identifier for this surface instance */
  id: string
}

/**
 * Maps each surface type name to its corresponding ts-morph Type instance.
 * Used for runtime type validation of surface exports against their expected interfaces.
 */
export type SurfaceTypesMap = Record<SurfaceType, Type>

/**
 * Parameters required for parsing surface exports from a source file.
 */
type ParseFileExportsParams = {
  /** The ts-morph source file to analyze */
  sourceFile: SourceFile
  /** Set of already-discovered export symbols to prevent duplicates */
  existingExportSymbols: Set<MorphSymbol>
  /** Set of already-used surface IDs to enforce uniqueness */
  existingIds: Set<string>
  /** TypeChecker instance for type validation */
  typeChecker: TypeChecker
  /** Map of surface type names to their Type definitions */
  surfaceTypes: SurfaceTypesMap
}

/**
 * Determines whether the given source file uses TypeScript syntax.
 *
 * @param sourceFile - The ts-morph source file to check
 * @returns True if the file has a .ts or .tsx extension, false otherwise
 */
const isTypeScript = (sourceFile: SourceFile): boolean => {
  const fileName = sourceFile.getBaseName()
  return fileName.endsWith('.ts') || fileName.endsWith('.tsx')
}

/**
 * Parses a source file and extracts valid surface exports while enforcing type safety constraints.
 *
 * This function performs the following operations:
 * - Scans the source file for exports matching known surface type names
 * - Validates TypeScript exports against their expected interface types
 * - Ensures all surface IDs are unique across the entire codebase
 * - Extracts the 'id' property from each surface declaration
 * - Tracks discovered symbols to prevent duplicate processing
 *
 * @param params - Configuration object containing source file and validation state
 * @returns Set of discovered SurfaceExport objects from this file
 * @throws Error object with structured error information if:
 *   - A surface export doesn't match its expected type signature
 *   - A duplicate surface ID is found
 *   - A surface export is not properly structured as an object literal
 *   - Required properties are missing or have invalid values
 *
 * @example
 * ```typescript
 * const exports = parseFileExports({
 *   sourceFile,
 *   existingExportSymbols: new Set(),
 *   existingIds: new Set(),
 *   typeChecker,
 *   surfaceTypes
 * });
 * ```
 */
export function parseFileExports({
  sourceFile,
  existingExportSymbols,
  existingIds,
  typeChecker,
  surfaceTypes,
}: ParseFileExportsParams): Set<SurfaceExport> {
  const surfaceExports: Set<SurfaceExport> = new Set()
  const filePath = sourceFile.getFilePath()

  /**
   * Retrieves the original declaration symbol, accounting for re-exported or aliased symbols.
   *
   * When a symbol is re-exported from another module, this function follows the chain
   * to find the original declaration symbol.
   *
   * @param declaration - The AST node to get the symbol from
   * @returns The original (non-aliased) symbol, or undefined if no symbol is found
   */
  function getOriginalDeclarationSymbol(declaration: Node): MorphSymbol | undefined {
    const declarationSymbol = declaration.getSymbol()
    if (!declarationSymbol) {
      return undefined
    }
    const aliasedSymbol = typeChecker.getAliasedSymbol(declarationSymbol)
    return aliasedSymbol ?? declarationSymbol
  }
  const declarationsByName = sourceFile.getExportedDeclarations()
  for (const surfaceType of SURFACE_TYPES) {
    const declarations = declarationsByName.get(surfaceType)
    if (!declarations) {
      continue
    }
    const declaration = declarations[0]!
    const originalSymbol = getOriginalDeclarationSymbol(declaration)
    if (!originalSymbol) {
      continue
    }
    if (existingExportSymbols.has(originalSymbol)) {
      continue
    }
    const exportType = declaration.getType()
    // Skip processing if the precomputed surface type definition is unavailable.
    const surfaceTypeDefinition = surfaceTypes[surfaceType]
    if (!surfaceTypeDefinition) {
      continue
    }
    if (
      isTypeScript(sourceFile) &&
      !typeChecker.isTypeAssignableTo(exportType, surfaceTypeDefinition)
    ) {
      const node = declaration.getFirstChild() || declaration
      throw {
        errors: [
          {
            text: `${surfaceType} in ${filePath} is not assignable to ${getSurfaceTypeName(surfaceType)}`,
            location: {
              file: filePath,
              line: node.getStartLineNumber(),
              column: 0,
              lineText: declaration.getText().split('\n')[0],
              additionalLines: declaration.getText().split('\n').slice(1),
              length: node.getWidth(),
              namespace: surfaceType,
              suggestion: `Ensure the export matches the type ${getSurfaceTypeName(surfaceType)}`,
            },
          },
        ],
      }
    }

    /**
     * Extracts a string property value from a surface declaration's object literal.
     *
     * This function enforces strict structural requirements:
     * - The declaration must be a variable declaration
     * - It must be initialized with an object literal expression
     * - The property must be directly declared (not computed or spread)
     * - The property value must be a string literal (not a computed value)
     *
     * @param propertyName - The name of the property to extract (e.g., 'id', 'label')
     * @returns The string value of the property
     * @throws Error if any structural requirement is violated, with a descriptive message
     */
    function getPropertyValueOrThrow(propertyName: string): string {
      if (declaration.getKind() !== SyntaxKind.VariableDeclaration) {
        throw new Error(`${surfaceType} is not an object in ${filePath} ${declaration.getKind()}`)
      }
      const initializer = declaration.asKindOrThrow(SyntaxKind.VariableDeclaration).getInitializer()
      if (initializer?.getKind() !== SyntaxKind.ObjectLiteralExpression) {
        throw new Error(
          `${surfaceType} must be defined as an object literal expression in ${filePath}`
        )
      }
      const objectLiteral = initializer.asKindOrThrow(SyntaxKind.ObjectLiteralExpression)
      const property = objectLiteral.getProperty(propertyName)
      if (property?.getKind() !== SyntaxKind.PropertyAssignment) {
        throw new Error(
          `Property ${propertyName} on ${surfaceType} must be directly declared in the object declaration in ${filePath}`
        )
      }
      const propertyInitializer = property
        .asKindOrThrow(SyntaxKind.PropertyAssignment)
        .getInitializer()
      if (propertyInitializer?.getKind() !== SyntaxKind.StringLiteral) {
        throw new Error(
          `Property ${propertyName} on ${surfaceType} must be a string literal in ${filePath}`
        )
      }
      return propertyInitializer.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
    }
    const surfaceId = getPropertyValueOrThrow('id')
    if (existingIds.has(surfaceId)) {
      throw {
        errors: [
          {
            text: `Duplicate surface id ${surfaceId}`,
            location: {
              file: filePath,
              line: declaration.getStartLineNumber(),
              column: 0,
              length: declaration.getWidth(),
              lineText: declaration.getText().split('\n')[0],
              additionalLines: declaration.getText().split('\n').slice(1),
              namespace: surfaceType,
              suggestion: `Ensure the id is unique`,
            },
          },
        ],
      }
    }
    existingExportSymbols.add(originalSymbol)
    existingIds.add(surfaceId)
    surfaceExports.add({ surfaceType, id: surfaceId })
  }
  return surfaceExports
}
