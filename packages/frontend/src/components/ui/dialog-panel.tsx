import type { ReactNode } from 'react'

// The frame of the dialogs people meet first (how replies are read, PayPal, how it works): one size for all of
// them, so going from one to the next doesn't change the frame, and a footer that always sits at the bottom, the
// way out (skip) on the left and the way on on the right.
export const PANEL =
  'fixed top-1/2 left-1/2 z-50 flex h-[min(var(--panel-h),calc(100dvh-2rem))] w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-(--radius-panel) border border-edge bg-surface-1 p-6 [--panel-h:23.5rem] max-sm:[--panel-h:27rem]'

export function PanelFooter({ left, right }: { left?: ReactNode; right: ReactNode }) {
  return (
    <div className="mt-auto flex items-center justify-between gap-3 pt-5">
      <div>{left}</div>
      {right}
    </div>
  )
}
