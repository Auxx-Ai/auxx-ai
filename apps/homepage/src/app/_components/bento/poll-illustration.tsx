import { avatars } from '~/app/_components/avatars'

export const PollIllustration = () => {
  return (
    <div aria-hidden className="relative w-full select-none px-5">
      <div className="relative w-full space-y-3 py-6 before:absolute before:inset-y-0 before:w-px before:bg-gradient-to-b before:from-transparent before:via-zinc-400 before:to-transparent">
        <div className="pl-5">
          <div className="text-muted-foreground text-xs">06 AM</div>
          <div className="text-foreground before:border-muted-foreground before:bg-background before:ring-background relative mt-0.5 text-sm font-medium before:absolute before:inset-y-0 before:-left-[22px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring">
            Poll Created
          </div>
        </div>
        <div className="bg-illustration ring-border-illustration relative -mx-5 rounded-2xl border border-transparent p-2 text-xs shadow shadow-black/10 ring-1">
          <div className="text-muted-foreground ml-7 text-xs">12 PM</div>
          <div className="ml-7 flex py-1.5">
            <div className="flex items-center gap-1">
              {[
                {
                  src: avatars.kyle,
                  alt: 'Kyle Vasa',
                },
                {
                  src: avatars.zach,
                  alt: 'Zachery Melton',
                },
                {
                  src: avatars.calvin,
                  alt: 'Calvin Ochoa',
                },
                {
                  src: avatars.luis,
                  alt: 'Luis Uriostegui',
                },
              ].map((avatar, index) => (
                <div
                  key={index}
                  className="bg-background size-6 rounded-full border p-0.5 shadow shadow-zinc-950/5 *:rounded-full">
                  <img
                    src={avatar.src}
                    className="aspect-square rounded-[calc(var(--avatar-radius)-2px)] object-cover"
                    alt={avatar.alt}
                    width="460"
                    height="460"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="before:border-primary before:bg-background before:ring-background relative ml-7 mt-0.5 text-sm font-medium before:absolute before:inset-y-0 before:-left-[19px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring">
            +50 Users voted
          </div>
        </div>
        <div className="pl-5">
          <div className="text-muted-foreground text-xs">12:30 PM</div>
          <div className="text-foreground before:border-muted-foreground before:bg-background before:ring-background relative mt-0.5 text-sm font-medium before:absolute before:inset-y-0 before:-left-[22px] before:my-auto before:size-[5px] before:rounded-full before:border before:ring">
            Poll Closed
          </div>
        </div>
      </div>
    </div>
  )
}
