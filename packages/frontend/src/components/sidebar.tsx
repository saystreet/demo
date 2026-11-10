import type { ConversationSummary } from '@saystreet/shared'
import { DotsThreeVertical, Package, Plus, Sliders } from '@phosphor-icons/react'
import { Dialog, DropdownMenu } from 'radix-ui'
import { type FormEvent, useState } from 'react'
import { Link, NavLink, useNavigate, useParams } from 'react-router'
import { useConversations, useDeleteConversation, useMe, useRenameConversation } from '../api/queries'
import { cn } from '../lib/cn'
import { ConfirmDialog } from './ui/alert-dialog'
import { Button, buttonClass } from './ui/button'
import { Input } from './ui/field'

// The app's navigation (spec 16.4): new chat, the chats, orders, settings, who is signed in.

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { data: conversations } = useConversations()
  const { data: me } = useMe()
  const { id: currentId } = useParams()

  return (
    <nav aria-label="SayStreet" className="flex h-full flex-col gap-6 p-4">
      <Link to="/chat" onClick={onNavigate} className="flex min-h-12 items-center self-start rounded-md px-1">
        <img src="/brand/lockup-for-dark-bg.svg" alt="SayStreet, new chat" width="160" height="32" className="h-8 w-auto" />
      </Link>

      <Link to="/chat" onClick={onNavigate} className={buttonClass('secondary', 'md', 'w-full justify-start')}>
        <Plus aria-hidden="true" size={20} weight="bold" />
        New chat
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <h2 className="px-1 text-sm font-semibold text-ink-muted">Chats</h2>
        {conversations?.length ? (
          <ul className="mt-2 grid gap-1">
            {conversations.map((chat) => (
              <ChatRow key={chat.id} chat={chat} current={chat.id === currentId} onNavigate={onNavigate} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 px-1 text-sm text-ink-muted">Your chats will show up here.</p>
        )}
      </div>

      <ul className="grid gap-1 border-t border-line pt-4">
        <li>
          <NavLink to="/orders" onClick={onNavigate} className={navClass}>
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

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn('flex min-h-12 items-center gap-3 rounded-(--radius-control) px-3 font-semibold hover:bg-surface-2', isActive && 'bg-surface-2 text-accent')

function ChatRow({ chat, current, onNavigate }: { chat: ConversationSummary; current: boolean; onNavigate?: () => void }) {
  const [renaming, setRenaming] = useState(false)
  const remove = useDeleteConversation()
  const navigate = useNavigate()

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
        <DropdownMenu.Trigger className="grid size-12 shrink-0 place-items-center rounded-(--radius-control) text-ink-muted hover:bg-surface-3 hover:text-ink">
          <DotsThreeVertical size={22} weight="bold" aria-hidden="true" />
          <span className="sr-only">More for {chat.title}</span>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-40 rounded-(--radius-control) border border-edge bg-surface-1 p-1 shadow-[0_12px_32px_rgb(0_0_0/0.45)]">
            <DropdownMenu.Item onSelect={() => setRenaming(true)} className={menuItem}>
              Rename
            </DropdownMenu.Item>
            <ConfirmDialog
              title="Delete this chat?"
              description="The chat and its messages go away. Orders stay in Orders."
              confirm="Delete chat"
              danger
              onConfirm={() =>
                remove.mutate(chat.id, {
                  onSuccess: () => {
                    if (current) navigate('/chat')
                  },
                })
              }
              trigger={
                <DropdownMenu.Item onSelect={(event) => event.preventDefault()} className={cn(menuItem, 'text-bad')}>
                  Delete
                </DropdownMenu.Item>
              }
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
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
