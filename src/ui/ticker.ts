/**
 * One shared one-second tick for every running timer on screen.
 *
 * The spec is explicit that elapsed time is derived at render from the start
 * timestamp, never accumulated. This is the render trigger and nothing else: it holds
 * no elapsed time, and the interval only exists while something is subscribed.
 */

let interval: ReturnType<typeof setInterval> | null = null
const second = (): number => Math.floor(Date.now() / 1000) * 1000
let current = second()
const listeners = new Set<() => void>()

const tick = (): void => {
  current = second()
  for (const fn of listeners) fn()
}

export function subscribeToTick(fn: () => void): () => void {
  listeners.add(fn)
  if (interval === null) {
    current = second()
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

/**
 * With nothing subscribed there is no interval keeping `current` fresh, so read the
 * clock instead of serving whatever it was when the last timer stopped (or when this
 * module loaded, which is also what made the clock impossible to fake in tests).
 */
export const getTick = (): number => {
  if (listeners.size === 0) current = second()
  return current
}
