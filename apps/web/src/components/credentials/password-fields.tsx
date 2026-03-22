import type { Input } from '@auxx/ui/components/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@auxx/ui/components/input-group'
import { cn } from '@auxx/ui/lib/utils'
import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from 'lucide-react'
import { useId, useMemo, useState } from 'react'

export function PasswordInput({
  variant,
  size,
  ...props
}: React.ComponentProps<typeof Input> & {
  variant?: 'default' | 'translucent'
  size?: React.ComponentProps<typeof Input>['size']
}) {
  const id = useId()
  const [isVisible, setIsVisible] = useState<boolean>(false)

  const toggleVisibility = () => setIsVisible((prevState) => !prevState)

  return (
    <div className='*:not-first:mt-2'>
      <InputGroup variant={variant} className={cn(size === 'lg' && 'h-9')}>
        <InputGroupInput
          {...props}
          id={id}
          type={isVisible ? 'text' : 'password'}
          className={cn(size === 'lg' && 'text-lg', props.className)}
        />
        <InputGroupAddon align='inline-end'>
          <InputGroupButton
            aria-label={isVisible ? 'Hide password' : 'Show password'}
            aria-pressed={isVisible}
            size='icon-xs'
            className='rounded-lg me-1 hover:bg-white/20 hover:text-white'
            onClick={toggleVisibility}>
            {isVisible ? (
              <EyeOffIcon size={16} aria-hidden='true' />
            ) : (
              <EyeIcon size={16} aria-hidden='true' />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

/**
 * Password field component with strength indicator
 * @param password - Current password value
 * @param setPassword - Function to update password value
 */
function PasswordField({
  password,
  setPassword,
  variant,
  size,
}: {
  password: string
  setPassword: React.Dispatch<React.SetStateAction<string>>
  variant?: 'default' | 'translucent'
  size?: React.ComponentProps<typeof Input>['size']
}): JSX.Element {
  const id = useId()
  const [isVisible, setIsVisible] = useState<boolean>(false)

  const toggleVisibility = () => setIsVisible((prevState) => !prevState)

  return (
    <div>
      {/* Password input field with toggle visibility button */}
      <InputGroup variant={variant} className={cn(size === 'lg' && 'h-9')}>
        <InputGroupInput
          id={id}
          placeholder='Password'
          type={isVisible ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby={`${id}-description`}
          className={cn(size === 'lg' && 'text-lg')}
        />
        <InputGroupAddon align='inline-end'>
          <InputGroupButton
            aria-label={isVisible ? 'Hide password' : 'Show password'}
            aria-pressed={isVisible}
            size='icon-xs'
            className='rounded-lg me-1 hover:bg-white/20 hover:text-white'
            onClick={toggleVisibility}>
            {isVisible ? (
              <EyeOffIcon size={16} aria-hidden='true' />
            ) : (
              <EyeIcon size={16} aria-hidden='true' />
            )}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <PasswordStrengthIndicator password={password} variant={variant} />
    </div>
  )
}

/**
 * Password field component with strength indicator
 * @param password - Current password value
 * @param setPassword - Function to update password value
 */
function PasswordStrengthIndicator({
  password,
  confirmPassword,
  variant = 'default',
}: {
  password: string
  confirmPassword?: string
  variant?: 'default' | 'translucent'
}): JSX.Element {
  const id = useId()

  const checkStrength = (pass: string) => {
    const requirements = [
      { regex: /.{8,}/, text: 'At least 8 characters' },
      { regex: /[0-9]/, text: 'At least 1 number' },
      { regex: /[a-z]/, text: 'At least 1 lowercase letter' },
      { regex: /[A-Z]/, text: 'At least 1 uppercase letter' },
    ]

    return requirements.map((req) => ({ met: req.regex.test(pass), text: req.text }))
  }

  const strength = checkStrength(password)

  const strengthScore = useMemo(() => {
    return strength.filter((req) => req.met).length
  }, [strength])

  const getStrengthColor = (score: number) => {
    if (score === 0) return 'bg-border'
    if (score <= 1) return 'bg-red-500'
    if (score <= 2) return 'bg-orange-500'
    if (score === 3) return 'bg-amber-500'
    return 'bg-emerald-500'
  }

  const getStrengthText = (score: number) => {
    if (score === 0) return 'Enter a password'
    if (score <= 2) return 'Weak password'
    if (score === 3) return 'Medium password'
    return 'Strong password'
  }

  return (
    <div className=''>
      {/* Password strength indicator */}
      <div
        className={cn(
          'mt-3 mb-4 h-1 w-full overflow-hidden rounded-full',
          variant === 'translucent' ? 'bg-white/40' : 'bg-border'
        )}
        role='progressbar'
        aria-valuenow={strengthScore}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label='Password strength'>
        <div
          className={cn(
            'h-full transition-all duration-500 ease-out',
            getStrengthColor(strengthScore)
          )}
          style={{ width: `${(strengthScore / 4) * 100}%` }}></div>
      </div>

      {/* Password strength description */}
      <p
        id={`${id}-description`}
        className={cn(
          'mb-2 text-sm font-medium',
          variant === 'translucent' ? 'text-white' : 'text-foreground'
        )}>
        {getStrengthText(strengthScore)}. Must contain:
      </p>

      {/* Password requirements list */}
      <ul className='space-y-1.5' aria-label='Password requirements'>
        {strength.map((req, index) => (
          <li key={index} className='flex items-center gap-2'>
            {req.met ? (
              <CheckIcon className='text-emerald-500 size-4' aria-hidden='true' />
            ) : (
              <XIcon
                className={cn(
                  'size-4',
                  variant === 'translucent' ? 'text-white/50' : 'text-muted-foreground/80'
                )}
                aria-hidden='true'
              />
            )}
            <span
              className={cn(
                'text-xs',
                req.met
                  ? 'text-emerald-600'
                  : variant === 'translucent'
                    ? 'text-white/50'
                    : 'text-muted-foreground'
              )}>
              {req.text}
              <span className='sr-only'>
                {req.met ? ' - Requirement met' : ' - Requirement not met'}
              </span>
            </span>
          </li>
        ))}
        {confirmPassword !== undefined && (
          <li className='flex items-center gap-2'>
            {password === confirmPassword && password.length > 0 ? (
              <CheckIcon className='text-emerald-500 size-4' aria-hidden='true' />
            ) : (
              <XIcon
                className={cn(
                  'size-4',
                  variant === 'translucent' ? 'text-white/50' : 'text-muted-foreground/80'
                )}
                aria-hidden='true'
              />
            )}
            <span
              className={cn(
                'text-xs',
                password === confirmPassword && password.length > 0
                  ? 'text-emerald-600'
                  : variant === 'translucent'
                    ? 'text-white/50'
                    : 'text-muted-foreground'
              )}>
              Passwords match
              <span className='sr-only'>
                {password === confirmPassword && password.length > 0
                  ? ' - Requirement met'
                  : ' - Requirement not met'}
              </span>
            </span>
          </li>
        )}
      </ul>
    </div>
  )
}

export { PasswordField, PasswordStrengthIndicator }
