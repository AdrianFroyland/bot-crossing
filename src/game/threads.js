import { statusFor } from './colony.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Same precedence as colony badges — duplicated here to avoid a colony ↔ astronauts cycle. */
export const ROSTER_STATUS_ORDER = ['blocked', 'waiting', 'working', 'celebrating', 'idle', 'sleeping']

/** Statuses that stay visible even when dormant or past the recency cap. */
const ALWAYS_VISIBLE = new Set(['blocked', 'waiting', 'working'])

/**
 * Sort key for roster cap and building assignment: urgent first, then recent.
 * `status` may be precomputed (roster entry) or derived via `statusFor(thread, now)`.
 */
export function compareRosterPriority(a, b, now = Date.now()) {
  const statusA = a.status ?? statusFor(a, now)
  const statusB = b.status ?? statusFor(b, now)
  const rank = ROSTER_STATUS_ORDER.indexOf(statusA) - ROSTER_STATUS_ORDER.indexOf(statusB)
  if (rank) return rank
  const act = (b.lastActivityAt ?? b.thread?.lastActivityAt ?? 0) - (a.lastActivityAt ?? a.thread?.lastActivityAt ?? 0)
  if (act) return act
  const idA = a.id ?? a.thread?.id ?? ''
  const idB = b.id ?? b.thread?.id ?? ''
  return idA.localeCompare(idB)
}

/**
 * Whether a scanned thread should appear on the map, in the sidebar, and in crew stats.
 * Archived threads are always excluded — the colony treats them as gone.
 */
export function isThreadVisible(thread, opts, now = Date.now()) {
  const archivedIds = opts.archivedIds ?? new Set()
  if (thread.archived || archivedIds.has(thread.id)) return false

  const status = statusFor(thread, now)
  if (ALWAYS_VISIBLE.has(status)) return true

  if (opts.hideDormant && status === 'sleeping') return false

  const days = opts.threadRecencyDays ?? 0
  if (days > 0 && now - (thread.lastActivityAt || 0) > days * DAY_MS) return false

  return true
}

/** Filter a scan to threads that should populate the colony right now. */
export function filterVisibleThreads(threads, opts, now = Date.now()) {
  return threads.filter((t) => isThreadVisible(t, opts, now))
}
