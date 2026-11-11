// The first run is three steps: how replies are read (which makes the account), PayPal, how it works. After the
// first, where the person is is kept per account, so a reload (or the trip to PayPal and back) resumes at the
// same step. Storage may be blocked, so the step is also kept in memory.
export type Step = 'paypal' | 'how' | 'done'

const key = (id: string) => `saystreet.onboarding.${id}`
const memory = new Map<string, Step>()

export function getStep(id: string): Step {
  const known = memory.get(id)
  if (known) return known
  try {
    const stored = localStorage.getItem(key(id))
    if (stored === 'paypal' || stored === 'how' || stored === 'done') return stored
    // An account from before these steps: the old "seen" flag says it has been through it.
    if (localStorage.getItem(`saystreet.welcome.${id}`) === '1') return 'done'
  } catch {}
  return 'paypal'
}

export function setStep(id: string, step: Step) {
  memory.set(id, step)
  try {
    localStorage.setItem(key(id), step)
  } catch {}
}
