'use client'

import { useState } from 'react'
import { Clock, Copy, CreditCard, ExternalLink, FileText, Image as ImageIcon, LayoutGrid, ListChecks, MapPin, Phone, PhoneCall, Reply, ShoppingBag, Video } from 'lucide-react'
import { MessageText } from '@/components/chat/message-text'
import { fillSamples, otpPreviewText, type ButtonDraft, type CardDraft, type TemplateDraft } from '@/lib/whatsapp-templates/template-model'

type PreviewButton = ButtonDraft | { type: 'CATALOG' | 'OTP' | 'MPM' | 'SPM' | 'ORDER_DETAILS'; text: string }

function ButtonRow({ button }: { button: PreviewButton }) {
  const Icon = button.type === 'QUICK_REPLY' ? Reply
    : button.type === 'VOICE_CALL' ? PhoneCall
      : button.type === 'ORDER_DETAILS' ? CreditCard
        : button.type === 'MPM' || button.type === 'SPM' ? ShoppingBag
    : button.type === 'URL' ? ExternalLink
      : button.type === 'PHONE_NUMBER' ? Phone
        : button.type === 'COPY_CODE' || button.type === 'OTP' ? Copy
          : button.type === 'CATALOG' ? LayoutGrid
            : ListChecks
  const label = button.type === 'COPY_CODE' ? 'Copy offer code' : ('text' in button && button.text) || 'Button'
  return (
    <div className="flex items-center justify-center gap-1.5 py-2 text-[13.5px] font-medium text-[#0a7cff] dark:text-[#53bdeb] border-t border-black/[0.08] dark:border-white/10">
      <Icon size={14} />
      <span className="truncate">{label}</span>
    </div>
  )
}

function MediaHeader({ format, preview }: { format: string; preview?: string }) {
  if (preview && format === 'IMAGE') {
    // A local or Meta-hosted sample, shown as is
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview} alt="" className="w-full h-40 object-cover rounded-md" />
  }
  if (preview && format === 'VIDEO') return <video src={preview} className="w-full h-40 object-cover rounded-md bg-black" muted />
  const Icon = format === 'VIDEO' ? Video : format === 'DOCUMENT' ? FileText : format === 'LOCATION' ? MapPin : ImageIcon
  return (
    <div className="w-full h-36 rounded-md bg-[#e1e5e9] dark:bg-white/10 flex items-center justify-center text-[#8696a0]">
      <Icon size={36} strokeWidth={1.5} />
    </div>
  )
}

function Bubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative bg-white dark:bg-[#202c33] rounded-lg rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)] text-[14px] leading-[19px] text-[#111b21] dark:text-[#e9edef] overflow-hidden">
      {children}
    </div>
  )
}

/** A product from the catalogue, as WhatsApp shows it in a product message. */
function ProductTile() {
  return (
    <div className="flex items-center gap-2.5 p-2 rounded-md bg-[#f0f2f5] dark:bg-black/20">
      <div className="h-12 w-12 rounded bg-[#e1e5e9] dark:bg-white/10 flex items-center justify-center text-[#8696a0]"><ShoppingBag size={20} /></div>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold truncate">Product name</p>
        <p className="text-[12.5px] text-[#667781]">₹499 · from your catalogue</p>
      </div>
    </div>
  )
}

function Card({ card, format }: { card: CardDraft; format: string }) {
  return (
    <div className="w-[210px] shrink-0">
      <Bubble>
        <div className="p-1"><MediaHeader format={format} preview={card.headerPreview} /></div>
        <div className="px-2.5 pb-1.5"><MessageText text={fillSamples(card.body, card.samples) || 'Card text'} /></div>
        {card.buttons.map((button, index) => <ButtonRow key={index} button={button} />)}
      </Bubble>
    </div>
  )
}

/** How the template will look on a customer's phone, as WhatsApp Manager previews it. */
export function TemplatePreview({ draft }: { draft: TemplateDraft }) {
  const time = '11:59'
  // Like WhatsApp Manager: show the samples, or the {{variables}} as written
  const [showSamples, setShowSamples] = useState(true)
  const fill = (text: string, samples: Record<string, string>, prefix = '') => (showSamples ? fillSamples(text, samples, prefix) : text)
  let body = fill(draft.body, draft.samples)
  let footer = ['lto', 'carousel', 'product_carousel'].includes(draft.type) ? '' : draft.footer
  let buttons: PreviewButton[] = ['call_permission'].includes(draft.type) ? [] : draft.buttons
  if (draft.type === 'otp') {
    const otp = otpPreviewText(draft)
    body = otp.body
    footer = otp.footer
    buttons = [{ type: 'OTP', text: draft.otp.type === 'COPY_CODE' ? draft.otp.buttonText || 'Copy code' : draft.otp.autofillText || 'Autofill' }]
  }
  if (draft.type === 'catalog') buttons = [{ type: 'CATALOG', text: 'View catalog' }]
  if (draft.type === 'mpm') buttons = [{ type: 'MPM', text: 'View items' }]
  if (draft.type === 'spm') buttons = [{ type: 'SPM', text: 'View' }]
  if (draft.type === 'order_details') buttons = [{ type: 'ORDER_DETAILS', text: 'Review and pay' }]
  const copyCode = draft.buttons.find((button) => button.type === 'COPY_CODE') as { example: string } | undefined

  return (
    <div>
    {draft.type !== 'otp' && (
      <div className="flex justify-end mb-1.5">
        <div className="inline-flex rounded-lg border border-[#ced0d4] dark:border-slate-700 overflow-hidden text-[12px] font-semibold">
          {[true, false].map((value) => (
            <button key={String(value)} type="button" onClick={() => setShowSamples(value)} className={`px-2.5 h-7 cursor-pointer ${showSamples === value ? 'bg-[#0064e0] text-white' : 'bg-white dark:bg-slate-900 text-[#1c2b33] dark:text-slate-300'}`}>{value ? 'Samples' : 'Variables'}</button>
          ))}
        </div>
      </div>
    )}
    <div className="rounded-2xl overflow-hidden border border-[#dadde1] dark:border-slate-700 bg-[#efeae2] dark:bg-[#0b141a] wa-chat-wallpaper">
      <div className="p-3 sm:p-4 space-y-2 min-h-[260px]">
        <div className="max-w-[300px]">
          <Bubble>
            {draft.type === 'spm' && <div className="p-1"><MediaHeader format="IMAGE" /><p className="px-1.5 pt-1.5 text-[14px] font-semibold">Product name</p><p className="px-1.5 text-[12.5px] text-[#667781]">₹499</p></div>}
            {!['otp', 'carousel', 'product_carousel', 'spm'].includes(draft.type) && draft.headerFormat !== 'NONE' && (
              draft.headerFormat === 'TEXT'
                ? <p className="px-2.5 pt-2 font-bold text-[15px]">{fill(draft.headerText, draft.samples, 'header:') || 'Header'}</p>
                : <div className="p-1">
                    <MediaHeader format={draft.headerFormat} preview={draft.headerPreview} />
                    {draft.headerFormat === 'LOCATION' && <p className="px-1.5 pt-1 text-[12px] text-[#667781]">Location sent with each message</p>}
                  </div>
            )}
            {draft.type === 'lto' && (
              <div className="mx-1 mt-1 rounded-md bg-[#f0f2f5] dark:bg-black/20 px-2.5 py-2 flex items-start gap-2">
                <span className="h-8 w-8 shrink-0 rounded-full bg-[#d9fdd3] dark:bg-[#005c4b] flex items-center justify-center text-[#008069]"><Clock size={15} /></span>
                <span className="min-w-0">
                  <span className="block font-semibold text-[14px]">{draft.lto.text || 'Expiring offer!'}</span>
                  {draft.lto.hasExpiration && <span className="block text-[12px] text-[#667781]">Ends in 1 day</span>}
                  {copyCode?.example && <span className="block text-[12px] text-[#667781]">Code {copyCode.example}</span>}
                </span>
              </div>
            )}
            <div className="px-2.5 pt-1.5 pb-1">
              <MessageText text={body || 'Your message body appears here.'} className={body ? '' : 'text-[#8696a0]'} />
              {footer && <p className="mt-1 text-[12.5px] text-[#667781] dark:text-[#8696a0]">{footer}</p>}
              {draft.type === 'mpm' && <div className="mt-1.5"><ProductTile /></div>}
              {draft.type === 'order_details' && (
                <div className="mt-1.5 rounded-md bg-[#f0f2f5] dark:bg-black/20 p-2 text-[12.5px]">
                  <div className="flex justify-between"><span className="text-[#667781]">Order #ORD-1042</span><span className="font-semibold">₹1,121</span></div>
                  <div className="text-[#667781]">2 items · set when you send it</div>
                </div>
              )}
              <p className="text-right text-[11px] text-[#667781] dark:text-[#8696a0] -mt-0.5">{time}</p>
            </div>
            {draft.type === 'call_permission' && (
              <div className="border-t border-black/[0.08] dark:border-white/10 px-2.5 py-2">
                <p className="flex items-center gap-1.5 text-[13px] font-semibold"><PhoneCall size={14} /> Allow calls from this business?</p>
                <div className="grid grid-cols-2 gap-1.5 mt-1.5 text-[13px] font-medium text-[#0a7cff] dark:text-[#53bdeb] text-center">
                  <span className="py-1 rounded bg-[#f0f2f5] dark:bg-black/20">Allow</span><span className="py-1 rounded bg-[#f0f2f5] dark:bg-black/20">Don't allow</span>
                </div>
              </div>
            )}
            {draft.type !== 'carousel' && buttons.slice(0, 3).map((button, index) => <ButtonRow key={index} button={button} />)}
            {draft.type !== 'carousel' && buttons.length > 3 && (
              <div className="flex items-center justify-center gap-1.5 py-2 text-[13.5px] font-medium text-[#0a7cff] dark:text-[#53bdeb] border-t border-black/[0.08] dark:border-white/10">
                <ListChecks size={14} /> See all options
              </div>
            )}
          </Bubble>
        </div>
        {draft.type === 'carousel' && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {draft.cards.map((card, index) => <Card key={index} card={showSamples ? card : { ...card, samples: {} }} format={draft.cards[0]?.headerFormat || 'IMAGE'} />)}
          </div>
        )}
        {draft.type === 'product_carousel' && (
          <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
            {Array.from({ length: draft.productCards }, (_, index) => (
              <div key={index} className="w-[180px] shrink-0">
                <Bubble>
                  <div className="p-1"><MediaHeader format="IMAGE" /></div>
                  <div className="px-2.5 pb-1.5"><p className="text-[13.5px] font-semibold">Product {index + 1}</p><p className="text-[12.5px] text-[#667781]">₹499</p></div>
                  <ButtonRow button={{ type: 'SPM', text: 'View' }} />
                </Bubble>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
    </div>
  )
}
