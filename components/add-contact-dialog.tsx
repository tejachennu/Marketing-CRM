'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { UserPlus, Tag, X } from 'lucide-react'

interface AddContactDialogProps {
  organizationId: string
  onContactAdded?: () => void
}

export function AddContactDialog({
  organizationId,
  onContactAdded,
}: AddContactDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  
  const [formData, setFormData] = useState<{
    firstName: string
    lastName: string
    phoneNumber: string
    email: string
    company: string
    tags: string[]
  }>({
    firstName: '',
    lastName: '',
    phoneNumber: '',
    email: '',
    company: '',
    tags: [],
  })
  const [tagInput, setTagInput] = useState('')

  async function handleAddContact() {
    // Validate required fields
    if (!formData.firstName.trim() || !formData.phoneNumber.trim()) {
      setError('First name and phone number are required')
      return
    }

    setLoading(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId,
          firstName: formData.firstName.trim(),
          lastName: formData.lastName.trim(),
          phoneNumber: formData.phoneNumber.trim(),
          email: formData.email.trim() || null,
          company: formData.company.trim() || null,
          tags: formData.tags,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to add contact')
      }

      setSuccess(true)
      setFormData({
        firstName: '',
        lastName: '',
        phoneNumber: '',
        email: '',
        company: '',
        tags: [],
      })
      setTagInput('')

      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        onContactAdded?.()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add contact')
      console.error('[v0] Add contact error:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <UserPlus className="w-4 h-4" />
          Add Contact
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add New Contact</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4 text-slate-900 dark:text-white">
          {/* Name Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* First Name */}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-900 dark:text-slate-200">First Name *</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                placeholder="John"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
              />
            </div>

            {/* Last Name */}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-900 dark:text-slate-200">Last Name</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                placeholder="Smith"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
              />
            </div>
          </div>

          {/* Contact Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Phone Number */}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-900 dark:text-slate-200">Phone Number *</label>
              <input
                type="tel"
                value={formData.phoneNumber}
                onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                placeholder="+1 (416) 555-1234"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
              />
              <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">Include country code (e.g., +1)</p>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-1.5 text-slate-900 dark:text-slate-200">Email</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
                className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
              />
            </div>
          </div>

          {/* Company */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-900 dark:text-slate-200">Company</label>
            <input
              type="text"
              value={formData.company}
              onChange={(e) => setFormData({ ...formData, company: e.target.value })}
              placeholder="Tech Corp"
              className="w-full px-3 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-sm"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium mb-1.5 text-slate-900 dark:text-slate-200 flex items-center justify-between">
              <span>Tags</span>
              <span className="text-xs font-normal text-slate-400">press enter or comma to add</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5 p-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 rounded-lg min-h-[42px] focus-within:ring-2 focus-within:ring-emerald-500">
              {formData.tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                >
                  <Tag size={11} className="text-emerald-600 dark:text-emerald-400" />
                  <span>{t}</span>
                  <button
                    type="button"
                    onClick={() => setFormData({
                      ...formData,
                      tags: formData.tags.filter(tag => tag !== t)
                    })}
                    className="hover:text-rose-600 transition-colors ml-0.5"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    const val = tagInput.trim().replace(/^,+|,+$/g, '')
                    if (val && !formData.tags.includes(val)) {
                      setFormData({ ...formData, tags: [...formData.tags, val] })
                      setTagInput('')
                    }
                  }
                }}
                placeholder={formData.tags.length === 0 ? "e.g. VIP, Lead, Customer..." : "Add more..."}
                className="flex-1 bg-transparent border-none text-sm text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none min-w-[120px] px-1"
              />
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-500 px-3 py-2 rounded-lg text-sm font-semibold">
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 px-3 py-2 rounded-lg text-sm font-semibold">
              Contact added successfully!
            </div>
          )}

          {/* Add Button */}
          <Button
            onClick={handleAddContact}
            disabled={loading || !formData.firstName.trim() || !formData.phoneNumber.trim()}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            {loading ? 'Adding...' : 'Add Contact'}
          </Button>

          <p className="text-xs text-slate-500 dark:text-slate-400">* Required fields</p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
