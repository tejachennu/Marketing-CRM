'use client'

import { useState } from 'react'
import { AlertCircle, Check, Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS, checkImport, sampleCsv, type ImportCheck } from '@/lib/commerce/product-import'
import { formatMoney } from '@/lib/commerce/commerce-utils'
import { Modal, hintClass, primaryButton, secondaryButton, type ShowToast } from './ui'

/** Products → Upload spreadsheet: Excel or CSV, checked here first, then saved (same SKU = updated). */
export function ProductImportDialog({ orgId, currency, onClose, onDone, showToast }: { orgId: string; currency: string; onClose: () => void; onDone: () => void; showToast: ShowToast }) {
  const [rows, setRows] = useState<unknown[][] | null>(null)
  const [check, setCheck] = useState<ImportCheck | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)

  async function pick(file: File | undefined) {
    if (!file) return
    setReading(true)
    setFileName(file.name)
    try {
      const XLSX = await import('xlsx')
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const sheet = book.Sheets[book.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' }).slice(0, MAX_IMPORT_ROWS + 1)
      setRows(data)
      setCheck(checkImport(data, currency))
    } catch {
      showToast('error', 'This file could not be read. Save it as Excel (.xlsx) or CSV and try again.')
      setRows(null)
      setCheck(null)
    } finally {
      setReading(false)
    }
  }

  function downloadSample() {
    const url = URL.createObjectURL(new Blob([sampleCsv()], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'products-sample.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  async function save() {
    if (!rows) return
    setSaving(true)
    try {
      const res = await fetch('/api/commerce/products/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ organizationId: orgId, rows }) })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'The products could not be saved.')
      showToast(data.errors?.length ? 'error' : 'success', `${data.added} added, ${data.updated} updated.${data.errors?.length ? ` ${data.errors.length} rows had problems.` : ''}`)
      onDone()
      onClose()
    } catch (err: any) {
      showToast('error', err.message)
    } finally {
      setSaving(false)
    }
  }

  const updates = check?.products.length ?? 0
  return (
    <Modal title="Add products from a spreadsheet" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-slate-600 dark:text-slate-300">The first row has the headings. Only <b>Name</b> and <b>Price</b> are needed; the others are optional: {IMPORT_COLUMNS.slice(2).map((c) => c.heading).join(', ')}. A row with a SKU you already have updates that product.</p>
        <div className="flex flex-wrap gap-2">
          <label className={`${primaryButton} cursor-pointer`}>
            {reading ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />} {fileName ? 'Choose another file' : 'Choose Excel or CSV file'}
            <input type="file" accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
          </label>
          <button type="button" onClick={downloadSample} className={secondaryButton}><Download size={13} /> Sample sheet</button>
        </div>
        {fileName && <p className={`${hintClass} mt-0`}>{fileName}</p>}

        {check && (
          <>
            {check.errors.length > 0 && (
              <div role="alert" className="p-3 rounded-xl bg-[#fdf0f0] text-[#b91c1c] text-xs space-y-1 max-h-32 overflow-y-auto">
                {check.errors.slice(0, 30).map((e) => <p key={e} className="flex gap-1.5"><AlertCircle size={13} className="shrink-0 mt-px" /> {e}</p>)}
              </div>
            )}
            {check.ignored.length > 0 && <p className={`${hintClass} mt-0`}>Not used: {check.ignored.join(', ')}</p>}
            {check.products.length > 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto max-h-64">
                <table className="w-full text-xs min-w-[480px]">
                  <thead className="bg-slate-50 dark:bg-slate-900 text-slate-500 text-left sticky top-0">
                    <tr><th className="p-2 font-semibold">Name</th><th className="p-2 font-semibold">SKU</th><th className="p-2 font-semibold">Category</th><th className="p-2 font-semibold text-right">Price</th><th className="p-2 font-semibold text-right">Stock</th></tr>
                  </thead>
                  <tbody>
                    {check.products.slice(0, 100).map((p) => (
                      <tr key={p.retailer_id} className="border-t border-slate-100 dark:border-slate-800">
                        <td className="p-2 font-medium text-slate-900 dark:text-white">{p.title}</td>
                        <td className="p-2 text-slate-500">{p.retailer_id}{p.madeSku ? ' (made)' : ''}</td>
                        <td className="p-2">{p.category}</td>
                        <td className="p-2 text-right tabular-nums">{formatMoney(p.price, currency)}</td>
                        <td className="p-2 text-right tabular-nums">{p.given.includes('inventory_count') ? p.inventory_count : 'Not tracked'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {check.products.length > 100 && <p className="p-2 text-xs text-slate-500">…and {check.products.length - 100} more</p>}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
          <button type="button" onClick={save} disabled={!updates || saving} className={primaryButton}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save {updates || ''} product{updates === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
