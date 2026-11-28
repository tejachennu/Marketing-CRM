'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Search } from 'lucide-react'
import { categoryChoices, categoryLabel } from '@/lib/expenses/rules'

/**
 * "What for": a box to type in that searches the categories (built-in ones and the ones this business added), and
 * offers "Add …" when the typed name is new. The new name is saved with the expense, so it is in the list next time.
 * The list opens under the box (not floating), so it is never cut off inside the form's window.
 */
export function CategoryPicker({ value, own, onChange }: { value: string; own: string[]; onChange: (key: string) => void }) {
  const listId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  // A category typed in this form but not saved yet still shows as picked
  const known = useMemo(() => (value && !own.some((o) => o.toLowerCase() === value.toLowerCase()) && categoryLabel(value) === value ? [...own, value] : own), [own, value])
  const { choices, add } = useMemo(() => categoryChoices(query, known), [query, known])
  const items = [...choices.map((c) => ({ ...c, add: false })), ...(add ? [{ key: add, label: add, own: true, add: true }] : [])]

  const show = () => { setOpen(true); setQuery(''); setActive(0) }
  const pick = (key: string) => {
    onChange(key)
    setOpen(false)
    setQuery('')
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); if (!open) show(); else setActive((i) => Math.min(i + 1, items.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (event.key === 'Enter') {
      if (open && items[active]) { event.preventDefault(); pick(items[active].key) }
    } else if (event.key === 'Escape' && open) {
      // Close the list only, not the whole form
      event.stopPropagation()
      setOpen(false)
      setQuery('')
    }
  }

  return (
    <div>
      <div className="relative">
        <Search size={17} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#8a94a8] pointer-events-none" aria-hidden />
        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${listId}-${active}` : undefined}
          aria-label="What for: type to search or add your own"
          className="w-full h-12 rounded-xl border border-[#d5ddeb] dark:border-slate-700 bg-white dark:bg-[#111b21] pl-10 pr-10 text-[15.5px] font-semibold text-[#0E1B3D] dark:text-white placeholder:font-normal placeholder:text-[#8a94a8] outline-none focus:border-[#008069] focus:ring-2 focus:ring-[#008069]/20"
          placeholder="Search or type a new one, e.g. Tea and snacks"
          value={open ? query : value ? categoryLabel(value) : ''}
          maxLength={40}
          onFocus={show}
          onClick={() => { if (!open) show() }}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0) }}
          onKeyDown={onKeyDown}
          onBlur={() => { setOpen(false); setQuery('') }}
        />
        <button type="button" tabIndex={-1} aria-label={open ? 'Close the list' : 'Show all'} onMouseDown={(event) => { event.preventDefault(); if (open) { setOpen(false); inputRef.current?.blur() } else inputRef.current?.focus() }}
          className="absolute right-1 top-1/2 -translate-y-1/2 h-10 w-10 flex items-center justify-center rounded-lg text-[#6B7894] hover:bg-[#f4f6fa] dark:hover:bg-slate-800 cursor-pointer">
          <ChevronDown size={18} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <ul id={listId} role="listbox" aria-label="Kinds of expense" className="mt-1.5 max-h-64 overflow-y-auto rounded-xl border border-[#e3e8f2] dark:border-slate-700 bg-white dark:bg-[#111b21] py-1 shadow-sm">
          {items.length === 0 && <li className="px-3.5 py-3 text-[14px] text-[#6B7894]">Type at least 2 letters to add your own.</li>}
          {items.map((item, index) => {
            const selected = !item.add && item.key === value
            return (
              <li key={`${item.add ? 'add:' : ''}${item.key}`} id={`${listId}-${index}`} role="option" aria-selected={selected}
                onMouseDown={(event) => { event.preventDefault(); pick(item.key) }}
                onMouseEnter={() => setActive(index)}
                className={`flex items-center gap-2.5 min-h-11 px-3.5 py-2 cursor-pointer text-[15px] ${index === active ? 'bg-[#eef1f6] dark:bg-slate-800' : ''} ${item.add ? 'text-[#008069] font-semibold border-t border-[#eef1f6] dark:border-slate-800' : 'text-[#0E1B3D] dark:text-white'}`}>
                {item.add ? <Plus size={17} className="shrink-0" /> : <Check size={17} className={`shrink-0 ${selected ? 'text-[#008069]' : 'invisible'}`} />}
                <span className="min-w-0 flex-1 truncate">{item.add ? `Add “${item.label}”` : item.label}</span>
                {!item.add && item.own && <span className="shrink-0 text-[12px] font-semibold text-[#6B7894] bg-[#f4f6fa] dark:bg-slate-800 rounded-full px-2 py-0.5">Yours</span>}
              </li>
            )
          })}
        </ul>
      )}
      {!open && <p className="text-[12.5px] text-[#6B7894] mt-1">Not in the list? Type it and tap Add. It is kept for next time.</p>}
    </div>
  )
}
