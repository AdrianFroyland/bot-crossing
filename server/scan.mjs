/**
 * Harness-agnostic thread scanning.
 *
 * This module knows nothing about any particular agent harness: it asks every harness that
 * is present on this machine for its threads, stamps each one with which harness it came
 * from, and hands back a single list sorted by recency. Everything harness-specific lives
 * in `server/harnesses/` — see the README there.
 */
import { HARNESSES, detectedHarnesses, harnessById } from './harnesses/index.mjs'

/**
 * Every thread from every detected harness.
 *
 * A harness that throws is skipped rather than allowed to take the scan down with it: one
 * broken adapter should cost you that harness's threads, not the whole colony.
 */
export async function scanThreads() {
  const harnesses = await detectedHarnesses()
  const lists = await Promise.all(
    harnesses.map(async (h) => {
      try {
        const threads = await h.scanThreads()
        return threads.map((t) => ({ ...t, harness: h.id, harnessName: h.name }))
      } catch (err) {
        console.warn(`bot-crossing: harness "${h.id}" failed to scan —`, err?.message || err)
        return []
      }
    })
  )
  const threads = lists.flat()
  threads.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  return threads
}

/** What the HUD shows in the harness list: who is installed, and what they can do. */
export async function harnessStatus() {
  const detected = new Set((await detectedHarnesses()).map((h) => h.id))
  return HARNESSES.map((h) => ({ id: h.id, name: h.name, detected: detected.has(h.id) }))
}

/** The harness to use when a caller has not said — the first one present on this machine. */
export async function defaultHarness() {
  const [first] = await detectedHarnesses()
  return first?.id || ''
}

const dispatch = (harnessId) => {
  const h = harnessById(harnessId)
  if (!h) throw new Error(`Unknown harness "${harnessId}"`)
  return h
}

export const openThread = (harnessId, ref) => dispatch(harnessId).openThread(ref)

export const newSession = (harnessId, dir) => dispatch(harnessId).newSession(dir)

export const setThreadArchived = (harnessId, ref, archived) => dispatch(harnessId).setArchived(ref, archived)

/**
 * When a harness's own app last started, used to tell an archive it has already read from
 * one still waiting on disk. A harness with no long-lived app has nothing to report.
 */
export async function harnessAppStartedAt(harnessId) {
  const h = harnessById(harnessId)
  if (!h?.appStartedAt) return 0
  try {
    return await h.appStartedAt()
  } catch {
    return 0
  }
}
