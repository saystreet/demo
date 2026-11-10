import { CaretDown } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { Collapsible } from 'radix-ui'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { advanceOrder, clearPrices, keys, raisePrice, useAudit, useResetAccount } from '../../api/queries'
import { ApiError } from '../../lib/api'
import { dateTime } from '../../lib/words'
import { ConfirmDialog } from '../ui/alert-dialog'
import { Button } from '../ui/button'

// Demo tools (spec 16.4, 15.6, 15.9): make the store's price change after choosing, move an
// order through delivery, start over, and read the payment engine's log.

type Props = {
  conversationId: string | null
  hasOptions: boolean
  say: (phrases: string[]) => void
}

export function DemoTools({ conversationId, hasOptions, say }: Props) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const client = useQueryClient()
  const navigate = useNavigate()
  const audit = useAudit(open)
  const reset = useResetAccount()

  const run = async (name: string, action: () => Promise<string>) => {
    setBusy(name)
    try {
      say([await action()])
    } catch (error) {
      say([error instanceof ApiError && error.say ? error.say : 'That didn’t work. Try again.'])
    } finally {
      setBusy(null)
      void client.invalidateQueries({ queryKey: keys.audit })
    }
  }

  const raise = () =>
    run('raise', async () => {
      await raisePrice(conversationId!, 1, 700)
      return 'Option 1 now costs $7 more at the store. Choose it and pay to see what happens.'
    })

  const clear = () =>
    run('clear', async () => {
      await clearPrices()
      return 'Price changes cleared.'
    })

  const advance = () =>
    run('advance', async () => {
      const result = await advanceOrder()
      void client.invalidateQueries({ queryKey: keys.orders })
      if (result.order) client.setQueryData(keys.order(result.order.order_id), result.order)
      if (result.order?.conversation_id) void client.invalidateQueries({ queryKey: keys.conversation(result.order.conversation_id) })
      return result.say
    })

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="rounded-(--radius-panel) border border-line">
      <Collapsible.Trigger className="flex min-h-12 w-full items-center justify-between gap-3 rounded-(--radius-panel) px-4 font-semibold hover:bg-surface-1">
        Demo tools
        <CaretDown aria-hidden="true" size={18} weight="bold" className={open ? 'rotate-180' : undefined} />
      </Collapsible.Trigger>
      <Collapsible.Content className="grid gap-5 px-4 pb-4">
        <p className="text-ink-muted">For trying SayStreet: these change the demo, not real stores.</p>

        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" aria-disabled={!hasOptions || !conversationId || busy !== null || undefined} onClick={() => hasOptions && conversationId && !busy && raise()}>
            Raise price of option 1 by $7
          </Button>
          <Button variant="secondary" aria-disabled={busy !== null || undefined} onClick={() => !busy && clear()}>
            Clear price changes
          </Button>
          <Button variant="secondary" aria-disabled={busy !== null || undefined} onClick={() => !busy && advance()}>
            Ship or deliver latest order
          </Button>
          <ConfirmDialog
            title="Reset the demo account?"
            description="You get a new demo account with fresh sample orders. This one’s chats and orders stay behind."
            confirm="Reset"
            onConfirm={() => reset.mutate(undefined, { onSuccess: () => navigate('/chat', { replace: true }) })}
            trigger={<Button variant="secondary">Reset demo account</Button>}
          />
        </div>
        {!hasOptions && <p className="-mt-3 text-sm text-ink-muted">Raising a price needs options in this chat first.</p>}

        <section aria-labelledby="audit-title">
          <h2 id="audit-title" className="font-bold">
            Payment log
          </h2>
          {audit.data?.length ? (
            <ol className="mt-2 grid gap-2">
              {audit.data.map((entry) => (
                <li key={`${entry.created_at}-${entry.line}`} className="text-sm">
                  <span className="text-ink-muted">{dateTime(entry.created_at)}</span>
                  <span className="data block break-words">{entry.line}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">Every payment decision shows up here with its reason.</p>
          )}
        </section>
      </Collapsible.Content>
    </Collapsible.Root>
  )
}
