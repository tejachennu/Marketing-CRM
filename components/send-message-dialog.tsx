'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Send } from 'lucide-react'
import type { Contact } from '@/lib/types'

interface SendMessageDialogProps {
  contacts: Contact[]
  organizationId: string
  onMessageSent?: () => void
}

export function SendMessageDialog({
  contacts,
  organizationId,
  onMessageSent,
}: SendMessageDialogProps) {
  const [open, setOpen] = useState(false)
  const [selectedContactId, setSelectedContactId] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const selectedContact = contacts.find((c) => c.id === selectedContactId)

  async function handleSendMessage() {
    if (!selectedContactId || !message.trim()) {
      setError('Please select a contact and enter a message')
      return
    }

    setSending(true)
    setError(null)
    setSuccess(false)

    try {
      const response = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: selectedContactId,
          organizationId,
          message: message.trim(),
          phoneNumber: selectedContact?.phone_number,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send message')
      }

      setSuccess(true)
      setMessage('')
      setSelectedContactId('')
      
      setTimeout(() => {
        setOpen(false)
        setSuccess(false)
        onMessageSent?.()
      }, 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message')
      console.error('[v0] Send message error:', err)
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

          {/* Message Input */}
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

          {/* Error Message */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
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
            disabled={sending || !selectedContactId || !message.trim()}
            className="w-full"
          >
            {sending ? 'Sending...' : 'Send Message'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
