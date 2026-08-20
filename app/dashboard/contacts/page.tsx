'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase, restoreSupabaseSession, ensureUserProfile } from '@/lib/supabase'
import { authSessionManager } from '@/lib/auth-context'
import { Contact, User } from '@/lib/types'
import { 
  Plus, 
  Mail, 
  Phone, 
  Building2, 
  Trash2, 
  Edit2, 
  Search, 
  ChevronLeft, 
  ChevronRight, 
  Loader2, 
  FileSpreadsheet, 
  Upload, 
  X, 
  CheckCircle2, 
  AlertCircle 
} from 'lucide-react'
import { useConfirm, useAlert } from '@/lib/dialog-context'

export default function ContactsPage() {
  const confirm = useConfirm()
  const alert = useAlert()
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

  // Bulk Excel/CSV Import State
  const [showImportModal, setShowImportModal] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importData, setImportData] = useState<any[]>([])
  const [importHeaders, setImportHeaders] = useState<string[]>([])
  const [importColumnMapping, setImportColumnMapping] = useState({
    name: '',
    lastName: '',
    phone: '',
    email: '',
    company: '',
  })
  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)

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
        console.log('[Contacts] No auth user found')
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
      const res = await fetch(`/api/contacts?page=${pageNum}&limit=${limit}&search=${encodeURIComponent(searchVal)}&organizationId=${userData.organization_id}&_t=${Date.now()}`, {
        cache: 'no-store'
      })
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
    const confirmed = await confirm({
      title: 'Delete Contact',
      message: 'Are you sure you want to delete this contact?',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel'
    })
    if (!confirmed) return

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
      await alert({
        title: 'Delete Failed',
        message: err instanceof Error ? err.message : 'Failed to delete contact'
      })
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

  // ─── Bulk Excel / CSV Import Handlers ───

  const handleImportFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
          setImportError('The uploaded file appears to be empty.')
          return
        }

        setImportData(json)
        const headers = Object.keys(json[0] || {})
        setImportHeaders(headers)

        // Strict phone column matcher (exclude 'name')
        const phoneKey = headers.find(h => {
          const clean = h.trim().toLowerCase()
          if (/name/i.test(clean)) return false
          return (
            /phone|mobile|cell|tel|whatsapp/i.test(clean) ||
            /contact.*(num|no|#)/i.test(clean) ||
            /phone.*(num|no|#)/i.test(clean) ||
            /mobile.*(num|no|#)/i.test(clean) ||
            /^(phone|mobile|cell|tel|whatsapp|contact_no|phone_no|mobile_no)$/i.test(clean)
          )
        }) || ''

        // Smart name matchers
        const nameKey = headers.find(h => 
          /^(contact\s*name|first\s*name|customer\s*name|patient\s*name|full\s*name|client\s*name|name)$/i.test(h.trim())
        ) || headers.find(h => 
          /contact.*name|first.*name|customer.*name|patient.*name|full.*name|client.*name|^name$/i.test(h.trim())
        ) || ''

        const lastNameKey = headers.find(h => 
          /^(last\s*name|surname)$/i.test(h.trim())
        ) || headers.find(h => /last.*name|surname/i.test(h.trim())) || ''

        const emailKey = headers.find(h => /email|mail|e-mail/i.test(h.trim())) || ''
        const companyKey = headers.find(h => /company|organization|org|business|hospital|clinic/i.test(h.trim())) || ''

        setImportColumnMapping({
          name: nameKey,
          lastName: lastNameKey,
          phone: phoneKey,
          email: emailKey,
          company: companyKey,
        })
      } catch (err: any) {
        console.error('Error reading import file:', err)
        setImportError('Failed to parse file. Please upload a valid .xlsx, .xls, or .csv file.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleExecuteImport = async () => {
    if (!user || !importColumnMapping.phone) {
      setImportError('Please select which column contains the Phone Number.')
      return
    }

    setIsImporting(true)
    setImportError(null)
    setImportSuccess(null)

    try {
      const contactsToImport = importData.map(row => {
        let firstName = ''
        let lastName = ''
        if (importColumnMapping.name) {
          const rawName = String(row[importColumnMapping.name] || '').trim()
          if (importColumnMapping.lastName && row[importColumnMapping.lastName]) {
            firstName = rawName
            lastName = String(row[importColumnMapping.lastName] || '').trim()
          } else {
            const parts = rawName.split(/\s+/).filter(Boolean)
            if (parts.length === 1) {
              firstName = parts[0]
              lastName = ''
            } else if (parts.length > 1) {
              firstName = parts[0]
              lastName = parts.slice(1).join(' ')
            }
          }
        }
        return {
          firstName,
          lastName,
          phoneNumber: importColumnMapping.phone ? String(row[importColumnMapping.phone] || '') : '',
          email: importColumnMapping.email ? String(row[importColumnMapping.email] || '') : '',
          company: importColumnMapping.company ? String(row[importColumnMapping.company] || '') : '',
        }
      })

      const res = await fetch('/api/contacts/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: user.organization_id,
          contacts: contactsToImport
        })
      })

      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to import contacts')
      }

      setImportSuccess(data.message || `Import complete: ${data.imported} contacts imported (${data.skipped} skipped/duplicates).`)
      await loadData(1, searchTerm)

      setTimeout(() => {
        setShowImportModal(false)
        setImportFile(null)
        setImportData([])
        setImportHeaders([])
        setImportSuccess(null)
      }, 2000)
    } catch (err: any) {
      console.error('Import execution error:', err)
      setImportError(err.message || 'Error occurred during import.')
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
    <div className="p-4 md:p-6 space-y-6 animate-in fade-in duration-300 font-sans h-full overflow-y-auto bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 select-none">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">Contacts</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">Manage and organize your customer records</p>
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
            className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 px-3.5 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold shadow-sm transition-all cursor-pointer"
          >
            <FileSpreadsheet size={16} className="text-emerald-600 dark:text-emerald-400" />
            Import Excel / CSV
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
              })
              setShowAddModal(true)
            }}
            className="bg-[#00a884] hover:bg-[#008069] text-white px-4 py-2.5 rounded-lg flex items-center justify-center gap-2 text-xs font-bold shadow-sm shadow-[#00a884]/10 transition-all cursor-pointer"
          >
            <Plus size={16} />
            Add Contact
          </button>
        </div>
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

        {/* Desktop View: Table */}
        <div className="overflow-x-auto hidden md:block">
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

        {/* Mobile View: Cards */}
        <div className="block md:hidden divide-y divide-slate-150 dark:divide-slate-800">
          {contacts.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-450 dark:text-slate-500 text-xs font-medium">
              No contacts found. Click "Add Contact" to create one.
            </div>
          ) : (
            contacts.map((contact) => {
              const contactName = `${contact.first_name || 'Unknown'} ${contact.last_name || ''}`.trim()
              return (
                <div key={contact.id} className="p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-center font-bold text-slate-600 dark:text-slate-350 text-xs shadow-sm select-none">
                        {contactName.substring(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-xs text-slate-900 dark:text-white leading-tight">{contactName}</p>
                        {contact.company && (
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{contact.company}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditContact(contact)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-blue-600 hover:text-blue-400 transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => handleDeleteContact(contact.id)}
                        className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-rose-600 hover:text-rose-450 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Phone size={12} className="text-slate-400 shrink-0" />
                      <span className="truncate">{contact.phone_number}</span>
                    </div>
                    {contact.email && (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Mail size={12} className="text-slate-400 shrink-0" />
                        <span className="truncate">{contact.email}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })
          )}
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

      {/* Bulk Excel / CSV Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-[#1f2c34] rounded-xl border border-slate-200 dark:border-[#2a3942] shadow-2xl max-w-2xl w-full p-6 animate-in zoom-in-95 duration-200 text-slate-900 dark:text-white max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-lg">
                  <FileSpreadsheet size={20} />
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    Import Contacts from Excel / CSV
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Upload an .xlsx, .xls, or .csv spreadsheet to bulk import contacts.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  if (!isImporting) setShowImportModal(false)
                }}
                disabled={isImporting}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4 py-4 overflow-y-auto pr-1 flex-1">
              {/* File Dropzone */}
              {!importData.length ? (
                <div
                  onClick={() => importFileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 dark:border-[#3b4a54] hover:border-[#00a884] dark:hover:border-[#00a884] rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-slate-50/50 dark:bg-[#111b21]/50 hover:bg-emerald-50/20 transition-all group"
                >
                  <input
                    ref={importFileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={handleImportFileUpload}
                    className="hidden"
                  />
                  <div className="p-3 bg-white dark:bg-slate-800 rounded-full shadow-sm text-slate-400 group-hover:text-[#00a884] transition-colors">
                    <Upload size={24} />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                      Click to upload or drag & drop Excel / CSV file
                    </p>
                    <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                      Supports .xlsx, .xls, and .csv files with contact names and phone numbers
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* File Info Bar */}
                  <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 p-3 rounded-xl">
                    <div className="flex items-center gap-2.5">
                      <FileSpreadsheet size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200 truncate max-w-xs">
                          {importFile?.name}
                        </p>
                        <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-semibold">
                          {importData.length} records detected • {importHeaders.length} columns
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setImportFile(null)
                        setImportData([])
                        setImportHeaders([])
                      }}
                      className="text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-rose-600 transition-colors px-2 py-1"
                    >
                      Change File
                    </button>
                  </div>

                  {/* Column Mapping Selectors */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider mb-2.5">
                      Verify Column Mappings
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50 dark:bg-[#111b21] p-3.5 rounded-xl border border-slate-200 dark:border-[#2a3942]">
                      {/* Name Column */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                          Contact Name / Full Name / First Name
                        </label>
                        <select
                          value={importColumnMapping.name}
                          onChange={(e) => setImportColumnMapping(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                        >
                          <option value="">-- Do not map (Default to "Campaign Contact") --</option>
                          {importHeaders.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      {/* Last Name Column */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                          Last Name (Optional if Full Name mapped)
                        </label>
                        <select
                          value={importColumnMapping.lastName}
                          onChange={(e) => setImportColumnMapping(prev => ({ ...prev, lastName: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                        >
                          <option value="">-- None / Split from full name --</option>
                          {importHeaders.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      {/* Phone Number Column */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1 flex items-center gap-1">
                          <span>Phone Number *</span>
                          <span className="text-[9px] font-normal text-slate-400">(Required)</span>
                        </label>
                        <select
                          value={importColumnMapping.phone}
                          onChange={(e) => setImportColumnMapping(prev => ({ ...prev, phone: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-emerald-300 dark:border-emerald-700/60 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-[#00a884] text-slate-900 dark:text-white"
                          required
                        >
                          <option value="">-- Select Phone Number Column --</option>
                          {importHeaders.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      {/* Email Column */}
                      <div>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                          Email (Optional)
                        </label>
                        <select
                          value={importColumnMapping.email}
                          onChange={(e) => setImportColumnMapping(prev => ({ ...prev, email: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                        >
                          <option value="">-- Do not map --</option>
                          {importHeaders.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>

                      {/* Company Column */}
                      <div className="sm:col-span-2">
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1">
                          Company / Organization (Optional)
                        </label>
                        <select
                          value={importColumnMapping.company}
                          onChange={(e) => setImportColumnMapping(prev => ({ ...prev, company: e.target.value }))}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-[#1f2c34] border border-slate-200 dark:border-[#3b4a54] rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-[#00a884] dark:text-white"
                        >
                          <option value="">-- Do not map --</option>
                          {importHeaders.map(h => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Preview Table */}
                  <div>
                    <h3 className="text-xs font-bold text-slate-800 dark:text-white uppercase tracking-wider mb-2">
                      Preview (First {Math.min(5, importData.length)} Contacts)
                    </h3>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-[#2a3942]">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold border-b border-slate-200 dark:border-[#2a3942]">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Phone</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2">Company</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                          {importData.slice(0, 5).map((row, idx) => {
                            const nameVal = importColumnMapping.name ? row[importColumnMapping.name] : ''
                            const lastVal = importColumnMapping.lastName ? row[importColumnMapping.lastName] : ''
                            const displayName = lastVal ? `${nameVal} ${lastVal}`.trim() : (nameVal || '—')
                            const phoneVal = importColumnMapping.phone ? row[importColumnMapping.phone] : '—'
                            const emailVal = importColumnMapping.email ? row[importColumnMapping.email] : '—'
                            const compVal = importColumnMapping.company ? row[importColumnMapping.company] : '—'

                            return (
                              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                <td className="px-3 py-2 text-slate-900 dark:text-white font-bold">{displayName}</td>
                                <td className="px-3 py-2 font-mono text-emerald-600 dark:text-emerald-400">{phoneVal || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{emailVal || '—'}</td>
                                <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{compVal || '—'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {importError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400 text-xs font-semibold rounded-lg flex items-center gap-2">
                  <AlertCircle size={15} className="shrink-0" />
                  <span>{importError}</span>
                </div>
              )}

              {importSuccess && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-lg flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{importSuccess}</span>
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                disabled={isImporting}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              {importData.length > 0 && (
                <button
                  type="button"
                  onClick={handleExecuteImport}
                  disabled={isImporting || !importColumnMapping.phone}
                  className="px-4 py-2 bg-[#00a884] hover:bg-[#008069] text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
                >
                  {isImporting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Importing {importData.length} Contacts...
                    </>
                  ) : (
                    <>
                      <Upload size={14} />
                      Import {importData.length} Contacts
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
