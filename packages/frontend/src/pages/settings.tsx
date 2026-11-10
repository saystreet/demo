import { type AccountView, type AddressField, type ShippingAddress, US_STATES, type UpdateAccountRequest, validateAddress } from '@saystreet/shared'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'
import { useMe, useResetAccount, useUpdateAccount } from '../api/queries'
import { ErrorLine, LoadingLine, PageTitle, Section, usePageTitle } from '../components/page'
import { ConfirmDialog } from '../components/ui/alert-dialog'
import { Button } from '../components/ui/button'
import { ChoiceGroup } from '../components/ui/choice-group'
import { Field, Input, Select } from '../components/ui/field'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { clearToken } from '../lib/session'
import { play } from '../lib/sounds'

// Settings (spec 16.8). Each block saves on its own and says "Saved."

export default function SettingsPage() {
  usePageTitle('Settings')
  const me = useMe()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <PageTitle>Settings</PageTitle>
      {me.isPending && <LoadingLine label="Loading your settings…" />}
      {me.isError && <ErrorLine message="Couldn’t load your settings." onRetry={() => me.refetch()} />}
      {me.data && <SettingsForm account={me.data} />}
    </div>
  )
}

function SettingsForm({ account }: { account: AccountView }) {
  const update = useUpdateAccount()
  const { say } = useAnnouncer()

  const save = (body: UpdateAccountRequest, onError?: (error: ApiError) => void) =>
    update.mutate(body, {
      onSuccess: () => say(['Saved.']),
      onError: (error) => {
        if (error instanceof ApiError && onError) onError(error)
        else say([error instanceof ApiError && error.say ? error.say : 'Couldn’t save. Try again.'])
      },
    })

  return (
    <div className="mt-10 grid gap-12">
      <AddressSection account={account} save={save} saving={update.isPending} />
      <VoiceSection account={account} save={save} />
      <LimitsSection account={account} save={save} />

      <Section title="PayPal">
        <p className="text-lg">Sandbox demo buyer connected</p>
        <p className="mt-1 text-ink-muted">Every demo account pays with a PayPal sandbox test buyer. No real money moves.</p>
      </Section>

      <DemoSection />
    </div>
  )
}

type Save = (body: UpdateAccountRequest, onError?: (error: ApiError) => void) => void

function AddressSection({ account, save, saving }: { account: AccountView; save: Save; saving: boolean }) {
  const [address, setAddress] = useState<ShippingAddress>(account.ship_to)
  const [error, setError] = useState<{ field: AddressField; message: string } | null>(null)
  const set = (field: keyof ShippingAddress) => (event: { target: { value: string } }) => setAddress((a) => ({ ...a, [field]: event.target.value }))
  const errorFor = (field: AddressField) => (error?.field === field ? error.message : null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const check = validateAddress(address)
    if (!check.ok) {
      setError({ field: check.field, message: check.message })
      document.getElementById(`address-${check.field}`)?.focus()
      return
    }
    setError(null)
    save({ ship_to: check.address }, (apiError) => {
      if (apiError.field) setError({ field: apiError.field as AddressField, message: apiError.say ?? 'Check this field.' })
    })
  }

  return (
    <Section title="Shipping address">
      <p className="-mt-1 mb-5 text-ink-muted">Used from your next purchase. Orders keep the address they were bought with.</p>
      <form onSubmit={submit} noValidate className="grid gap-5">
        <AddressInput label="Full name" field="name" address={address} set={set} error={errorFor('name')} autoComplete="name" />
        <AddressInput label="Address line 1" field="line1" address={address} set={set} error={errorFor('line1')} autoComplete="address-line1" />
        <AddressInput label="Address line 2 (optional)" field="line2" address={address} set={set} error={errorFor('line2')} autoComplete="address-line2" />
        <div className="grid gap-5 sm:grid-cols-[1fr_12rem_9rem]">
          <AddressInput label="City" field="city" address={address} set={set} error={errorFor('city')} autoComplete="address-level2" />
          <Field label="State" error={errorFor('state')}>
            {({ describedBy }) => (
              <Select
                id="address-state"
                aria-describedby={describedBy}
                aria-invalid={error?.field === 'state' || undefined}
                value={address.state}
                onChange={set('state')}
                autoComplete="address-level1"
              >
                {US_STATES.map(([code, name]) => (
                  <option key={code} value={code}>
                    {name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <AddressInput label="ZIP code" field="postal" address={address} set={set} error={errorFor('postal')} autoComplete="postal-code" inputMode="numeric" maxLength={5} />
        </div>
        <p>
          <span className="text-ink-muted">Country: </span>United States
        </p>
        <Button type="submit" className="justify-self-start" aria-disabled={saving || undefined}>
          Save address
        </Button>
      </form>
    </Section>
  )
}

function AddressInput({
  label,
  field,
  address,
  set,
  error,
  autoComplete,
  inputMode,
  maxLength = 100,
}: {
  label: string
  field: 'name' | 'line1' | 'line2' | 'city' | 'postal'
  address: ShippingAddress
  set: (field: keyof ShippingAddress) => (event: { target: { value: string } }) => void
  error: string | null
  autoComplete: string
  inputMode?: 'numeric'
  maxLength?: number
}) {
  const id = `address-${field}`
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="font-semibold">
        {label}
      </label>
      <Input
        id={id}
        value={address[field] ?? ''}
        onChange={set(field)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        maxLength={maxLength}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
      />
      {error && (
        <p id={errorId} className="text-sm font-semibold text-bad">
          {error}
        </p>
      )}
    </div>
  )
}

const RATES = [
  { value: '0.75', label: 'Slower', description: '0.75×' },
  { value: '1', label: 'Normal', description: '1×' },
  { value: '1.25', label: 'Faster', description: '1.25×' },
] as const

function VoiceSection({ account, save }: { account: AccountView; save: Save }) {
  const { say, configure } = useAnnouncer()

  const sample = () => {
    play('options')
    say(['This is how SayStreet sounds. Three options. One: stainless kettle, $39.99 delivered.'])
  }

  return (
    <Section title="Voice">
      <div className="grid gap-6">
        <ChoiceGroup
          label="How replies are read"
          value={account.voice_mode}
          onChange={(mode) => {
            configure(mode, account.speech_rate)
            save({ voice_mode: mode })
          }}
          choices={[
            { value: 'screen_reader', label: 'I use a screen reader', description: 'VoiceOver reads replies. SayStreet only plays short sounds.' },
            { value: 'spoken', label: 'Read replies aloud', description: 'SayStreet speaks every reply in your browser’s voice. Using VoiceOver? Choose “I use a screen reader”.' },
          ]}
        />

        {account.voice_mode === 'spoken' && (
          <div>
            <h3 className="mb-3 font-semibold">Speaking speed</h3>
            <ChoiceGroup
              label="Speaking speed"
              columns
              value={String(account.speech_rate) as '0.75' | '1' | '1.25'}
              onChange={(rate) => {
                configure(account.voice_mode, Number(rate))
                save({ speech_rate: Number(rate) as 0.75 | 1 | 1.25 })
              }}
              choices={RATES.map((r) => ({ ...r }))}
            />
          </div>
        )}

        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={account.sounds_on}
            onChange={(event) => save({ sounds_on: event.target.checked })}
            className="size-6 accent-(--color-accent)"
          />
          <span>
            <span className="block font-semibold">Sounds</span>
            <span className="block text-sm text-ink-muted">Short tones for recording, sent, options, payment and errors.</span>
          </span>
        </label>

        <Button variant="secondary" className="justify-self-start" onClick={sample}>
          Play a sample
        </Button>
      </div>
    </Section>
  )
}

const PER_PURCHASE = [4000, 8000, 15000]
const WEEKLY = [10000, 20000, 50000]

function LimitsSection({ account, save }: { account: AccountView; save: Save }) {
  const dollars = (cents: number) => `$${cents / 100}`
  const perPurchase = PER_PURCHASE.includes(account.limits.per_purchase_cents) ? String(account.limits.per_purchase_cents) : String(PER_PURCHASE[1])
  const weekly = WEEKLY.includes(account.limits.weekly_cents) ? String(account.limits.weekly_cents) : String(WEEKLY[1])

  return (
    <Section title="Spending limits">
      <p className="-mt-1 mb-5 text-ink-muted">
        SayStreet refuses to pay over these, whatever is said. Spent this week: <span className="data text-ink">{dollars(account.limits.spent_this_week_cents)}</span>.
      </p>
      <div className="grid gap-6">
        <div>
          <h3 className="mb-3 font-semibold">Per purchase</h3>
          <ChoiceGroup
            label="Limit per purchase"
            columns
            value={perPurchase}
            onChange={(value) => save({ limits: { per_purchase_cents: Number(value) } })}
            choices={PER_PURCHASE.map((c) => ({ value: String(c), label: dollars(c) }))}
          />
        </div>
        <div>
          <h3 className="mb-3 font-semibold">Per week</h3>
          <ChoiceGroup
            label="Limit per week"
            columns
            value={weekly}
            onChange={(value) => save({ limits: { weekly_cents: Number(value) } })}
            choices={WEEKLY.map((c) => ({ value: String(c), label: dollars(c) }))}
          />
        </div>
      </div>
    </Section>
  )
}

function DemoSection() {
  const reset = useResetAccount()
  const navigate = useNavigate()
  const client = useQueryClient()

  return (
    <Section title="Demo">
      <div className="grid gap-3 sm:flex sm:flex-wrap">
        <ConfirmDialog
          title="Reset the demo account?"
          description="You get a new demo account with fresh sample orders. This one’s chats and orders stay behind."
          confirm="Reset"
          onConfirm={() => reset.mutate(undefined, { onSuccess: () => navigate('/chat', { replace: true }) })}
          trigger={<Button variant="secondary">Reset demo account</Button>}
        />
        <ConfirmDialog
          title="Sign out?"
          description="Signing out ends this demo account. You can create a new one in two clicks."
          confirm="Sign out"
          danger
          onConfirm={() => {
            clearToken()
            client.clear()
            navigate('/', { replace: true })
          }}
          trigger={<Button variant="danger">Sign out</Button>}
        />
      </div>
    </Section>
  )
}
