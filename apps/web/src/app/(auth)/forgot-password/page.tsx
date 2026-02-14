import { Logo } from '~/components/global/login/logo'
import { ForgotPasswordForm } from '../_components/forgot-password-form'

function ForgotPasswordPage() {
  return (
    <div className='flex min-h-screen w-screen items-center justify-center p-4 bg-white/10 shadow-[inset_10px_-50px_94px_0_rgb(199,199,199,0.2)]'>
      <div className='flex w-full max-w-sm flex-col items-center gap-5'>
        <Logo />
        <ForgotPasswordForm />
      </div>
    </div>
  )
}

export default ForgotPasswordPage
