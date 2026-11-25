require('./register-typescript.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const R = require('../lib/expenses/rules.ts')
const S = require('../lib/expenses/store.ts')
const { salonDb } = require('./salon-fake-db.cjs')
const { canAccessPage } = require('../lib/rbac.ts')

const NOW = Date.parse('2026-11-25T06:00:00Z') // 25 Nov 2026, 11:30 am in India
const ORG = 'org-1'

test('an expense is checked: amount, date, kind, payment method', () => {
  const ok = R.cleanExpense({ amount: '₹12,500.50', spent_on: '2026-11-01', category: 'salaries', paid_to: '  Ravi  ', method: 'upi', repeat_monthly: true, note: ' November ' }, NOW)
  assert.deepEqual(ok.value, { spent_on: '2026-11-01', category: 'salaries', amount: 12500.5, note: 'November', paid_to: 'Ravi', method: 'upi', repeat_monthly: true })
  assert.equal(R.cleanExpense({ amount: 0, category: 'rent' }, NOW).field, 'amount')
  assert.equal(R.cleanExpense({ amount: -5, category: 'rent' }, NOW).field, 'amount')
  assert.equal(R.cleanExpense({ amount: 2e9, category: 'rent' }, NOW).field, 'amount')
  assert.equal(R.cleanExpense({ amount: 100, category: 'rent', spent_on: '2026-02-30' }, NOW).field, 'spent_on')
  assert.equal(R.cleanExpense({ amount: 100, category: 'rent', spent_on: '2027-06-01' }, NOW).field, 'spent_on', 'years ahead is a slip')
  assert.equal(R.cleanExpense({ amount: 100, category: 'rent', spent_on: '2026-12-01' }, NOW).value.spent_on, '2026-12-01', 'next month rent paid ahead is fine')
  assert.equal(R.cleanExpense({ amount: 100, category: '' }, NOW).field, 'category')
  assert.equal(R.cleanExpense({ amount: 100, category: '!' }, NOW).field, 'category', 'a typed kind needs a letter or digit')
  assert.equal(R.cleanExpense({ amount: 100, category: 'x'.repeat(41) }, NOW).field, 'category', 'a typed kind is short')
  const plain = R.cleanExpense({ amount: 100, category: 'stock', method: 'bitcoin' }, NOW).value
  assert.equal(plain.spent_on, '2026-11-25', 'no date = today in India')
  assert.equal(plain.method, null)
  assert.equal(plain.repeat_monthly, false)
})

test('months: India time, never a future month, six months ending at the one picked', () => {
  assert.equal(R.readMonth('2026-12', NOW), '2026-11')
  assert.equal(R.readMonth('2026-02', NOW), '2026-02')
  assert.equal(R.readMonth('nonsense', NOW), '2026-11')
  assert.deepEqual(R.monthsUpTo('2026-02', 4), ['2025-11', '2025-12', '2026-01', '2026-02'])
  const b = R.monthBounds('2026-11')
  assert.equal(b.first, '2026-11-01')
  assert.equal(b.last, '2026-11-30')
  assert.equal(b.start, '2026-10-31T18:30:00.000Z')
  assert.equal(b.end, '2026-11-30T18:30:00.000Z')
  assert.equal(R.istToday(Date.parse('2026-11-30T19:00:00Z')), '2026-12-01', 'half past midnight in India is the next day')
  assert.equal(R.monthName('2026-11'), 'November 2026')
})

test('sales vs expenses per month; a bill late at night counts in India-time month', () => {
  const months = ['2026-10', '2026-11']
  const sales = [
    { at: '2026-10-31T19:00:00Z', amount: 1000, paid: true, kind: 'bill' }, // 1 Nov in India
    { at: '2026-10-15T10:00:00Z', amount: 500, paid: false, kind: 'order' },
    { at: '2026-11-10T10:00:00Z', amount: '2500.50', paid: true, kind: 'order' },
  ]
  const expenses = [{ spent_on: '2026-11-01', category: 'rent', amount: '1200' }, { spent_on: '2026-10-05', category: 'stock', amount: 800 }]
  const [oct, nov] = R.monthTotals(months, sales, expenses)
  assert.deepEqual(oct, { month: '2026-10', sales: 500, salesCount: 1, received: 0, expenses: 800, profit: -300 })
  assert.deepEqual(nov, { month: '2026-11', sales: 3500.5, salesCount: 2, received: 3500.5, expenses: 1200, profit: 2300.5 })
})

test('where the money went: biggest first, with shares', () => {
  const rows = R.byCategory([
    { spent_on: '2026-11-01', category: 'salaries', amount: 30000 },
    { spent_on: '2026-11-02', category: 'salaries', amount: 15000 },
    { spent_on: '2026-11-03', category: 'rent', amount: 15000 },
    { spent_on: '2026-11-04', category: '', amount: 0 },
  ])
  assert.deepEqual(rows.map((r) => [r.key, r.amount, r.count, r.share]), [['salaries', 45000, 2, 75], ['rent', 15000, 1, 25], ['other', 0, 1, 0]])
  assert.equal(rows[0].label, 'Salaries')
})

test('a business can type its own kind of expense; it is kept and offered next time', () => {
  // Built-in kinds win, also when their name is typed
  assert.equal(R.resolveCategory('rent'), 'rent')
  assert.equal(R.resolveCategory('  SALARIES '), 'salaries')
  assert.equal(R.resolveCategory('Electricity, water, internet'), 'bills')
  // A new one is kept as typed (tidied); one used before keeps its first spelling
  assert.equal(R.resolveCategory('  Tea   and snacks '), 'Tea and snacks')
  assert.equal(R.resolveCategory('tea AND snacks', ['Tea and snacks']), 'Tea and snacks')
  assert.equal(R.resolveCategory('<b>x</b>'), 'b x /b', 'no tags')
  assert.equal(R.resolveCategory('a'), null)
  const saved = R.cleanExpense({ amount: 250, category: 'tea and snacks', spent_on: '2026-11-05' }, NOW, ['Tea and snacks']).value
  assert.equal(saved.category, 'Tea and snacks')
  assert.equal(R.categoryLabel('Tea and snacks'), 'Tea and snacks')
  assert.equal(R.categoryLabel('rent'), 'Rent')
  // The list of own kinds: no built-in ones, each once, most used first
  assert.deepEqual(R.ownCategories([
    { category: 'rent' }, { category: 'Tea and snacks' }, { category: 'Cleaning' }, { category: 'tea and snacks' }, { category: '' }, { category: null },
  ]), ['Tea and snacks', 'Cleaning'])
  // Where the money went puts letter-case twins together under the first spelling
  const rows = R.byCategory([
    { spent_on: '2026-11-01', category: 'Tea and snacks', amount: 200 },
    { spent_on: '2026-11-02', category: 'TEA AND SNACKS', amount: 100 },
    { spent_on: '2026-11-03', category: 'rent', amount: 900 },
  ])
  assert.deepEqual(rows.map((r) => [r.key, r.label, r.amount, r.count]), [['rent', 'Rent', 900, 1], ['Tea and snacks', 'Tea and snacks', 300, 2]])
  // The picker: search by any word, own ones after built-in ones, "Add …" only for a new name
  const all = R.categoryChoices('', ['Tea and snacks'])
  assert.equal(all.choices.length, R.EXPENSE_CATEGORIES.length + 1)
  assert.equal(all.add, null)
  assert.deepEqual(R.categoryChoices('water', []).choices.map((c) => c.key), ['bills'])
  assert.deepEqual(R.categoryChoices('snacks', ['Tea and snacks']).choices.map((c) => [c.key, c.own]), [['Tea and snacks', true]])
  assert.equal(R.categoryChoices('snacks', ['Tea and snacks']).add, 'snacks')
  assert.equal(R.categoryChoices('tea and snacks', ['Tea and snacks']).add, null, 'already there')
  assert.equal(R.categoryChoices('Rent', []).add, null)
  assert.equal(R.categoryChoices('Cleaning', []).add, 'Cleaning')
  assert.equal(R.categoryChoices('x', []).add, null, 'too short to add')
})

test('repeating expenses (salaries, rent) are copied once into a new month, on the same day', () => {
  const earlier = [
    { id: 'a', spent_on: '2026-09-01', category: 'salaries', amount: 20000, paid_to: 'Ravi', repeat_monthly: true, repeat_key: 'a' },
    { id: 'a2', spent_on: '2026-10-01', category: 'salaries', amount: 22000, paid_to: 'Ravi', repeat_monthly: true, repeat_key: 'a' },
    { id: 'b', spent_on: '2026-10-31', category: 'rent', amount: 15000, repeat_monthly: true, repeat_key: 'b' },
    { id: 'c', spent_on: '2026-10-05', category: 'loan', amount: 5000, repeat_monthly: false, repeat_key: 'c' }, // switched off
    { id: 'd', spent_on: '2026-10-09', category: 'stock', amount: 900, repeat_monthly: false },
  ]
  const due = R.repeatsDue('2026-11', earlier, [])
  assert.deepEqual(due.map((r) => [r.repeat_key, r.spent_on, r.amount]), [['a', '2026-11-01', 22000], ['b', '2026-11-30', 15000]], 'the latest amount, the 31st becomes the 30th')
  assert.equal(R.repeatsDue('2026-11', earlier, [{ id: 'x', spent_on: '2026-11-03', category: 'salaries', amount: 1, repeat_key: 'a' }]).length, 1, 'one already in the month is not copied again')
})

test('the AI review: one "so far" while the month runs, the full one after it ends; answers are checked', () => {
  assert.equal(R.insightKindFor('2026-11', NOW), 'so_far')
  assert.equal(R.insightKindFor('2026-10', NOW), 'full')
  assert.equal(R.parseInsight('not json'), null)
  assert.equal(R.parseInsight('{"summary": ""}'), null)
  assert.equal(R.parseInsight('{"summary": "Good month."}'), null, 'a summary with no advice is not enough')
  const insight = R.parseInsight('Here: {"summary": "Sales went up.", "good": ["Saturdays were busy", 4], "improve": ["Collect ₹2,000 still due"], "ideas": ["a","b","c","d","e"], "focus": "Call back old customers"}')
  assert.deepEqual(insight, { summary: 'Sales went up.', good: ['Saturdays were busy'], improve: ['Collect ₹2,000 still due'], ideas: ['a', 'b', 'c', 'd'], focus: 'Call back old customers' })
  assert.match(R.insightBlocker({ salesCount: 0, expenses: 0 }), /nothing to review/)
  assert.equal(R.insightBlocker({ salesCount: 0, expenses: 10 }), null)
})

test('the AI is given only real numbers, in plain words', () => {
  const totals = { month: '2026-10', sales: 150000, salesCount: 100, received: 140000, expenses: 90000, profit: 60000 }
  const facts = {
    business: 'Asha Beauty', kind: 'service business with bookings and bills', month: '2026-10', monthLabel: 'October 2026', soFar: false, daysCounted: 31,
    totals, before: { ...totals, month: '2026-09', sales: 120000, salesCount: 90, expenses: 85000, profit: 35000 }, trend: [totals],
    categories: [{ key: 'salaries', label: 'Salaries', amount: 60000, count: 3, share: 67 }],
    weekdays: R.salesByWeekday([{ at: '2026-10-03T10:00:00Z', amount: 900, paid: true, kind: 'bill' }]),
    topItems: [{ name: 'Haircut', quantity: 40, amount: 12000 }], customers: 80, returning: 30,
  }
  const textOut = R.insightFactsText(facts)
  assert.match(textOut, /Sales: ₹1,50,000 from 100 sales, average ₹1,500/)
  assert.match(textOut, /still to collect: ₹10,000/)
  assert.match(textOut, /Left after expenses: ₹60,000 \(40% of sales\)/)
  assert.match(textOut, /Salaries ₹60,000 \(67%\)/)
  assert.match(textOut, /Sat ₹900 \(1\)/, '3 Oct 2026 was a Saturday')
  assert.match(textOut, /Haircut \(40 sold, ₹12,000\)/)
  assert.match(textOut, /80, of whom 30 had bought before/)
  const prompt = R.insightPrompt(facts)
  assert.match(prompt, /ONLY the numbers below/)
  assert.match(prompt, /"ideas"/)
  assert.doesNotMatch(prompt, /\n\n\n/)
})

test('the database setup matches the migration file and uses its own lock', () => {
  const file = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20261212_expenses.sql'), 'utf8')
  assert.equal(file, S.EXPENSES_SQL)
  assert.equal(S.EXPENSES_LOCK, 724519038)
  assert.match(S.EXPENSES_SQL, /ENABLE ROW LEVEL SECURITY/)
})

test('store: add, list, copy monthly ones, sales from bills and orders, the overview', async () => {
  const db = salonDb({
    salon_invoices: [
      { id: 'i1', organization_id: ORG, total: 1180, status: 'paid', issued_at: '2026-11-05T10:00:00Z', items: [{ name: 'Haircut', quantity: 2, total: 1180 }], customer_phone: '+91 98480 11111' },
      { id: 'i2', organization_id: ORG, total: 500, status: 'void', issued_at: '2026-11-06T10:00:00Z', items: [] },
      { id: 'i3', organization_id: ORG, total: 700, status: 'unpaid', issued_at: '2026-10-06T10:00:00Z', items: [], customer_phone: '9848011111' },
      { id: 'i4', organization_id: 'other', total: 9999, status: 'paid', issued_at: '2026-11-06T10:00:00Z', items: [] },
    ],
    commerce_orders: [
      { id: 'o1', organization_id: ORG, total_amount: 2000, status: 'delivered', payment_status: 'paid', created_at: '2026-11-07T10:00:00Z', shipping_address: { phone_number: '9000000001' } },
      { id: 'o2', organization_id: ORG, total_amount: 3000, status: 'canceled', payment_status: 'paid', created_at: '2026-11-07T10:00:00Z' },
      { id: 'o3', organization_id: ORG, total_amount: 400, status: 'payment_pending', payment_status: 'pending', created_at: '2026-11-08T10:00:00Z' },
    ],
    commerce_order_items: [{ order_id: 'o1', title: 'Shampoo', quantity: 4, total_price: 2000 }],
    organizations: [{ id: ORG, name: 'Asha Beauty', enabled_connectors: ['salon'], enable_commerce: true }],
  })
  const rent = await S.addExpense(db, ORG, R.cleanExpense({ amount: 15000, category: 'rent', spent_on: '2026-10-01', repeat_monthly: true }, NOW).value, 'u1')
  assert.equal(rent.repeat_key, rent.id, 'a monthly one starts its own chain')
  await S.addExpense(db, ORG, R.cleanExpense({ amount: 600, category: 'stock', spent_on: '2026-11-03' }, NOW).value, 'u1')
  await S.addExpense(db, 'other', R.cleanExpense({ amount: 99999, category: 'rent', spent_on: '2026-11-03' }, NOW).value, 'u9')

  let view = await S.loadExpensesOverview(db, ORG, '2026-11', NOW)
  assert.equal(view.repeatsDue, 1, 'October rent can be copied into November')
  assert.equal(await S.copyRepeats(db, ORG, '2026-11', 'u1'), 1)
  assert.equal(await S.copyRepeats(db, ORG, '2026-11', 'u1'), 0, 'copied once')
  view = await S.loadExpensesOverview(db, ORG, '2026-11', NOW)
  const nov = view.months[view.months.length - 1]
  assert.deepEqual(nov, { month: '2026-11', sales: 3180, salesCount: 2, received: 3180, expenses: 15600, profit: -12420 })
  assert.equal(view.months[view.months.length - 2].sales, 700)
  assert.deepEqual(view.categories.map((c) => c.key), ['rent', 'stock'])
  assert.equal(view.expenses.length, 2)
  assert.equal(view.repeatsDue, 0)
  assert.equal(view.insight, null)
  assert.equal(view.canAskInsight, true)
  assert.deepEqual(view.ownCategories, [], 'no own kinds yet')
  // An own kind typed once is in the list for the next expense (and not another workspace's)
  await S.addExpense(db, ORG, R.cleanExpense({ amount: 120, category: 'Tea and snacks', spent_on: '2026-09-04' }, NOW).value, 'u1')
  await S.addExpense(db, 'other', R.cleanExpense({ amount: 50, category: 'Secret kind', spent_on: '2026-11-04' }, NOW).value, 'u9')
  assert.deepEqual(await S.ownCategoryList(db, ORG), ['Tea and snacks'])
  assert.deepEqual((await S.loadExpensesOverview(db, ORG, '2026-11', NOW)).ownCategories, ['Tea and snacks'])

  const facts = await S.insightFacts(db, ORG, '2026-11', NOW)
  assert.equal(facts.soFar, true)
  assert.equal(facts.daysCounted, 25)
  assert.deepEqual(facts.topItems.map((i) => i.name), ['Shampoo', 'Haircut'])
  assert.equal(facts.customers, 2)
  assert.equal(facts.returning, 1, 'the Haircut customer also came in October')
  assert.equal(facts.kind, 'service business with bookings and bills')

  const edited = await S.updateExpense(db, ORG, view.expenses.find((e) => e.category === 'stock').id, R.cleanExpense({ amount: 650, category: 'stock', spent_on: '2026-11-03' }, NOW).value)
  assert.equal(edited.amount, 650)
  assert.equal(await S.updateExpense(db, 'other', edited.id, R.cleanExpense({ amount: 1, category: 'stock' }, NOW).value), null, 'another workspace cannot edit it')
  assert.equal(await S.deleteExpense(db, 'other', edited.id), false)
  assert.equal(await S.deleteExpense(db, ORG, edited.id), true)
})

test('store: the monthly review is held while written, so two taps make one; a failed try lets go', async () => {
  const db = salonDb()
  const from = db.from
  db.from = (table) => {
    const q = from(table)
    if (table !== 'business_insights') return q
    const insert = q.insert
    q.insert = (row) => db.tables.business_insights.some((r) => r.organization_id === row.organization_id && r.month === row.month && r.kind === row.kind)
      ? { then: (resolve) => resolve({ data: null, error: { message: 'duplicate key value violates unique constraint' } }) }
      : insert.call(q, row)
    return q
  }
  assert.equal(await S.claimInsight(db, ORG, '2026-10', 'full', 'u1'), true)
  assert.equal(await S.claimInsight(db, ORG, '2026-10', 'full', 'u1'), false, 'a second tap waits')
  await S.dropClaim(db, ORG, '2026-10', 'full')
  assert.equal(await S.claimInsight(db, ORG, '2026-10', 'full', 'u1'), true, 'after a failure it can be tried again')
  const insight = { summary: 'Fine', good: [], improve: [], ideas: ['Offer on Tuesdays'], focus: '' }
  await S.saveInsight(db, ORG, '2026-10', 'full', insight, {})
  const saved = await S.insightsFor(db, ORG, '2026-10')
  assert.equal(saved.length, 1)
  assert.deepEqual(saved[0].insight, insight)
  await S.dropClaim(db, ORG, '2026-10', 'full')
  assert.equal((await S.insightsFor(db, ORG, '2026-10')).length, 1, 'a finished review is never dropped')
})

test('only admins open the Expenses page (salaries are private)', () => {
  assert.equal(canAccessPage({ role: 'org_admin', organization_id: ORG }, '/dashboard/expenses'), true)
  assert.equal(canAccessPage({ role: 'org_manager', organization_id: ORG }, '/dashboard/expenses'), false)
  assert.equal(canAccessPage({ role: 'sales_employee', organization_id: ORG }, '/dashboard/expenses'), false)
})
