import { randomUUID } from 'node:crypto'
import type { AccountView, ShippingAddress, VoiceMode } from '@saystreet/shared'
import { type Account, db } from '../db'
import { env } from '../env'
import { sampleOrderEvents, sampleOrders } from '../orders/samples'

// What a new demo account starts with (spec section 4.1), plus four sample orders.
// - The name: an ordinary first and last name, one of these at random, so judges trying it side by
//   side don't all get the same customer. A name alone points at nobody.
// - The address: PayPal's own sandbox address (1 Main St, San Jose, CA 95131), the one its sandbox
//   test buyers come with. Never a made-up home address: a plausible street and house number can
//   turn out to be a real person's home, and the name next to it would make it look like theirs.
const DEMO_NAMES = ['Sarah Johnson', 'Michael Brown', 'Emily Davis', 'David Miller', 'Jessica Wilson', 'James Anderson'] as const
const DEMO_ADDRESS = { shipLine1: '1 Main St', shipLine2: null, shipCity: 'San Jose', shipState: 'CA', shipPostal: '95131', shipCountry: 'US' }

function demoCustomer() {
  return { name: DEMO_NAMES[Math.floor(Math.random() * DEMO_NAMES.length)]!, ...DEMO_ADDRESS }
}

export async function createDemoAccount(voiceMode: VoiceMode): Promise<Account> {
  return db().$transaction(async (tx) => {
    const account = await tx.account.create({
      data: {
        id: randomUUID(),
        ...demoCustomer(),
        // No wallet of its own: the account pays with the shared sandbox buyer (see walletFor).
        vaultId: null,
        voiceMode,
      },
    })
    const orders = sampleOrders(account.id, shipToOf(account))
    await tx.order.createMany({ data: orders })
    await tx.orderEvent.createMany({ data: sampleOrderEvents(orders) })
    return account
  })
}

export type Wallet = { vaultId: string; shared: boolean }

// The PayPal wallet an account pays with, looked up at payment time:
// its own vault id if it has one, otherwise the shared sandbox buyer (DEMO_VAULT_ID).
// Reading DEMO_VAULT_ID here, not copying it at account creation, means accounts made
// before the buyer was connected, or before it was reconnected, still pay with the current one.
export function walletFor(account: Account): Wallet | null {
  if (account.vaultId) return { vaultId: account.vaultId, shared: false }
  const shared = env('DEMO_VAULT_ID')
  return shared ? { vaultId: shared, shared: true } : null
}

export function shipToOf(account: Account): ShippingAddress {
  return {
    name: account.name,
    line1: account.shipLine1,
    line2: account.shipLine2,
    city: account.shipCity,
    state: account.shipState,
    postal: account.shipPostal,
    country: 'US',
  }
}

// spentThisWeekCents comes from orders/service spentThisWeek().
export function toAccountView(account: Account, spentThisWeekCents: number): AccountView {
  const wallet = walletFor(account)
  return {
    id: account.id,
    name: account.name,
    ship_to: shipToOf(account),
    voice_mode: account.voiceMode,
    speech_rate: account.speechRate as AccountView['speech_rate'],
    sounds_on: account.soundsOn,
    limits: {
      per_purchase_cents: account.perPurchaseLimitCents,
      weekly_cents: account.weeklyLimitCents,
      spent_this_week_cents: spentThisWeekCents,
    },
    wallet: {
      connected: wallet !== null,
      label: wallet && !wallet.shared ? 'Your PayPal sandbox account' : 'Sandbox demo buyer',
    },
    created_at: account.createdAt.toISOString(),
  }
}

export function isVoiceMode(value: unknown): value is VoiceMode {
  return value === 'screen_reader' || value === 'spoken'
}
