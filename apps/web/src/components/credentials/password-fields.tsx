import { EyeIcon, EyeOffIcon, CheckIcon, XIcon } from 'lucide-react'
import { useId, useState, useMemo } from 'react'
import { Input } from '@auxx/ui/components/input'

export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const id = useId()
  const [isVisible, setIsVisible] = useState<boolean>(false)

  const toggleVisibility = () => setIsVisible((prevState) => !prevState)

  return (
    <div className="*:not-first:mt-2">
      <div className="relative">
        <Input {...props} id={id} className="pe-9" type={isVisible ? 'text' : 'password'} />
        <button
          className="text-muted-foreground/80 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-none focus:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          onClick={toggleVisibility}
          aria-label={isVisible ? 'Hide password' : 'Show password'}
          aria-pressed={isVisible}
          aria-controls="password">
          {isVisible ? (
            <EyeOffIcon size={16} aria-hidden="true" />
          ) : (
            <EyeIcon size={16} aria-hidden="true" />
          )}
        </button>
      </div>
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
}: {
  password: string
  setPassword: React.Dispatch<React.SetStateAction<string>>
}): JSX.Element {
  const id = useId()
  const [isVisible, setIsVisible] = useState<boolean>(false)

  const toggleVisibility = () => setIsVisible((prevState) => !prevState)

  return (
    <div>
      {/* Password input field with toggle visibility button */}
      <div className="not-first:*:mt-2">
        <div className="relative">
          <Input
            id={id}
            className="pe-9"
            placeholder="Password"
            type={isVisible ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-describedby={`${id}-description`}
          />
          <button
            className="text-muted-foreground/80 hover:text-foreground focus-visible:border-ring focus-visible:ring-ring/50 absolute inset-y-0 end-0 flex h-full w-9 items-center justify-center rounded-e-md transition-[color,box-shadow] outline-hidden focus:z-10 focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={toggleVisibility}
            aria-label={isVisible ? 'Hide password' : 'Show password'}
            aria-pressed={isVisible}
            aria-controls="password">
            {isVisible ? (
              <EyeOffIcon size={16} aria-hidden="true" />
            ) : (
              <EyeIcon size={16} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>
      <PasswordStrengthIndicator password={password} />
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
}: {
  password: string
  confirmPassword?: string
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
    <div className="">
      {/* Password strength indicator */}
      <div
        className="bg-border mt-3 mb-4 h-1 w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={strengthScore}
        aria-valuemin={0}
        aria-valuemax={4}
        aria-label="Password strength">
        <div
          className={`h-full ${getStrengthColor(strengthScore)} transition-all duration-500 ease-out`}
          style={{ width: `${(strengthScore / 4) * 100}%` }}></div>
      </div>

      {/* Password strength description */}
      <p id={`${id}-description`} className="text-foreground mb-2 text-sm font-medium">
        {getStrengthText(strengthScore)}. Must contain:
      </p>

      {/* Password requirements list */}
      <ul className="space-y-1.5" aria-label="Password requirements">
        {strength.map((req, index) => (
          <li key={index} className="flex items-center gap-2">
            {req.met ? (
              <CheckIcon className="text-emerald-500 size-4" aria-hidden="true" />
            ) : (
              <XIcon className="text-muted-foreground/80 size-4" aria-hidden="true" />
            )}
            <span className={`text-xs ${req.met ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              {req.text}
              <span className="sr-only">
                {req.met ? ' - Requirement met' : ' - Requirement not met'}
              </span>
            </span>
          </li>
        ))}
        {confirmPassword !== undefined && (
          <li className="flex items-center gap-2">
            {password === confirmPassword && password.length > 0 ? (
              <CheckIcon className="text-emerald-500 size-4" aria-hidden="true" />
            ) : (
              <XIcon className="text-muted-foreground/80 size-4" aria-hidden="true" />
            )}
            <span
              className={`text-xs ${password === confirmPassword && password.length > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
              Passwords match
              <span className="sr-only">
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
