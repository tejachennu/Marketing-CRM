// An in-memory stand-in for the Supabase client, enough for the salon code paths
function salonDb(seed = {}) {
  const tables = { contacts: [], conversations: [], messages: [], salon_services: [], salon_staff: [], salon_appointments: [], salon_invoices: [], ...structuredClone(seed) }
  let seq = 0
  let failNextInvoiceInsert = 0
  const from = (table) => {
    if (!tables[table]) tables[table] = []
    let filters = [], op = 'select', values, singular = false, order = null, limit = Infinity
    const q = {
      select() { return this },
      eq(k, v) { filters.push((r) => r[k] === v); return this },
      in(k, list) { filters.push((r) => list.includes(r[k])); return this },
      ilike(k, pattern) { const re = new RegExp('^' + pattern.replace(/%/g, '.*') + '$', 'i'); filters.push((r) => re.test(String(r[k] ?? ''))); return this },
      lt(k, v) { filters.push((r) => r[k] < v); return this },
      gt(k, v) { filters.push((r) => r[k] > v); return this },
      gte(k, v) { filters.push((r) => r[k] >= v); return this },
      lte(k, v) { filters.push((r) => r[k] <= v); return this },
      is(k, v) { filters.push((r) => (v === null ? r[k] === null || r[k] === undefined : r[k] === v)); return this },
      order(k, opts = {}) { order = [k, opts.ascending === false ? -1 : 1]; return this },
      limit(n) { limit = n; return this },
      maybeSingle() { singular = true; return this },
      single() { singular = true; return this },
      insert(data) { op = 'insert'; values = data; return this },
      update(data) { op = 'update'; values = data; return this },
      delete() { op = 'delete'; return this },
      then(resolve, reject) {
        let rows = tables[table].filter((r) => filters.every((f) => f(r)))
        if (op === 'insert') {
          const items = (Array.isArray(values) ? values : [values]).map((v) => ({ id: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, created_at: new Date(Date.now() + seq).toISOString(), ...structuredClone(v) }))
          if (table === 'salon_invoices') {
            if (failNextInvoiceInsert > 0) { failNextInvoiceInsert--; return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } }).then(resolve, reject) }
            if (items.some((item) => tables.salon_invoices.some((r) => r.organization_id === item.organization_id && r.seq === item.seq))) return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } }).then(resolve, reject)
          }
          tables[table].push(...items)
          rows = items
        } else if (op === 'update') rows.forEach((r) => Object.assign(r, structuredClone(values)))
        else if (op === 'delete') tables[table] = tables[table].filter((r) => !rows.includes(r))
        if (order) rows = [...rows].sort((a, b) => (a[order[0]] > b[order[0]] ? 1 : a[order[0]] < b[order[0]] ? -1 : 0) * order[1])
        rows = rows.slice(0, limit)
        return Promise.resolve({ data: structuredClone(singular ? rows[0] || null : rows), error: null }).then(resolve, reject)
      },
    }
    return q
  }
  return { from, tables, failInvoiceInserts: (n) => { failNextInvoiceInsert = n } }
}

module.exports = { salonDb }
