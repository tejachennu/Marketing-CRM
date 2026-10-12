require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  formatChatDayLabel,
  formatChatListTimestamp,
  formatChatTime,
  isSameDay,
} = require('../lib/chat-dates.ts')

// Monday 12 October 2026, 15:30 local time
const NOW = new Date(2026, 9, 12, 15, 30)
const numericDate = (d) => d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' })
const weekday = (d) => d.toLocaleDateString([], { weekday: 'long' })

test('Chat dates: today shows the time in the list and "Today" as the divider', () => {
  const morning = new Date(2026, 9, 12, 9, 5)
  assert.equal(formatChatListTimestamp(morning, NOW), formatChatTime(morning))
  assert.match(formatChatTime(morning), /^9:05/)
  assert.equal(formatChatDayLabel(morning, NOW), 'Today')
})

test('Chat dates: yesterday is decided by calendar day, not by 24 hours', () => {
  const lateLastNight = new Date(2026, 9, 11, 23, 59)
  const justAfterMidnight = new Date(2026, 9, 12, 0, 1)
  assert.equal(formatChatDayLabel(lateLastNight, justAfterMidnight), 'Yesterday')
  assert.equal(formatChatListTimestamp(lateLastNight, justAfterMidnight), 'Yesterday')
  assert.equal(formatChatDayLabel(new Date(2026, 9, 11, 0, 1), NOW), 'Yesterday')
})

test('Chat dates: the last week shows the weekday, older messages the date', () => {
  const threeDaysAgo = new Date(2026, 9, 9, 10, 0)
  const sixDaysAgo = new Date(2026, 9, 6, 10, 0)
  const sevenDaysAgo = new Date(2026, 9, 5, 10, 0)
  const lastYear = new Date(2025, 2, 3, 10, 0)

  assert.equal(formatChatDayLabel(threeDaysAgo, NOW), weekday(threeDaysAgo))
  assert.equal(formatChatListTimestamp(sixDaysAgo, NOW), weekday(sixDaysAgo))
  // Same weekday as today: must be a date, or it would read as "today"
  assert.equal(formatChatDayLabel(sevenDaysAgo, NOW), numericDate(sevenDaysAgo))
  assert.equal(formatChatListTimestamp(lastYear, NOW), numericDate(lastYear))
})

test('Chat dates: ISO strings from the database are accepted', () => {
  const iso = new Date(2026, 9, 12, 8, 0).toISOString()
  assert.equal(formatChatDayLabel(iso, NOW), 'Today')
})

test('Chat dates: a timestamp slightly in the future falls back to the date', () => {
  const tomorrow = new Date(2026, 9, 13, 0, 5)
  assert.equal(formatChatDayLabel(tomorrow, NOW), numericDate(tomorrow))
})

test('Chat dates: missing or invalid values render nothing', () => {
  for (const value of [null, undefined, '', 'not-a-date']) {
    assert.equal(formatChatDayLabel(value, NOW), '')
    assert.equal(formatChatListTimestamp(value, NOW), '')
    assert.equal(formatChatTime(value), '')
  }
})

test('Chat dates: isSameDay groups messages into days', () => {
  assert.equal(isSameDay(new Date(2026, 9, 12, 0, 0), new Date(2026, 9, 12, 23, 59)), true)
  assert.equal(isSameDay(new Date(2026, 9, 11, 23, 59), new Date(2026, 9, 12, 0, 0)), false)
  assert.equal(isSameDay(null, new Date()), false)
})
