// apps/web/src/lib/extensions/validate-dialog-content.ts

/**
 * Whitelist of allowed SDK component names.
 *
 * IMPORTANT: Only add components here that:
 * 1. Are part of the official SDK
 * 2. Have been vetted for security
 * 3. Match Auxx's design system
 * 4. Are properly styled by the platform
 */
const ALLOWED_COMPONENTS = new Set([
  // Typography Components
  'TextBlock',

  // Interactive Components
  'Button',

  // Display Components
  'Badge',
  'Banner',
  'Avatar',
  'AvatarImage',
  'AvatarFallback',
  'Separator',

  // Form Components
  'Input',
  'Label',
  'Textarea',
  'Checkbox',
  'Switch',

  // Select Components
  'Select',
  'SelectTrigger',
  'SelectValue',
  'SelectContent',
  'SelectItem',

  // Card Components
  'Card',
  'CardHeader',
  'CardTitle',
  'CardDescription',
  'CardContent',
  'CardFooter',

  // Alert Components
  'Alert',
  'AlertTitle',
  'AlertDescription',

  // React built-ins (safe)
  'Fragment',
  'Suspense',
])

/**
 * Validate that reconstructed dialog content only uses approved components.
 *
 * This provides defense-in-depth security against malicious extensions
 * attempting to inject unauthorized HTML/CSS.
 *
 * @throws {Error} If unauthorized components are detected
 */
export function validateDialogContent(node: any): void {
  if (!node) return

  // Handle arrays
  if (Array.isArray(node)) {
    node.forEach(validateDialogContent)
    return
  }

  // Handle text/number primitives
  if (typeof node === 'string' || typeof node === 'number') {
    return
  }

  // Handle instance nodes
  if (node.instance_type === 'instance') {
    const componentName = node.component

    // Check if component is allowed
    if (!ALLOWED_COMPONENTS.has(componentName)) {
      throw new Error(
        `Security violation: Extension attempted to use unauthorized component "${componentName}". ` +
          `Only approved SDK components are allowed in dialogs. ` +
          `See documentation for the list of approved components.`
      )
    }

    // Recursively validate children
    if (node.children) {
      validateDialogContent(node.children)
    }
  }

  // Handle children array
  if (node.children) {
    validateDialogContent(node.children)
  }
}
