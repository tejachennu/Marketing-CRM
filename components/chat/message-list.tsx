'use client'

import { Fragment, memo, useMemo } from 'react'
import { AlertCircle, Check, CheckCheck, Clock, Download, File, Loader2, Reply, RotateCcw } from 'lucide-react'
import type { Message } from '@/lib/types'
import { formatChatTime } from '@/lib/chat-dates'
import {
  getDisplayUrl,
  getDownloadName,
  getMediaType,
  getMessagePosition,
  getMessagePreview,
  getMessageText,
  parseReplyMarker,
} from '@/lib/chat-message-format'
import { ChatDateSeparator } from '@/components/chat-date-separator'
import { MessageText } from '@/components/chat/message-text'
import { CommerceCard } from '@/components/chat/commerce-card'
import { parseCommerceMessage, whatsappMessageId, type ChatOrderCard, type ChatProductCard } from '@/lib/chat-commerce'

interface MessageListProps {
  messages: Message[]
  /** Name shown on quotes of the customer's messages. */
  contactName: string
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  onOpenImage: (url: string) => void
  /** Start a reply to a message. Omitted when the viewer cannot send. */
  onReply?: (message: Message) => void
  /** Put a failed message back in the composer. Omitted when the viewer cannot send. */
  onRetry?: (message: Message) => void
  onJumpToMessage: (messageId: string) => void
  /** Called when a photo or video has its size, so the view can stay on the newest message. */
  onMediaLoad?: () => void
  /** Orders placed and products sent in this chat, shown as cards on their messages. */
  commerce?: { orders: ChatOrderCard[]; products: ChatProductCard[] }
}

function DeliveryStatus({ message }: { message: Message }) {
  if (message.id.startsWith('temp-')) {
    return <Clock size={12} className="text-[#8696a0] dark:text-[#e9edef]/65 shrink-0" aria-label="Sending" />
  }
  if (message.status === 'failed' || message.status === 'undelivered') {
    return (
      <span className="relative group/tooltip flex items-center">
        <AlertCircle size={13} className="text-rose-500 shrink-0 cursor-help" aria-label="Not delivered" />
        {message.error_message && (
          <span className="absolute bottom-full right-0 mb-1.5 hidden group-hover/tooltip:block bg-rose-600 text-white text-[11px] leading-snug p-2 rounded-lg shadow-lg z-30 whitespace-normal w-64 break-words pointer-events-none text-left">
            {message.error_message}
          </span>
        )}
      </span>
    )
  }
  if (message.status === 'read' || message.read_at) {
    return <CheckCheck size={14} className="text-[#53bdeb] shrink-0" aria-label="Read" />
  }
  if (message.status === 'delivered') {
    return <CheckCheck size={14} className="text-[#8696a0] dark:text-[#e9edef]/65 shrink-0" aria-label="Delivered" />
  }
  return <Check size={14} className="text-[#8696a0] dark:text-[#e9edef]/65 shrink-0" aria-label="Sent" />
}

/**
 * The bubbles of one conversation. Memoized: typing in the composer or a change in the
 * conversation list does not re-render the history.
 */
export const MessageList = memo(function MessageList({
  messages,
  contactName,
  hasMore,
  loadingOlder,
  onLoadOlder,
  onOpenImage,
  onReply,
  onRetry,
  onJumpToMessage,
  onMediaLoad,
  commerce,
}: MessageListProps) {
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
  const cards = useMemo(() => ({
    ordersByMessage: new Map((commerce?.orders || []).filter((order) => order.meta_order_id).map((order) => [order.meta_order_id as string, order])),
    productsBySku: new Map((commerce?.products || []).map((product) => [product.retailer_id, product])),
    productsByTitle: new Map((commerce?.products || []).map((product) => [product.title.toLowerCase(), product])),
  }), [commerce])

  return (
    <>
      {hasMore && (
        <div className="flex justify-center pb-3 select-none relative z-10">
          <button
            type="button"
            onClick={onLoadOlder}
            disabled={loadingOlder}
            className="px-3.5 py-1.5 bg-white dark:bg-[#182229] hover:bg-slate-50 dark:hover:bg-[#202c33] text-[12px] font-medium text-[#008069] dark:text-[#00a884] rounded-full shadow-[0_1px_0.5px_rgba(11,20,26,.13)] transition-colors cursor-pointer disabled:cursor-wait flex items-center gap-1.5"
          >
            {loadingOlder && <Loader2 size={12} className="animate-spin" />}
            <span>{loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}</span>
          </button>
        </div>
      )}

      {messages.map((message, index) => {
        const isOutgoing = message.sender_type === 'user'
        const { startsDay, startsGroup } = getMessagePosition(messages, index)
        const mediaType = getMediaType(message.media_url)
        const mediaUrl = getDisplayUrl(message.media_url)
        const text = getMessageText(message)
        const { replyToId } = parseReplyMarker(message.body)
        const quoted = replyToId ? byId.get(replyToId) : undefined
        const failed = message.status === 'failed' || message.status === 'undelivered'
        const isVisual = mediaType === 'image' || mediaType === 'video'
        const commerceMessage = message.media_url ? null : parseCommerceMessage(message.body)
        const order = commerceMessage?.kind === 'order' ? cards.ordersByMessage.get(whatsappMessageId(message.twilio_message_sid) || '') : undefined
        const product = commerceMessage?.kind === 'product'
          ? (commerceMessage.sku && cards.productsBySku.get(commerceMessage.sku)) || cards.productsByTitle.get(commerceMessage.title.toLowerCase())
          : undefined

        return (
          <Fragment key={message.id}>
            {startsDay && <ChatDateSeparator date={message.created_at} />}
            <div className={`group/row relative z-10 flex items-end gap-1 ${isOutgoing ? 'justify-end' : 'justify-start'} ${startsGroup ? 'mt-2.5' : 'mt-0.5'}`}>
              {/* Row actions sit on the inner side of the bubble and appear on hover or keyboard focus */}
              {isOutgoing && (onReply || (failed && onRetry)) && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity mb-1">
                  {failed && onRetry && (
                    <button type="button" onClick={() => onRetry(message)} title="Edit and send again" aria-label="Edit and send again" className="p-1.5 rounded-full bg-white/90 dark:bg-[#202c33] text-rose-600 dark:text-rose-400 hover:bg-white shadow-sm cursor-pointer">
                      <RotateCcw size={13} />
                    </button>
                  )}
                  {onReply && !message.id.startsWith('temp-') && (
                    <button type="button" onClick={() => onReply(message)} title="Reply" aria-label="Reply to this message" className="p-1.5 rounded-full bg-white/90 dark:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] hover:bg-white dark:hover:bg-[#2a3942] shadow-sm cursor-pointer">
                      <Reply size={13} />
                    </button>
                  )}
                </div>
              )}

              <div
                id={`msg-${message.id}`}
                className={`max-w-[85%] sm:max-w-[65%] lg:max-w-[520px] min-w-[84px] rounded-lg shadow-[0_1px_0.5px_rgba(11,20,26,.13)] relative overflow-hidden transition-[box-shadow,background-color] duration-300 ${
                  isVisual || commerceMessage ? 'p-1' : mediaType === 'document' ? 'p-1.5' : 'px-2.5 py-1.5'
                } ${
                  isOutgoing
                    ? `bg-[#d9fdd3] dark:bg-[#005c4b] ${startsGroup ? 'rounded-tr-none' : ''}`
                    : `bg-white dark:bg-[#202c33] ${startsGroup ? 'rounded-tl-none' : ''}`
                } ${failed ? 'ring-1 ring-rose-300 dark:ring-rose-800/70' : ''} text-[#111b21] dark:text-[#e9edef]`}
              >
                {/* Quoted message this one replies to */}
                {replyToId && (
                  <button
                    type="button"
                    onClick={() => quoted && onJumpToMessage(quoted.id)}
                    disabled={!quoted}
                    className={`w-full text-left mb-1 px-2 py-1.5 rounded-md border-l-[3px] text-[12.5px] leading-snug ${
                      isOutgoing ? 'bg-black/[0.06] dark:bg-black/20' : 'bg-black/[0.04] dark:bg-black/20'
                    } ${quoted ? 'cursor-pointer hover:bg-black/10 dark:hover:bg-black/30' : 'cursor-default'} ${
                      quoted?.sender_type === 'user' ? 'border-[#06cf9c]' : 'border-[#53bdeb]'
                    } ${isVisual ? 'mx-1 mt-1 w-[calc(100%-0.5rem)]' : ''}`}
                  >
                    <span className={`block font-semibold text-[12px] ${quoted?.sender_type === 'user' ? 'text-[#008069] dark:text-[#06cf9c]' : 'text-[#027eb5] dark:text-[#53bdeb]'}`}>
                      {quoted ? (quoted.sender_type === 'user' ? 'You' : contactName) : 'Earlier message'}
                    </span>
                    <span className="block truncate text-[#54656f] dark:text-[#aebac1]">
                      {quoted ? getMessagePreview(quoted) || 'Message' : 'Load earlier messages to see it'}
                    </span>
                  </button>
                )}

                {message.media_url && (
                  <div className={`relative group/media ${text ? 'mb-1' : ''}`}>
                    {mediaType === 'image' && (
                      <div className="relative rounded-md overflow-hidden bg-black/5 dark:bg-black/20">
                        {/* Media comes from arbitrary hosts and the proxy, so a plain img is used rather than next/image */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={mediaUrl}
                          alt="Photo"
                          loading="lazy"
                          onLoad={onMediaLoad}
                          className="max-h-80 w-full min-w-[180px] object-cover cursor-zoom-in"
                          onClick={() => onOpenImage(mediaUrl)}
                        />
                        <a href={mediaUrl} download={getDownloadName(message.media_url)} title="Download" aria-label="Download photo" className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/45 hover:bg-black/65 text-white opacity-0 group-hover/media:opacity-100 focus:opacity-100 transition-opacity">
                          <Download size={13} />
                        </a>
                      </div>
                    )}
                    {mediaType === 'video' && (
                      <div className="relative rounded-md overflow-hidden bg-black">
                        <video src={mediaUrl} controls preload="metadata" onLoadedMetadata={onMediaLoad} className="max-h-80 w-full min-w-[220px]" />
                      </div>
                    )}
                    {mediaType === 'audio' && (
                      <div className="flex items-center gap-1.5 py-0.5">
                        <audio src={mediaUrl} controls preload="metadata" className="w-60 max-w-full h-9" />
                        <a href={mediaUrl} download={getDownloadName(message.media_url)} title="Download" aria-label="Download audio" className="p-1.5 rounded-full text-[#54656f] dark:text-[#aebac1] hover:bg-black/10 dark:hover:bg-white/10">
                          <Download size={14} />
                        </a>
                      </div>
                    )}
                    {mediaType === 'document' && (
                      <a
                        href={mediaUrl}
                        download={getDownloadName(message.media_url)}
                        title="Download"
                        className={`flex items-center justify-between gap-3 p-2.5 rounded-md transition-colors ${
                          isOutgoing ? 'bg-black/[0.06] hover:bg-black/10 dark:bg-black/20 dark:hover:bg-black/30' : 'bg-[#f0f2f5] hover:bg-[#e9edef] dark:bg-black/20 dark:hover:bg-black/30'
                        }`}
                      >
                        <span className="flex items-center gap-2.5 min-w-0">
                          <span className="h-9 w-9 shrink-0 rounded-md bg-white/70 dark:bg-white/10 flex items-center justify-center text-[#54656f] dark:text-[#aebac1]">
                            <File size={17} />
                          </span>
                          <span className="truncate text-[13px] max-w-[190px] sm:max-w-[260px]">{getDownloadName(message.media_url)}</span>
                        </span>
                        <Download size={15} className="shrink-0 text-[#54656f] dark:text-[#aebac1]" />
                      </a>
                    )}
                  </div>
                )}

                {commerceMessage ? (
                  <CommerceCard parsed={commerceMessage} order={order} product={product || undefined} isOutgoing={isOutgoing} />
                ) : (
                  text && <MessageText text={text} className={`text-[14.2px] leading-[19px] ${isVisual ? 'px-1.5 pt-1' : ''}`} />
                )}

                <div className={`flex items-center justify-end gap-1 mt-0.5 text-[11px] leading-none select-none ${isVisual || commerceMessage ? 'px-1.5 pb-0.5' : ''} ${isOutgoing ? 'text-[#667781] dark:text-[#e9edef]/60' : 'text-[#667781] dark:text-[#8696a0]'}`}>
                  {failed && <span className="text-rose-600 dark:text-rose-400 font-medium mr-auto pr-2">Not delivered</span>}
                  <span>{formatChatTime(message.created_at)}</span>
                  {isOutgoing && <DeliveryStatus message={message} />}
                </div>
              </div>

              {!isOutgoing && onReply && (
                <div className="flex items-center opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity mb-1">
                  <button type="button" onClick={() => onReply(message)} title="Reply" aria-label="Reply to this message" className="p-1.5 rounded-full bg-white/90 dark:bg-[#202c33] text-[#54656f] dark:text-[#aebac1] hover:bg-white dark:hover:bg-[#2a3942] shadow-sm cursor-pointer">
                    <Reply size={13} />
                  </button>
                </div>
              )}
            </div>
          </Fragment>
        )
      })}
    </>
  )
})
