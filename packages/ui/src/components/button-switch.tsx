// apps/web/src/components/ui/button-switch.tsx
'use client'

import { buttonVariants } from '@auxx/ui/components/button'
import { Switch, type SwitchProps } from '@auxx/ui/components/switch'
import { cn } from '@auxx/ui/lib/utils'
import type { VariantProps } from 'class-variance-authority'

/** Button styling that can be merged over the defaults (`variant: 'ghost'`, matched `size`). */
type ButtonVariantProps = VariantProps<typeof buttonVariants>

export interface ButtonSwitchProps {
  /** Text shown to the left of the switch. */
  label: string
  /** Controlled checked state. */
  checked: boolean
  /** Fired when the switch is toggled. */
  onCheckedChange: (value: boolean) => void
  /** Disables the label + switch and dims it. */
  disabled?: boolean
  /** Drives both the {@link Switch} and the wrapping button size. Defaults to `sm`. */
  size?: SwitchProps['size']
  /** Extra classes on the wrapping label. */
  className?: string
  /** `buttonVariants` overrides merged over the defaults (e.g. a different `variant`). */
  buttonProps?: ButtonVariantProps
}

/**
 * A button-styled `<label>` wrapping a caption and a {@link Switch} — the compact
 * toolbar toggle used for "Show snoozed", "Overrides only", etc. Clicking anywhere
 * on the label flips the switch. Defaults to a ghost button whose size tracks the
 * switch; pass `buttonProps` to merge over those defaults.
 */
function ButtonSwitch({
  label,
  checked,
  onCheckedChange,
  disabled = false,
  size = 'sm',
  className,
  buttonProps,
}: ButtonSwitchProps) {
  return (
    <label
      className={buttonVariants({
        variant: 'ghost',
        size,
        ...buttonProps,
        className: cn(
          'gap-2',
          disabled ? 'pointer-events-none opacity-50' : 'cursor-pointer',
          className
        ),
      })}>
      <span className='text-muted-foreground text-xs'>{label}</span>
      <Switch size={size} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </label>
  )
}
ButtonSwitch.displayName = 'ButtonSwitch'

export { ButtonSwitch }
