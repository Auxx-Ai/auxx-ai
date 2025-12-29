import { cn } from '~/lib/utils'
import { AtSign, Paperclip, Smile } from 'lucide-react'

export const ReplyIllustration = ({ className }: { className?: string }) => {
  return (
    <div
      aria-hidden
      className={cn(
        'bg-illustration ring-border-illustration mt-12 flex origin-bottom flex-col space-y-4 rounded-2xl border border-transparent px-4 pb-2 pt-4 shadow shadow-black/10 ring-1 transition-all duration-300',
        className
      )}>
      <p className="text-primary text-sm font-medium">
        @Bernard <span className="text-muted-foreground font-normal">Shared 2 invoices</span>
      </p>

      <div className="text-muted-foreground *:hover:text-foreground -ml-1.5 flex">
        <div className="hover:text-foreground hover:bg-muted flex size-7 rounded-full">
          <AtSign className="m-auto size-4" />
        </div>
        <div className="hover:text-foreground hover:bg-muted flex size-7 rounded-full">
          <Smile className="m-auto size-4" />
        </div>
        <div className="hover:text-foreground hover:bg-muted flex size-7 rounded-full">
          <Paperclip className="m-auto size-4" />
        </div>
      </div>
    </div>
  )
}
