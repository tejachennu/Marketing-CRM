'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { Contact, User } from '@/lib/types'
import { Plus, Mail, Phone, Building2, Trash2, Edit2, Search, ChevronLeft, ChevronRight, Loader2, Upload, FileSpreadsheet, X, CheckCircle } from 'lucide-react'

// ─── Smart Header Matchers ───

function findContactNameHeader(headers: string[]): string {
  if (!headers || headers.length === 0) return ''
  const priority1 = headers.find(h => 
    /^(?:contact[\s_-]?name|first[\s_-]?name|firstname|customer[\s_-]?name|client[\s_-]?name|patient[\s_-]?name|lead[\s_-]?name|user[\s_-]?name|full[\s_-]?name|name)$/i.test(h.trim())
  )
  if (priority1) return priority1
  const priority2 = headers.find(h => 
    /(?:contact|first|customer|client|patient|lead|user|full).*name/i.test(h) && !/number|phone|mobile|email|id/i.test(h)
  )
  if (priority2) return priority2
  const priority3 = headers.find(h => 
    /name/i.test(h) && !/number|num|phone|mobile|email|mail|file|org|company/i.test(h)
  )
  return priority3 || ''
}

function findPhoneHeader(headers: string[]): string {
  if (!headers || headers.length === 0) return ''
  const priority1 = headers.find(h => 
    !/name/i.test(h) && /^(?:phone|phone[\s_-]?number|mobile|mobile[\s_-]?number|contact[\s_-]?(?:number|no|num)|cell|cell[\s_-]?phone|whatsapp|whatsapp[\s_-]?number|tel|telephone)$/i.test(h.trim())
  )
  if (priority1) return priority1
  const priority2 = headers.find(h => 
    !/name/i.test(h) && /(?:phone|mobile|cell|whatsapp|tel).*(?:num|no|tel)|(?:^|\b)(?:phone|mobile|cell|tel|telephone)(?:\b|$)/i.test(h)
  )
  if (priority2) return priority2
  const priority3 = headers.find(h => !/name/i.test(h) && /phone|mobile|number|num/i.test(h))
  return priority3 || headers[0] || ''
}

function findEmailHeader(headers: string[]): string {
  if (!headers || headers.length === 0) return ''
  return headers.find(h => /email|e-mail|mail/i.test(h)) || ''
}

function findCompanyHeader(headers: string[]): string {
  if (!headers || headers.length === 0) return ''
  return headers.find(h => /company|org|organization|clinic|hospital|business/i.test(h)) || ''
}

function findTagsHeader(headers: string[]): string {
  if (!headers || headers.length === 0) return ''
  return headers.find(h => /^(?:tag|tags|category|categories|label|labels|group|segment|type)$/i.test(h.trim())) || 
         headers.find(h => /tag|category|label|group|segment/i.test(h)) || ''
}

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
    tags: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Excel Import States
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importData, setImportData] = useState<any[]>([])
  const [importHeaders, setImportHeaders] = useState<string[]>([])
  const [nameColumn, setNameColumn] = useState('')
  const [phoneColumn, setPhoneColumn] = useState('')
  const [emailColumn, setEmailColumn] = useState('')
  const [companyColumn, setCompanyColumn] = useState('')
  const [tagsColumn, setTagsColumn] = useState('')
  const [defaultTag, setDefaultTag] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
      const res = await fetch(`/api/contacts?page=${pageNum}&limit=${limit}&search=${encodeURIComponent(searchVal)}`)
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

    const parsedTags = newContact.tags.trim() 
      ? newContact.tags.split(/[,;|]/).map(t => t.trim()).filter(Boolean) 
      : []

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
            tags: parsedTags,
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
            tags: parsedTags,
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
        tags: '',
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
      tags: Array.isArray(contact.tags) ? contact.tags.join(', ') : '',
    })
    setEditingId(contact.id)
    setError(null)
    setShowAddModal(true)
  }

  // ─── Excel Import Functions ───

  const handleExcelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFile(file)
    setImportError(null)
    setImportSuccess(null)

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = evt.target?.result
        const workbook = XLSX.read(data, { type: 'array' })
        const sheetName = workbook.SheetNames[0]
        const worksheet = workbook.Sheets[sheetName]
        const json: any[] = XLSX.utils.sheet_to_json(worksheet)

        if (json.length === 0) {
          setImportError('The Excel sheet appears to be empty.')
          return
        }

        setImportData(json)
        const headers = Object.keys(json[0] || {})
        setImportHeaders(headers)

        // Smart auto-detection of columns
        setNameColumn(findContactNameHeader(headers))
        setPhoneColumn(findPhoneHeader(headers))
        setEmailColumn(findEmailHeader(headers))
        setCompanyColumn(findCompanyHeader(headers))
        setTagsColumn(findTagsHeader(headers))
      } catch (err) {
        console.error('Excel parse error:', err)
        setImportError('Failed to parse Excel file. Ensure it is a valid .xlsx or .csv sheet.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleImportContacts = async () => {
    if (!user || !phoneColumn || importData.length === 0) {
      setImportError('Please ensure a valid file is loaded and a Phone Number column is mapped.')
      return
    }

    setIsImporting(true)
    setImportError(null)
    setImportSuccess(null)

    try {
      let importedCount = 0
      let failedCount = 0

      for (const row of importData) {
        const rawPhone = String(row[phoneColumn] || '').replace(/[^\d+]/g, '')
        if (!rawPhone || rawPhone.length < 6) {
          failedCount++
          continue
        }

        const rawName = nameColumn ? String(row[nameColumn] || '').trim() : ''
        let firstName = 'Contact'
        let lastName = ''
        if (rawName) {
          const parts = rawName.split(/\s+/)
          firstName = parts[0]
          lastName = parts.slice(1).join(' ')
        }

        const rawEmail = emailColumn ? String(row[emailColumn] || '').trim() : null
        const rawCompany = companyColumn ? String(row[companyColumn] || '').trim() : null

        // Parse tags from Excel column + default tag input
        const rawRowTags = tagsColumn ? String(row[tagsColumn] || '').trim() : ''
        const parsedRowTags = rawRowTags ? rawRowTags.split(/[,;|]/).map(t => t.trim()).filter(Boolean) : []
        const parsedDefaultTags = defaultTag.trim() ? defaultTag.split(/[,;|]/).map(t => t.trim()).filter(Boolean) : []
        const combinedTags = Array.from(new Set([...parsedRowTags, ...parsedDefaultTags]))

        const res = await fetch('/api/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organizationId: user.organization_id,
            firstName,
            lastName,
            phoneNumber: rawPhone,
            email: rawEmail || null,
            company: rawCompany || null,
            tags: combinedTags,
          }),
        })

        if (res.ok) {
          importedCount++
        } else {
          failedCount++
        }
      }

      setImportSuccess(`Successfully imported ${importedCount} contacts${failedCount > 0 ? ` (${failedCount} skipped/failed)` : ''}!`)
      loadData(1, searchTerm)
      setTimeout(() => {
        if (importedCount > 0) {
          setShowImportModal(false)
          setImportFile(null)
          setImportData([])
          setImportHeaders([])
          setDefaultTag('')
        }
      }, 1500)
    } catch (err: any) {
      console.error('Import error:', err)
      setImportError(err.message || 'Failed to import contacts')
    } finally {
      setIsImporting(false)
    }
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
    <div className="p-4 md:p-6 space-y-6 animate-in fade-in duration-300 font-sans h-full overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 select-none">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111b21]">Contacts</h1>
          <p className="text-xs text-[#667781] mt-1 font-semibold">Manage and organize your customer records</p>
        </div>
        <div className="flex items-center gap-2 self-start">
          <button
            onClick={() => {
              setImportFile(null)
              setImportData([])
              setImportHeaders([])
              setImportError(null)
              setImportSuccess(null)
              setShowImportModal(true)
            }}
            className="bg-white hover:bg-[#f0f2f5] text-[#54656f] border border-[#e9edef] px-3.5 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold shadow-sm transition-all"
          >
            <FileSpreadsheet size={16} className="text-[#00a884]" />
            Import Excel
          </button>
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
                tags: '',
              })
              setShowAddModal(true)
            }}
            className="bg-[#00a884] hover:bg-[#008069] text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold shadow-sm shadow-[#00a884]/10 transition-all"
          >
            <Plus size={16} />
            Add Contact
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3.5 text-[#8696a0]" />
          <input
            type="text"
            placeholder="Search by name, phone, email, or company..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none focus:ring-1 focus:ring-[#00a884] text-xs font-semibold placeholder-[#8696a0] transition-all"
          />
        </div>
      </div>

      {/* Contacts Table Wrapper */}
      <div className="bg-white rounded-lg border border-[#e9edef] shadow-sm overflow-hidden relative">
        {loadingContacts && (
          <div className="absolute inset-0 bg-white/50 backdrop-blur-[1px] z-10 flex items-center justify-center">
            <Loader2 className="animate-spin text-[#00a884]" size={24} />
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#f0f2f5] border-b border-[#e9edef]">
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#54656f]">Name</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#54656f]">Phone</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#54656f]">Email</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#54656f]">Company</th>
                <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[#54656f] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {contacts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 text-xs font-medium">
                    No contacts found. Click "Add Contact" to create one.
                  </td>
                </tr>
              ) : (
                contacts.map((contact) => {
                  const contactName = `${contact.first_name || 'Unknown'} ${contact.last_name || ''}`.trim()
                  return (
                    <tr key={contact.id} className="hover:bg-[#f5f6f6]/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-full bg-[#dfe5e7] border border-[#e9edef] flex items-center justify-center font-bold text-[#54656f] text-xs shadow-sm select-none flex-shrink-0">
                            {contactName.substring(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-xs text-[#111b21]">{contactName}</p>
                            {contact.tags && Array.isArray(contact.tags) && contact.tags.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {contact.tags.map((t, idx) => (
                                  <span key={idx} className="bg-[#e7f7f4] text-[#008069] text-[9px] font-bold px-1.5 py-0.5 rounded border border-[#00a884]/20">
                                    {t}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                          <Phone size={13} className="text-slate-400" />
                          {contact.phone_number}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {contact.email ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                            <Mail size={13} className="text-slate-400" />
                            {contact.email}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[10px] font-bold">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {contact.company ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
                            <Building2 size={13} className="text-slate-400" />
                            {contact.company}
                          </div>
                        ) : (
                          <span className="text-slate-300 text-[10px] font-bold">—</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleEditContact(contact)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-blue-600 hover:text-blue-700 transition-colors"
                            title="Edit"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDeleteContact(contact.id)}
                            className="p-1.5 hover:bg-slate-100 rounded-lg text-rose-600 hover:text-rose-700 transition-colors"
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
          <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-4 flex-col sm:flex-row">
            <p className="text-xs font-semibold text-slate-500">
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
              <span className="text-xs font-bold text-slate-700 px-2">
                Page {currentPage}
              </span>
              <button
                onClick={() => handlePageChange(currentPage + 1)}
                disabled={!hasMore}
                className="p-2 border border-slate-200/80 rounded-xl hover:bg-slate-50 text-slate-600 disabled:opacity-40 transition-colors"
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
          <div className="bg-white rounded-lg border border-[#e9edef] shadow-xl max-w-md w-full p-6 animate-in zoom-in-95 duration-200">
            <h2 className="text-base font-bold text-[#111b21] mb-4">
              {editingId ? 'Edit Contact' : 'Add New Contact'}
            </h2>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                    First Name
                  </label>
                  <input
                    type="text"
                    value={newContact.first_name}
                    onChange={(e) =>
                      setNewContact({ ...newContact, first_name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all"
                    placeholder="John"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                    Last Name
                  </label>
                  <input
                    type="text"
                    value={newContact.last_name}
                    onChange={(e) =>
                      setNewContact({ ...newContact, last_name: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all"
                    placeholder="Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                  Phone Number *
                </label>
                <input
                  type="tel"
                  value={newContact.phone_number}
                  onChange={(e) =>
                    setNewContact({ ...newContact, phone_number: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all"
                  placeholder="+1234567890"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                  Email
                </label>
                <input
                  type="email"
                  value={newContact.email}
                  onChange={(e) =>
                    setNewContact({ ...newContact, email: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all"
                  placeholder="john@example.com"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                  Company
                </label>
                <input
                  type="text"
                  value={newContact.company}
                  onChange={(e) =>
                    setNewContact({ ...newContact, company: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all"
                  placeholder="Acme Inc"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                  Tags (Optional, comma-separated)
                </label>
                <input
                  type="text"
                  value={newContact.tags}
                  onChange={(e) =>
                    setNewContact({ ...newContact, tags: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-[#e9edef] focus:border-[#00a884] rounded-lg focus:outline-none text-xs font-semibold transition-all"
                  placeholder="e.g. Lead, VIP, August Campaign"
                />
              </div>

              {error && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600 px-3.5 py-2.5 rounded-lg text-xs font-semibold">
                  {error}
                </div>
              )}

              <div className="flex gap-2.5 pt-4">
                <button
                  onClick={() => setShowAddModal(false)}
                  disabled={saving}
                  className="flex-1 px-4 py-2 border border-[#e9edef] rounded-lg text-[#54656f] hover:bg-slate-50 transition-colors disabled:opacity-50 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddContact}
                  disabled={saving || !newContact.phone_number.trim()}
                  className="flex-1 px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors disabled:opacity-50 text-xs font-bold"
                >
                  {saving ? 'Saving...' : editingId ? 'Update' : 'Add Contact'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Excel / CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl border border-[#e9edef] animate-in fade-in zoom-in-95 duration-200">
            <div className="bg-[#f0f2f5] border-b border-[#e9edef] px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-[#e7f7f4] flex items-center justify-center text-[#008069]">
                  <FileSpreadsheet size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-[#111b21]">Import Contacts from Excel / CSV</h3>
                  <p className="text-[10px] text-[#667781] font-medium">Upload spreadsheet and map columns</p>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-[#8696a0] hover:text-[#111b21] p-1 rounded-lg hover:bg-slate-200/50 transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#e9edef] hover:border-[#00a884] rounded-2xl p-6 text-center cursor-pointer transition-all bg-[#f8f9fa] flex flex-col items-center justify-center gap-2"
              >
                <Upload size={28} className="text-[#8696a0]" />
                <span className="text-xs font-bold text-[#111b21]">
                  {importFile ? importFile.name : 'Click to upload Excel or CSV file'}
                </span>
                <span className="text-[10px] text-[#667781]">Supports .xlsx, .xls, .csv</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleExcelFileChange}
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                />
              </div>

              {importData.length > 0 && (
                <div className="space-y-3">
                  <div className="p-3 bg-[#e7f7f4] border border-[#00a884]/20 rounded-xl flex items-center justify-between text-xs text-[#008069]">
                    <span className="font-bold flex items-center gap-1.5">
                      <CheckCircle size={14} /> Loaded {importData.length} rows from sheet!
                    </span>
                    <button
                      onClick={() => {
                        setImportFile(null)
                        setImportData([])
                        setImportHeaders([])
                        setDefaultTag('')
                      }}
                      className="p-1 hover:bg-[#008069]/10 rounded-full"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="space-y-2.5">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                        Contact Name Column (First Name / Full Name)
                      </label>
                      <select
                        value={nameColumn}
                        onChange={(e) => setNameColumn(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      >
                        <option value="">-- Optional / None --</option>
                        {importHeaders.map(h => (
                          <option key={h} value={h}>{h} {h === nameColumn ? '✓' : ''}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                        Phone Number Column *
                      </label>
                      <select
                        value={phoneColumn}
                        onChange={(e) => setPhoneColumn(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      >
                        <option value="">-- Choose phone column --</option>
                        {importHeaders.map(h => (
                          <option key={h} value={h}>{h} {h === phoneColumn ? '✓' : ''}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                        Email Address Column (Optional)
                      </label>
                      <select
                        value={emailColumn}
                        onChange={(e) => setEmailColumn(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      >
                        <option value="">-- Optional / None --</option>
                        {importHeaders.map(h => (
                          <option key={h} value={h}>{h} {h === emailColumn ? '✓' : ''}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                        Company Column (Optional)
                      </label>
                      <select
                        value={companyColumn}
                        onChange={(e) => setCompanyColumn(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      >
                        <option value="">-- Optional / None --</option>
                        {importHeaders.map(h => (
                          <option key={h} value={h}>{h} {h === companyColumn ? '✓' : ''}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                        Tags Column (Optional, from Excel)
                      </label>
                      <select
                        value={tagsColumn}
                        onChange={(e) => setTagsColumn(e.target.value)}
                        className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      >
                        <option value="">-- Optional / None --</option>
                        {importHeaders.map(h => (
                          <option key={h} value={h}>{h} {h === tagsColumn ? '✓' : ''}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#54656f] mb-1">
                        Additional Default Tag for All Imported Contacts (Optional)
                      </label>
                      <input
                        type="text"
                        value={defaultTag}
                        onChange={(e) => setDefaultTag(e.target.value)}
                        placeholder="e.g. Excel Import, August Campaign"
                        className="w-full px-3 py-2 bg-white border border-[#e9edef] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884]"
                      />
                    </div>
                  </div>
                </div>
              )}

              {importError && (
                <div className="bg-rose-50 border border-rose-100 text-rose-600 px-3.5 py-2.5 rounded-lg text-xs font-semibold">
                  {importError}
                </div>
              )}

              {importSuccess && (
                <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 px-3.5 py-2.5 rounded-lg text-xs font-semibold">
                  {importSuccess}
                </div>
              )}

              <div className="flex gap-2.5 pt-4">
                <button
                  onClick={() => setShowImportModal(false)}
                  disabled={isImporting}
                  className="flex-1 px-4 py-2.5 border border-[#e9edef] rounded-lg text-[#54656f] hover:bg-slate-50 transition-colors disabled:opacity-50 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={handleImportContacts}
                  disabled={isImporting || !phoneColumn || importData.length === 0}
                  className="flex-1 px-4 py-2.5 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg transition-colors disabled:opacity-50 text-xs font-bold flex items-center justify-center gap-2"
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Importing...</span>
                    </>
                  ) : (
                    <span>Import {importData.length > 0 ? `${importData.length} Contacts` : 'Contacts'}</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
