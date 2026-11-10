import { AlertDialog as Primitive } from 'radix-ui'
import type { ReactNode } from 'react'
import { buttonClass } from './button'

// A confirmation for actions that can't be undone (delete a chat, sign out, reset).
// Radix traps focus, labels the dialog with its title and returns focus on close.

type Props = {
  trigger: ReactNode
  title: string
  description: string
  confirm: string
  cancel?: string
  danger?: boolean
  onConfirm: () => void
}

export function ConfirmDialog({ trigger, title, description, confirm, cancel = 'Cancel', danger, onConfirm }: Props) {
  return (
    <Primitive.Root>
      <Primitive.Trigger asChild>{trigger}</Primitive.Trigger>
      <Primitive.Portal>
        <Primitive.Overlay className="fixed inset-0 z-40 bg-ground/80" />
        <Primitive.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-(--radius-panel) border border-edge bg-surface-1 p-6 shadow-[0_24px_60px_rgb(0_0_0/0.5)]">
          <Primitive.Title className="text-xl font-bold">{title}</Primitive.Title>
          <Primitive.Description className="mt-2 text-ink-muted">{description}</Primitive.Description>
          <div className="mt-6 flex flex-wrap justify-end gap-3">
            <Primitive.Cancel className={buttonClass('secondary')}>{cancel}</Primitive.Cancel>
            <Primitive.Action className={buttonClass(danger ? 'danger' : 'primary')} onClick={onConfirm}>
              {confirm}
            </Primitive.Action>
          </div>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  )
}
