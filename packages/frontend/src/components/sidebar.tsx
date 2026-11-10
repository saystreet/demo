import type { ConversationSummary } from '@saystreet/shared'
import { DotsThreeVertical, Package, Plus, Sliders } from '@phosphor-icons/react'
import { Dialog, DropdownMenu } from 'radix-ui'
import { type FormEvent, useId, useRef, useState } from 'react'
import { Link, NavLink, useMatch, useNavigate, useParams } from 'react-router'
import { useConversations, useDeleteConversation, useMe, useRenameConversation } from '../api/queries'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { cn } from '../lib/cn'
import { ConfirmDialog } from './ui/alert-dialog'
import { Button, buttonClass } from './ui/button'
import { Input } from './ui/field'

// The app's navigation (spec 16.4): new chat, the chats, orders, settings, who is signed in.
//
// Many chats: the list scrolls on its own, grouped by date under headings (VoiceOver's rotor jumps
// between them), and shows the 20 latest until "Show all", so a screen reader user isn't two swipes
// per chat away from Orders and Settings. The list is a named region to jump to or past.

const RECENT = 20

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: conversations } = useConversations()
  const { data: me } = useMe()
  const { id: currentId } = useParams()
  const [showAll, setShowAll] = useState(false)
  // On an order page "Orders" is the section you're in, not the page itself.
  const onOrdersList = !!useMatch('/orders')
  // The sidebar is drawn twice (the desktop panel and the phone sheet): ids must not repeat.
  const chatsId = useId()

  const all = conversations ?? []
  // The open chat is always listed, even when it's older than the latest 20.
  const expanded = showAll || all.findIndex((c) => c.id === currentId) >= RECENT
  const groups = groupByDate(expanded ? all : all.slice(0, RECENT))

  return (
    <nav aria-label="SayStreet" className="flex h-full flex-col gap-6 p-4">
      <Link to="/chat" onClick={onNavigate} className="flex min-h-12 items-center self-start rounded-md px-1">
        <img src="/brand/lockup-for-dark-bg.svg" alt="SayStreet, new chat" width="160" height="32" className="h-8 w-auto" />
      </Link>

      <Link to="/chat" onClick={onNavigate} data-new-chat className={buttonClass('secondary', 'md', 'w-full justify-start')}>
        <Plus aria-hidden="true" size={20} weight="bold" />
        New chat
      </Link>

      <section aria-labelledby={`${chatsId}-title`} className="min-h-0 flex-1 overflow-y-auto">
        <h2 id={`${chatsId}-title`} className="px-1 text-sm font-semibold text-ink-muted">
          Chats
        </h2>
        {all.length ? (
          <>
            {groups.map((group) => (
              <div key={group.label} className="mt-4 first-of-type:mt-2">
                <h3 id={`${chatsId}-${group.key}`} className="px-1 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                  {group.label}
                </h3>
                <ul aria-labelledby={`${chatsId}-${group.key}`} className="mt-1 grid gap-1">
                  {group.chats.map((chat) => (
                    <ChatRow key={chat.id} chat={chat} current={chat.id === currentId} onNavigate={onNavigate} />
                  ))}
                </ul>
              </div>
            ))}
            {all.length > RECENT && !(expanded && !showAll) && (
              <button
                type="button"
                onClick={() => setShowAll((v) => !v)}
                className="mt-3 flex min-h-12 w-full items-center rounded-(--radius-control) px-3 text-left font-semibold text-ink-muted underline underline-offset-4 hover:bg-surface-2 hover:text-ink"
              >
                {showAll ? 'Show fewer chats' : `Show all chats (${all.length})`}
              </button>
            )}
          </>
        ) : (
          <p className="mt-2 px-1 text-sm text-ink-muted">Your chats will show up here.</p>
        )}
      </section>

      <ul className="grid gap-1 border-t border-line pt-4">
        <li>
          <NavLink to="/orders" onClick={onNavigate} className={navClass} aria-current={onOrdersList ? 'page' : 'true'}>
            <Package aria-hidden="true" size={22} />
            Orders
          </NavLink>
        </li>
        <li>
          <NavLink to="/settings" onClick={onNavigate} className={navClass}>
            <Sliders aria-hidden="true" size={22} />
            Settings
          </NavLink>
        </li>
      </ul>
      {me && (
        <p className="px-3 text-sm text-ink-muted">
          <span className="block font-semibold text-ink">{me.name}</span>
          Demo account
        </p>
      )}
    </nav>
  )
}

// Today / Yesterday / Previous 7 days / Older, by the chat's last activity in the person's own time.
type Group = { key: string; label: string; chats: ConversationSummary[] }
function groupByDate(chats: ConversationSummary[]): Group[] {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const day = 24 * 60 * 60 * 1000
  const buckets: Group[] = [
    { key: 'today', label: 'Today', chats: [] },
    { key: 'yesterday', label: 'Yesterday', chats: [] },
    { key: 'week', label: 'Previous 7 days', chats: [] },
    { key: 'older', label: 'Older', chats: [] },
  ]
  for (const chat of chats) {
    const at = new Date(chat.updated_at).getTime()
    const bucket = at >= startOfToday.getTime() ? 0 : at >= startOfToday.getTime() - day ? 1 : at >= startOfToday.getTime() - 7 * day ? 2 : 3
    buckets[bucket]!.chats.push(chat)
  }
  return buckets.filter((b) => b.chats.length > 0)
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex min-h-12 items-center gap-3 rounded-(--radius-control) px-3 font-semibold hover:bg-surface-2', isActive && 'bg-surface-2 text-accent')

function ChatRow({ chat, current, onNavigate }: { chat: ConversationSummary; current: boolean; onNavigate?: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const confirmed = useRef(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  const remove = useDeleteConversation()
  const navigate = useNavigate()
  const { say } = useAnnouncer()

  const onDelete = () => {
    confirmed.current = true
    remove.mutate(chat.id, {
      onSuccess: () => {
        say(['Chat deleted.'])
        if (current) navigate('/chat', { replace: true })
      },
      onError: (error) => say([error instanceof ApiError && error.say ? error.say : "Couldn't delete the chat. Try again."]),
    })
  }

  return (
    // min-w-0: a grid item otherwise grows to its title's length and pushes the menu button out.
    <li className={cn('group flex min-w-0 items-center rounded-(--radius-control)', current && 'bg-surface-2')}>
      <Link
        to={`/chat/${chat.id}`}
        onClick={onNavigate}
        aria-current={current ? 'page' : undefined}
        className={cn('flex min-h-12 min-w-0 flex-1 items-center rounded-(--radius-control) px-3 hover:bg-surface-2', current && 'text-accent')}
      >
        <span className="truncate">{chat.title}</span>
      </Link>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger ref={moreRef} className="grid size-12 shrink-0 place-items-center rounded-(--radius-control) text-ink-muted hover:bg-surface-3 hover:text-ink">
          <DotsThreeVertical size={22} weight="bold" aria-hidden="true" />
          <span className="sr-only">Options for {chat.title}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-(--radius-control) border border-edge bg-surface-1 p-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
            <DropdownMenu.Item onSelect={() => setRenaming(true)} className={menuItem}>
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={() => setDeleting(true)} className={cn(menuItem, 'text-bad data-highlighted:bg-surface-2')}>
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {/* Outside the menu, opened by state: the menu item that opened it is gone by the time it closes. */}
      <ConfirmDialog
        open={deleting}
        onOpenChange={(open) => {
          if (open) confirmed.current = false
          setDeleting(open)
        }}
        // Deleted: this row is about to go, so land on New chat. Cancelled: back on this row's menu button.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (confirmed.current) [...document.querySelectorAll<HTMLElement>('[data-new-chat]')].find((el) => el.offsetParent)?.focus()
          else moreRef.current?.focus()
        }}
        title="Delete this chat?"
        description="This deletes the chat and its messages for good. Your orders stay on the Orders page."
        confirm="Delete chat"
        danger
        onConfirm={onDelete}
      />
      <RenameDialog chat={chat} open={renaming} onOpenChange={setRenaming} />
    </li>
  )
}

const menuItem = 'flex min-h-12 cursor-pointer items-center rounded-md px-3 font-semibold outline-none data-highlighted:bg-surface-3'

function RenameDialog({ chat, open, onOpenChange }: { chat: ConversationSummary; open: boolean; onOpenChange: (open: boolean) => void }) {
  const rename = useRenameConversation()
  const [title, setTitle] = useState(chat.title)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const clean = title.trim()
    if (!clean) return
    rename.mutate({ id: chat.id, title: clean.slice(0, 80) }, { onSuccess: () => onOpenChange(false) })
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (setTitle(chat.title), onOpenChange(next))}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ground/80" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-(--radius-panel) border border-edge bg-surface-1 p-6">
          <Dialog.Title className="text-xl font-bold">Rename chat</Dialog.Title>
          <Dialog.Description className="sr-only">Give this chat a new name, up to 80 characters.</Dialog.Description>
          <form onSubmit={submit} className="mt-4 grid gap-4">
            <label htmlFor={`rename-${chat.id}`} className="font-semibold">
              Name
            </label>
            <Input id={`rename-${chat.id}`} value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
            <div className="flex justify-end gap-3">
              <Dialog.Close className={buttonClass('secondary')}>Cancel</Dialog.Close>
              <Button type="submit" disabled={rename.isPending}>
                Save
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
