import { describe, expect, it } from 'vitest'
import { formatDayMinute12 } from '../../src/ui/format'

const DAY_START = 240 // 04:00

describe('formatDayMinute12', () => {
  it('reads the way a person says the time', () => {
    expect(formatDayMinute12(0, DAY_START)).toBe('4:00 AM')
    expect(formatDayMinute12(300, DAY_START)).toBe('9:00 AM')
    expect(formatDayMinute12(345, DAY_START)).toBe('9:45 AM')
  })

  it('gets the two hours everyone gets wrong right', () => {
    expect(formatDayMinute12(480, DAY_START)).toBe('12:00 PM') // noon is 12 PM, not 0 PM
    expect(formatDayMinute12(1200, DAY_START)).toBe('12:00 AM') // midnight is 12 AM
  })

  it('wraps past midnight into the small hours', () => {
    expect(formatDayMinute12(1425, DAY_START)).toBe('3:45 AM') // the last slot of the day
    expect(formatDayMinute12(1260, DAY_START)).toBe('1:00 AM')
  })

  it('follows the day start rather than assuming 04:00', () => {
    expect(formatDayMinute12(0, 0)).toBe('12:00 AM')
    expect(formatDayMinute12(0, 360)).toBe('6:00 AM')
  })
})
