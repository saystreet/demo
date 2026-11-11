import { db } from './index'

// Tables that only grow: usage counters (a row per key per hour or day) and the catalog cache
// (kept past its time to live, only replaced on the next read). Old rows are removed at startup and
// every six hours. Counters are needed for the current day only; cached searches and products for
// a day; store names for 30 days (catalog/service.ts).

const DAY = 24 * 60 * 60 * 1000

export async function pruneOldRows(now = Date.now()): Promise<{ counters: number; cache: number }> {
  const counters = await db().usageCounter.deleteMany({ where: { windowStart: { lt: new Date(now - 2 * DAY) } } })
  const shortLived = await db().catalogCache.deleteMany({
    where: { fetchedAt: { lt: new Date(now - 2 * DAY) }, NOT: { key: { startsWith: 'websites:' } } },
  })
  const stores = await db().catalogCache.deleteMany({ where: { fetchedAt: { lt: new Date(now - 31 * DAY) }, key: { startsWith: 'websites:' } } })
  return { counters: counters.count, cache: shortLived.count + stores.count }
}

export function schedulePruning() {
  const run = () =>
    pruneOldRows()
      .then(({ counters, cache }) => (counters || cache) && console.log(`Pruned ${counters} usage counter(s) and ${cache} cache row(s)`))
      .catch((error) => console.error('Pruning old rows failed', error))
  void run()
  setInterval(run, 6 * 60 * 60 * 1000).unref()
}
