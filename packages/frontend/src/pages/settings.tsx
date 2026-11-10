import {
  type AccountView,
  type AddressField,
  formatUSD,
  type ShippingAddress,
  US_STATES,
  type UpdateAccountRequest,
  validateAddress,
} from '@saystreet/shared'
import { Check } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { keys, useMe, useUpdateAccount } from '../api/queries'
import { DemoSection } from '../components/demo-tools'
import { Badge, ErrorLine, LoadingLine, PageTitle, Section, usePageTitle } from '../components/page'
import { Button } from '../components/ui/button'
import { ChoiceGroup } from '../components/ui/choice-group'
import { Field, Input, Select } from '../components/ui/field'
import { ApiError } from '../lib/api'
import { useAnnouncer } from '../lib/announcer'
import { play } from '../lib/sounds'

// Settings (spec 16.8). Choices save the moment they're made; the address saves with its button.
// Every save is said ("Saved: $150 limit per purchase") and shown right under what changed, where
// the eye already is, until the next change. Voice and spending limits come first: they're what
// this page is for. The address is a long form a screen reader user shouldn't have to pass.

export default function SettingsPage() {
  usePageTitle('Settings')
  const me = useMe()

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-12">
      <PageTitle>Settings</PageTitle>
      <p className="mt-3 text-ink-muted">Changes save as soon as you choose.</p>
      {me.isPending && <LoadingLine label="Loading your settings…" />}
      {me.isError && <ErrorLine message="Couldn't load your settings." onRetry={() => me.refetch()} />}
      {me.data && <SettingsForm account={me.data} />}
    </div>
  )
}

type StatusKey = 'voice' | 'speed' | 'sounds' | 'purchase' | 'week' | 'address'
type Status = { key: StatusKey; ok: boolean; text: string } | null
type SaveResult = { ok: true } | { ok: false; error: unknown }
type Save = (key: StatusKey, body: UpdateAccountRequest, saved: string) => Promise<SaveResult>

function SettingsForm({ account }: { account: AccountView }) {
  const update = useUpdateAccount()
  const client = useQueryClient()
  const { say, configure } = useAnnouncer()
  const [status, setStatus] = useState<Status>(null)

  const save: Save = async (key, body, saved) => {
    try {
      await update.mutateAsync(body)
      say([`Saved: ${saved}.`])
      setStatus({ key, ok: true, text: `Saved: ${saved}` })
      return { ok: true }
    } catch (error) {
      // The cache is already back to the old value; let the voice match it before speaking.
      const now = client.getQueryData<AccountView>(keys.me)
      if (now) configure(now.voice_mode, now.speech_rate)
      const field = error instanceof ApiError && error.field
      if (!field || key !== 'address') say([error instanceof ApiError && error.say ? error.say : "Couldn't save. Your previous setting is back. Try again."])
      setStatus({ key, ok: false, text: "Couldn't save. Your previous setting is back." })
      return { ok: false, error }
    }
  }

  const statusFor = (key: StatusKey) => (status?.key === key ? <SaveStatus ok={status.ok} text={status.text} /> : null)

  return (
    <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-12">
      <VoiceSection account={account} save={save} statusFor={statusFor} />
      <LimitsSection account={account} save={save} statusFor={statusFor} />
      <AddressSection account={account} save={save} statusFor={statusFor} />

      <Section title="PayPal">
        <p className="flex flex-wrap items-center gap-3 text-lg">
          {account.wallet.label}
          <Badge tone={account.wallet.connected ? 'good' : 'warn'}>{account.wallet.connected ? 'Connected' : 'Not connected'}</Badge>
        </p>
        <p className="mt-1 text-ink-muted">Every demo account pays with a PayPal sandbox test buyer. No real money moves.</p>
      </Section>

      <DemoSection />
    </div>
  )
}

// Not a live region: the announcer already said it. Readable when a screen reader comes back to it.
function SaveStatus({ ok, text }: { ok: boolean; text: string }) {
  return (
    <p className={ok ? 'mt-3 flex items-center gap-1.5 font-semibold text-good' : 'mt-3 font-semibold text-bad'}>
      {ok && <Check aria-hidden="true" size={18} weight="bold" className="shrink-0" />}
      {text}
    </p>
  )
}

type SectionProps = { account: AccountView; save: Save; statusFor: (key: StatusKey) => ReactNode }

// ---- Voice -------------------------------------------------------------------

const RATES = [
  { value: '0.75', label: 'Slower', description: '0.75×' },
  { value: '1', label: 'Normal', description: '1×' },
  { value: '1.25', label: 'Faster', description: '1.25×' },
] as const

function VoiceSection({ account, save, statusFor }: SectionProps) {
  const { say } = useAnnouncer()

  const sample = () => {
    play('options')
    say(['This is how SayStreet sounds. Three options. One: stainless kettle, $39.99 with shipping.'])
  }

  return (
    <Section title="Voice">
      <div className="grid gap-8">
        <div>
          <h3 id="voice-mode-title" className="mb-3 text-lg font-bold">
            How replies are read
          </h3>
          {/* The voice switches through the account cache (routes.tsx), the moment the choice is made. */}
          <ChoiceGroup
            labelledBy="voice-mode-title"
            value={account.voice_mode}
            onChange={(mode) =>
              void save('voice', { voice_mode: mode }, mode === 'spoken' ? 'SayStreet reads replies aloud' : 'your screen reader reads the replies')
            }
            choices={[
              {
                value: 'screen_reader',
                label: 'I use a screen reader',
                description: 'Your screen reader reads the replies. SayStreet stays quiet apart from short sounds.',
              },
              {
                value: 'spoken',
                label: 'Read replies aloud',
                description: "SayStreet speaks every reply in your browser's voice. Using a screen reader? Choose 'I use a screen reader'.",
              },
            ]}
          />
          {statusFor('voice')}
        </div>

        {account.voice_mode === 'spoken' && (
          <div>
            <h3 id="speed-title" className="mb-3 text-lg font-bold">
              Speaking speed
            </h3>
            <ChoiceGroup
              labelledBy="speed-title"
              columns
              value={String(account.speech_rate) as '0.75' | '1' | '1.25'}
              onChange={(rate) =>
                void save('speed', { speech_rate: Number(rate) as 0.75 | 1 | 1.25 }, `${RATES.find((r) => r.value === rate)?.label.toLowerCase()} speed`)
              }
              choices={RATES.map((r) => ({ ...r }))}
            />
            {statusFor('speed')}
          </div>
        )}

        <div>
          {/* The whole row is the 48 px target; the name is "Sounds", the rest is its description. */}
          <label className="flex min-h-12 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              checked={account.sounds_on}
              onChange={(event) => void save('sounds', { sounds_on: event.target.checked }, event.target.checked ? 'sounds on' : 'sounds off')}
              aria-labelledby="sounds-name"
              aria-describedby="sounds-description"
              className="size-6 shrink-0 accent-(--color-accent)"
            />
            <span>
              <span id="sounds-name" className="block font-semibold">
                Sounds
              </span>
              <span id="sounds-description" className="block text-sm text-ink-muted">
                Short tones when recording starts, a message is sent, options arrive, a payment goes through or something goes wrong.
              </span>
            </span>
          </label>
          {statusFor('sounds')}
        </div>

        <Button variant="secondary" className="justify-self-start" onClick={sample}>
          Play a sample
        </Button>
      </div>
    </Section>
  )
}

// ---- Spending limits ---------------------------------------------------------

const PER_PURCHASE = [4000, 8000, 15000]
const WEEKLY = [10000, 20000, 50000]

const dollars = (cents: number) => (cents % 100 === 0 ? `$${cents / 100}` : formatUSD(cents))

// The presets, plus the account's own limit when it isn't one of them, so the page never shows
// a limit that isn't the real one.
function limitChoices(presets: number[], current: number) {
  const values = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b)
  return values.map((c) => ({ value: String(c), label: dollars(c) }))
}

function LimitsSection({ account, save, statusFor }: SectionProps) {
  const { per_purchase_cents: perPurchase, weekly_cents: weekly, spent_this_week_cents: spent } = account.limits
  const left = Math.max(0, weekly - spent)

  return (
    <Section title="Spending limits">
      <p className="-mt-1 text-ink-muted">SayStreet won't pay more than these, even if a higher amount is said.</p>
      <p className="mt-2 mb-6">
        This week: <span className="data">{formatUSD(spent)}</span> of <span className="data">{dollars(weekly)}</span> spent,{' '}
        <span className="data">{formatUSD(left)}</span> left.
      </p>
      <div className="grid gap-8">
        <div>
          <h3 id="limit-purchase-title" className="mb-3 text-lg font-bold">
            Limit per purchase
          </h3>
          <ChoiceGroup
            labelledBy="limit-purchase-title"
            columns
            value={String(perPurchase)}
            onChange={(value) => void save('purchase', { limits: { per_purchase_cents: Number(value) } }, `${dollars(Number(value))} limit per purchase`)}
            choices={limitChoices(PER_PURCHASE, perPurchase)}
          />
          {perPurchase > weekly && (
            <p className="mt-3 text-ink-muted">This is above your weekly limit, so the weekly limit applies.</p>
          )}
          {statusFor('purchase')}
        </div>
        <div>
          <h3 id="limit-week-title" className="mb-3 text-lg font-bold">
            Limit per week
          </h3>
          <ChoiceGroup
            labelledBy="limit-week-title"
            columns
            value={String(weekly)}
            onChange={(value) => void save('week', { limits: { weekly_cents: Number(value) } }, `${dollars(Number(value))} limit per week`)}
            choices={limitChoices(WEEKLY, weekly)}
          />
          {statusFor('week')}
        </div>
      </div>
    </Section>
  )
}

// ---- Shipping address --------------------------------------------------------

type Errors = Partial<Record<AddressField, string>>
const FIELD_NAMES: Record<AddressField, string> = {
  name: 'Full name',
  line1: 'Address line 1',
  line2: 'Address line 2',
  city: 'City',
  state: 'State',
  postal: 'ZIP code',
  country: 'Country',
}

function AddressSection({ account, save, statusFor }: SectionProps) {
  const { say } = useAnnouncer()
  const [address, setAddress] = useState<ShippingAddress>(account.ship_to)
  const [errors, setErrors] = useState<Errors>({})
  const [saving, setSaving] = useState(false)

  // The account's address changed elsewhere (another tab, a refetch): take it, unless the person
  // has edits of their own here.
  const synced = useRef(account.ship_to)
  useEffect(() => {
    if (JSON.stringify(account.ship_to) === JSON.stringify(synced.current)) return
    setAddress((now) => (JSON.stringify(now) === JSON.stringify(synced.current) ? account.ship_to : now))
    synced.current = account.ship_to
  }, [account.ship_to])

  const set = (field: keyof ShippingAddress) => (event: { target: { value: string } }) => {
    setAddress((a) => ({ ...a, [field]: event.target.value }))
    // Fixing a field clears its error; the check runs again on save.
    setErrors((e) => (e[field as AddressField] ? { ...e, [field]: undefined } : e))
  }

  // Show every problem, then move to the first. The errors are rendered before focus lands, so the
  // field is read with its message; and it's said too, for when focus is already in that field.
  const report = (problems: { field: AddressField; message: string }[]) => {
    flushSync(() => setErrors(Object.fromEntries(problems.map((p) => [p.field, p.message]))))
    const first = problems[0]!
    const target = document.getElementById(`address-${first.field}`)
    const fields = problems.map((p) => FIELD_NAMES[p.field]).join(', ')
    say([problems.length === 1 ? first.message : `${problems.length} fields need fixing: ${fields}. ${first.message}`])
    if (target) target.focus()
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (saving) return
    const check = validateAddress(address)
    if (!check.ok) {
      report(check.problems)
      return
    }
    setErrors({})
    setSaving(true)
    const result = await save('address', { ship_to: check.address }, 'address')
    setSaving(false)
    if (result.ok) {
      setAddress(check.address)
      synced.current = check.address
      return
    }
    const error = result.error
    if (error instanceof ApiError && error.field) {
      const field = error.field as AddressField
      const message = error.say ?? 'Check this field.'
      // A field the form doesn't show (e.g. country): say it and show it beside the button.
      if (document.getElementById(`address-${field}`)) report([{ field, message }])
      else say([message])
    }
  }

  return (
    <Section title="Shipping address">
      <p className="-mt-1 mb-5 text-ink-muted">Used from your next purchase. Orders keep the address they were bought with.</p>
      <form onSubmit={submit} noValidate className="grid gap-5">
        <AddressInput label="Full name" field="name" address={address} set={set} error={errors.name} autoComplete="shipping name" />
        <AddressInput label="Address line 1" field="line1" address={address} set={set} error={errors.line1} autoComplete="shipping address-line1" />
        <AddressInput
          label="Address line 2 (optional)"
          field="line2"
          address={address}
          set={set}
          error={errors.line2}
          autoComplete="shipping address-line2"
          optional
        />
        {/* Wraps instead of squeezing: at large text sizes City, State and ZIP take their own rows. */}
        <div className="flex flex-wrap gap-5">
          <div className="min-w-0 grow-[2] basis-56">
            <AddressInput label="City" field="city" address={address} set={set} error={errors.city} autoComplete="shipping address-level2" />
          </div>
          <div className="min-w-0 grow basis-44">
            <Field label="State" id="address-state" error={errors.state}>
              {({ id, describedBy }) => (
                <Select
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={errors.state ? true : undefined}
                  aria-required="true"
                  value={address.state}
                  onChange={set('state')}
                  autoComplete="shipping address-level1"
                >
                  {US_STATES.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="min-w-0 grow basis-32">
            <AddressInput
              label="ZIP code"
              field="postal"
              address={address}
              set={set}
              error={errors.postal}
              autoComplete="shipping postal-code"
              inputMode="numeric"
              maxLength={10}
            />
          </div>
        </div>
        <p>
          <span className="text-ink-muted">Country: </span>United States.{' '}
          <span className="text-ink-muted">SayStreet's stores ship within the US for now.</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <Button type="submit" aria-disabled={saving || undefined}>
            {saving ? 'Saving…' : 'Save address'}
          </Button>
          {/* Beside the button that was pressed, not up by the heading. */}
          <div className="[&>p]:mt-0">{statusFor('address')}</div>
        </div>
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
  optional,
}: {
  label: string
  field: 'name' | 'line1' | 'line2' | 'city' | 'postal'
  address: ShippingAddress
  set: (field: keyof ShippingAddress) => (event: { target: { value: string } }) => void
  error?: string
  autoComplete: string
  inputMode?: 'numeric'
  maxLength?: number
  optional?: boolean
}) {
  const id = `address-${field}`
  const errorId = error ? `${id}-error` : undefined
  return (
    <div className="grid min-w-0 gap-1.5">
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
        aria-required={optional ? undefined : true}
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
