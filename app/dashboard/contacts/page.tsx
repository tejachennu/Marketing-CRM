'use client'

import { useEffect, useState, useCallback } from 'react'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { Contact, User } from '@/lib/types'
import { Plus, Mail, Phone, Building2, Trash2, Edit2, Search, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  
  // Pagination & Search States
  const [currentPage, setCurrentPage] = useState(1)
  const [totalCount, setTotalCount] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [loadingContacts, setLoadingContacts] = useState(false)
  
  const [showAddModal, setShowAddModal] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newContact, setNewContact] = useState({
    first_name: '',
    last_name: '',
    phone_number: '',
    email: '',
    company: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // ─── Fetch Contacts ───

  const loadData = useCallback(async (pageNum = 1, searchVal = '') => {
    try {
      setLoadingContacts(true)
      await restoreSupabaseSession()

      let userId: string | null = null
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (authUser) {
        userId = authUser.id
      } else {
        const storedUser = authSessionManager.getUser()
        if (storedUser?.id) {
          userId = storedUser.id
        }
      }

      if (!userId) {
        console.log('[v0] No auth user in contacts')
        window.location.href = '/login'
        return
      }

      const email = authUser?.email || authSessionManager.getUser()?.email || ''
      const userData = await ensureUserProfile(userId, email)
      if (!userData) {
        console.error('[v0] Error fetching/creating user profile in contacts')
        return
      }
      setUser(userData)

      const limit = 10
      const res = await fetch(`/api/contacts?page=${pageNum}&limit=${limit}&search=${encodeURIComponent(searchVal)}&organizationId=${userData.organization_id}`)
      const resData = await res.json()
      if (!res.ok) {
        throw new Error(resData.error || 'Failed to fetch contacts')
      }

      setContacts(resData.contacts || [])
      setTotalCount(resData.count || 0)
      setHasMore(resData.hasMore || false)
    } catch (error) {
      console.error('[v0] Error in loadData (contacts):', error)
    } finally {
      setLoadingContacts(false)
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadData(1, '')
  }, [loadData])

  // Debounce search input
  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      setCurrentPage(1)
      loadData(1, searchTerm)
    }, 300)

    return () => clearTimeout(delayDebounceFn)
  }, [searchTerm, loadData])

  // ─── Actions ───

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage)
    loadData(newPage, searchTerm)
  }

  async function handleAddContact() {
    if (!user || !newContact.phone_number) return

    setSaving(true)
    setError(null)

    try {
      let response
      if (editingId) {
        response = await fetch('/api/contacts', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingId,
            organizationId: user.organization_id,
            first_name: newContact.first_name.trim(),
            last_name: newContact.last_name.trim(),
            phone_number: newContact.phone_number.trim(),
            email: newContact.email.trim() || null,
            company: newContact.company.trim() || null,
          }),
        })
      } else {
        response = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId: user.organization_id,
            firstName: newContact.first_name.trim(),
            lastName: newContact.last_name.trim(),
            phoneNumber: newContact.phone_number.trim(),
            email: newContact.email.trim() || null,
            company: newContact.company.trim() || null,
          }),
        })
      }

      const resData = await response.json()

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to save contact')
      }

      setShowAddModal(false)
      setEditingId(null)
      setNewContact({
        first_name: '',
        last_name: '',
        phone_number: '',
        email: '',
        company: '',
      })

      setCurrentPage(1)
      loadData(1, searchTerm)
    } catch (err) {
      console.error('Error saving contact:', err)
      setError(err instanceof Error ? err.message : 'Failed to save contact')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteContact(id: string) {
    if (!confirm('Are you sure you want to delete this contact?')) return

    try {
      const response = await fetch(`/api/contacts?id=${id}`, {
        method: 'DELETE',
      })
      const resData = await response.json()

      if (!response.ok) {
        throw new Error(resData.error || 'Failed to delete contact')
      }
      loadData(currentPage, searchTerm)
    } catch (err) {
      console.error('Error deleting contact:', err)
      alert(err instanceof Error ? err.message : 'Failed to delete contact')
    }
  }

  function handleEditContact(contact: Contact) {
    setNewContact({
      first_name: contact.first_name || '',
      last_name: contact.last_name || '',
      phone_number: contact.phone_number,
      email: contact.email || '',
      company: contact.company || '',
    })
    setEditingId(contact.id)
    setError(null)
    setShowAddModal(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="animate-spin text-[#00a884]" size={36} />
          <p className="text-sm text-slate-500 font-medium">Loading Contacts...</p>
        </div>
      </div>
    )
  }

  const limit = 10
  const startIdx = (currentPage - 1) * limit + 1
  const endIdx = Math.min(currentPage * limit, totalCount)

  return (
    <div className="p-4 md:p-6 space-y-6 animate-in fade-in duration-300 font-sans h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 select-none">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Contacts</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">Manage and organize your customer records</p>
        </div>
        <button
          onClick={() => {
            setEditingId(null)
            setError(null)
            setNewContact({
              first_name: '',
              last_name: '',
              phone_number: '',
              email: '',
              company: '',
            })
            setShowAddModal(true)
          }}
          className="bg-[#00a884] hover:bg-[#008069] text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold shadow-sm shadow-[#00a884]/10 transition-all self-start"
        >
          <Plus size={16} />
          Add Contact
        </button>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name, phone, email, or company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 focus:border-[#00a884] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] text-xs font-semibold placeholder-slate-400 dark:placeholder-slate-500 text-slate-900 dark:text-white transition-all"
          />
        </div>
      </div>

      {/* Contacts Table Wrapper */}
      <div className="bg-white dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden relative">
        {loadingContacts && (
          <div className="absolute inset-0 bg-white/50 dark:bg-slate-950/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <Loader2 className="animate-spin text-[#00a884]" size={24} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-850">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Name</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Phone</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Email</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Company</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-450 dark:text-slate-500 text-xs font-medium">
                    No contacts found. Click "Add Contact" to create one.
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => {
                  const contactName = `${contact.first_name || 'Unknown'} ${contact.last_name || ''}`.trim()
                  return (
                    <tr key={contact.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-slate-600 dark:text-slate-350 text-xs shadow-sm select-none">
                            {contactName.substring(0, 2).toUpperCase()}
                          </div>
                          <p className="font-bold text-xs text-slate-900 dark:text-white">{contactName}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                          <Phone size={13} className="text-slate-450 dark:text-slate-500" />
                          {contact.phone_number}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {contact.email ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                            <Mail size={13} className="text-slate-455 dark:text-slate-500" />
                            {contact.email}
                          </div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-[10px] font-bold">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {contact.company ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                            <Building2 size={13} className="text-slate-455 dark:text-slate-500" />
                            {contact.company}
                          </div>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 text-[10px] font-bold">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleEditContact(contact)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-blue-600 hover:text-blue-400 transition-colors cursor-pointer"
                            title="Edit"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteContact(contact.id)}
                            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-rose-600 hover:text-rose-450 transition-colors cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        {totalCount > 0 && (
          <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-4 flex-col sm:flex-row bg-white dark:bg-slate-900">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
              Showing <span className="text-slate-800">{startIdx}</span> to{' '}
              <span className="text-slate-800">{endIdx}</span> of{' '}
              <span className="text-slate-800">{totalCount}</span> entries
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => handlePageChange(currentPage - 1)}
                disabled={currentPage === 1}
                className="p-2 border border-slate-200/80 rounded-xl hover:bg-slate-50 text-slate-600 disabled:opacity-40 transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 px-2">
                Page {currentPage}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!hasMore}
                className="p-2 border border-slate-200/80 dark:border-slate-750/80 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 disabled:opacity-40 transition-colors cursor-pointer"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add/Edit Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1f2c34] rounded-lg border border-slate-200 dark:border-[#2a3942] shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white">
            <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
              {editingId ? 'Edit Contact' : 'Add New Contact'}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={newContact.first_name}
                    onChange={(e) =>
                      setNewContact({ ...newContact, first_name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all text-slate-900 dark:text-white"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={newContact.last_name}
                    onChange={(e) =>
                      setNewContact({ ...newContact, last_name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all text-slate-900 dark:text-white"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  value={newContact.phone_number}
                  onChange={(e) =>
                    setNewContact({ ...newContact, phone_number: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all text-slate-900 dark:text-white"
                  placeholder="+1234567890"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={newContact.email}
                  onChange={(e) =>
                    setNewContact({ ...newContact, email: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all text-slate-900 dark:text-white"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                  Company
                </label>
                <input
                  type="text"
                  value={newContact.company}
                  onChange={(e) =>
                    setNewContact({ ...newContact, company: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-[#2a3942] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all text-slate-900 dark:text-white"
                  placeholder="Acme Inc"
                />
              </div>

              {error && (
                <div className="bg-rose-500/10 border border-rose-500/20 text-rose-500 px-3.5 py-2.5 rounded-lg text-xs font-semibold">
                  {error}
                </div>
              )}

              <div className="flex gap-2.5 pt-4">
                <button
                  onClick={() => setShowAddModal(false)}
                  disabled={saving}
                  className="flex-1 px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-805 transition-colors disabled:opacity-50 text-xs font-bold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddContact}
                  disabled={saving || !newContact.phone_number.trim()}
                  className="flex-1 px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors disabled:opacity-50 text-xs font-bold cursor-pointer"
                >
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Add Contact'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
