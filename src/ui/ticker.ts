/**
 * One shared one-second tick for every running timer on screen.
 *
 * The spec is explicit that elapsed time is derived at render from the start
 * timestamp, never accumulated. This is the render trigger and nothing else: it holds
 * no elapsed time, and the interval only exists while something is subscribed.
 */

let interval: ReturnType<typeof setInterval> | null = null
let current = Math.floor(Date.now() / 1000) * 1000
const listeners = new Set<() => void>()

const tick = (): void => {
  current = Math.floor(Date.now() / 1000) * 1000
  for (const fn of listeners) fn()
}

export function subscribeToTick(fn: () => void): () => void {
  listeners.add(fn)
  if (interval === null) {
    interval = setInterval(tick, 1000)
    // a tab that was backgrounded comes back with a stale clock
    document.addEventListener('visibilitychange', tick)
  }
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', tick)
      interval = null
    }
  }
}

export const getTick = (): number => current
