'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Send, FileText } from 'lucide-react'
import type { Contact } from '@/lib/types'

interface SendMessageDialogProps {
  contacts: Contact[]
  organizationId: string
  onMessageSent?: () => void
}

interface TemplateOption {
  sid: string
  name: string
  body: string
  language?: string
}

export function SendMessageDialog({
  contacts,
  organizationId,
  onMessageSent,
}: SendMessageDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedContactId, setSelectedContactId] = useState('')
  const [sendMode, setSendMode] = useState<'text' | 'template'>('text')
  const [templates, setTemplates] = useState<TemplateOption[]>([])
  const [selectedTemplateSid, setSelectedTemplateSid] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const selectedContact = contacts.find((c) => c.id === selectedContactId)
  const selectedTemplate = templates.find((t) => t.sid === selectedTemplateSid)

  useEffect(() => {
    if (open && organizationId) {
      fetch(`/api/templates?organizationId=${organizationId}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.templates && Array.isArray(data.templates)) {
            setTemplates(data.templates)
          }
        })
        .catch((err) => console.error('[SendMessageDialog] Failed to fetch templates:', err))
    }
  }, [open, organizationId])

  const handleTemplateChange = (sid: string) => {
    setSelectedTemplateSid(sid)
    const tpl = templates.find((t) => t.sid === sid)
    if (tpl) {
      setMessage(tpl.body)
    }
  }

  async function handleSendMessage() {
    if (!selectedContactId) {
      setError('Please select a contact')
      return
    }

    if (sendMode === 'text' && !message.trim()) {
      setError('Please enter a message body')
      return
    }

    if (sendMode === 'template' && !selectedTemplateSid) {
      setError('Please select an approved template')
      return
    }

    setSending(true)
    setError(null)
    setSuccess(false)

    try {
      const payload: any = {
        contactId: selectedContactId,
        organizationId,
        phoneNumber: selectedContact?.phone_number,
      }

      if (sendMode === 'template' && selectedTemplate) {
        payload.templateSid = selectedTemplate.sid
        payload.templateName = selectedTemplate.name
        payload.templateLanguage = selectedTemplate.language || 'en'
        payload.message = selectedTemplate.body
      } else {
        payload.message = message.trim()
      }

      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const data = await response.json()

      if (!response.ok || !data.success || data.twilioSent === false) {
        throw new Error(data.error || 'Failed to send message via WhatsApp')
      }

      setSuccess(true)
      setMessage('')
      setSelectedContactId('')
      setSelectedTemplateSid('')
      
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        onMessageSent?.()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
      console.error('[SendMessageDialog] Send message error:', err)
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2">
          <Send className="w-4 h-4" />
          Send WhatsApp Message
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Send WhatsApp Message</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* Contact Selection */}
          <div>
            <label className="block text-sm font-medium mb-2">Select Contact</label>
            <select
              value={selectedContactId}
              onChange={(e) => setSelectedContactId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Choose a contact...</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.first_name || 'Unknown'} {contact.last_name || ''} ({contact.phone_number})
                </option>
              ))}
            </select>
          </div>

          {/* Selected Contact Info */}
          {selectedContact && (
            <div className="bg-blue-50 p-3 rounded-lg">
              <p className="text-sm text-gray-700">
                <strong>To:</strong> {selectedContact.first_name || 'Unknown'} {selectedContact.last_name || ''}
              </p>
              <p className="text-sm text-gray-700">
                <strong>Phone:</strong> {selectedContact.phone_number}
              </p>
            </div>
          )}

          {/* Message Mode Selection */}
          <div className="flex border-b border-gray-200">
            <button
              type="button"
              onClick={() => setSendMode('text')}
              className={`py-2 px-4 text-sm font-medium border-b-2 ${
                sendMode === 'text'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              Direct Message
            </button>
            <button
              type="button"
              onClick={() => setSendMode('template')}
              className={`py-2 px-4 text-sm font-medium border-b-2 flex items-center gap-1.5 ${
                sendMode === 'template'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Meta Template
            </button>
          </div>

          {sendMode === 'template' ? (
            <div>
              <label className="block text-sm font-medium mb-2">Select Meta Approved Template</label>
              <select
                value={selectedTemplateSid}
                onChange={(e) => handleTemplateChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
              >
                <option value="">Choose a template...</option>
                {templates.map((tpl) => (
                  <option key={tpl.sid} value={tpl.sid}>
                    {tpl.name}
                  </option>
                ))}
              </select>
              {selectedTemplate && (
                <div className="bg-gray-50 p-3 rounded-lg border border-gray-200 text-sm text-gray-700">
                  <p className="font-medium text-xs text-gray-500 mb-1">Preview:</p>
                  <p className="whitespace-pre-wrap">{selectedTemplate.body}</p>
                </div>
              )}
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-2">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Type your message here... (Max 1600 characters)"
                maxLength={1600}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 min-h-[120px] resize-none"
              />
              <div className="text-xs text-gray-500 mt-1">
                {message.length}/1600 characters
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm leading-snug">
              {error}
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-3 py-2 rounded-lg text-sm">
              Message sent successfully!
            </div>
          )}

          {/* Send Button */}
          <Button
            onClick={handleSendMessage}
            disabled={
              sending ||
              !selectedContactId ||
              (sendMode === 'text' && !message.trim()) ||
              (sendMode === 'template' && !selectedTemplateSid)
            }
            className="w-full"
          >
            {sending ? 'Sending...' : sendMode === 'template' ? 'Send Template' : 'Send Message'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
