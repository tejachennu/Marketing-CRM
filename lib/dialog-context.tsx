'use client'

import React, { createContext, useContext, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type DialogType = 'alert' | 'confirm'

interface DialogState {
  isOpen: boolean
  type: DialogType
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  resolve: (value: boolean) => void
}

type ConfirmOptions = {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Style the confirm button as a destructive action (delete, remove, disconnect) */
  destructive?: boolean
}

const DialogContext = createContext<{
  confirm: (options: ConfirmOptions) => Promise<boolean>
  alert: (options: { title: string; message: string; confirmLabel?: string }) => Promise<void>
} | null>(null)

export function DialogProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DialogState | null>(null)

  const confirm = (options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({
        isOpen: true,
        type: 'confirm',
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel || 'OK',
        cancelLabel: options.cancelLabel || 'Cancel',
        destructive: options.destructive,
        resolve,
      })
    })
  }

  const alert = (options: { title: string; message: string; confirmLabel?: string }) => {
    return new Promise<void>((resolve) => {
      setState({
        isOpen: true,
        type: 'alert',
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel || 'OK',
        resolve: () => {
          resolve()
        },
      })
    })
  }

  const handleClose = (value: boolean) => {
    if (state) {
      state.resolve(value)
      setState(null)
    }
  }

  return (
    <DialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state && (
        <Dialog open={state.isOpen} onOpenChange={(open) => {
          if (!open) handleClose(false)
        }}>
          <DialogContent className="sm:max-w-[420px] rounded-2xl border-slate-100 dark:border-slate-800 bg-white dark:bg-[#1f2c34] p-6 shadow-2xl text-slate-800 dark:text-slate-100">
            <DialogHeader className="space-y-2">
              <DialogTitle className="text-base font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
                {state.title}
              </DialogTitle>
              {/* pre-line keeps multi-line messages (e.g. a list of validation errors) readable */}
              <DialogDescription className="text-[13px] text-[#54656f] dark:text-[#aebac1] leading-relaxed whitespace-pre-line break-words">
                {state.message}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4 flex flex-row items-center justify-end gap-2.5">
              {state.type === 'confirm' && (
                <Button
                  variant="outline"
                  onClick={() => handleClose(false)}
                  className="h-9 px-4 border border-slate-200 dark:border-slate-700 bg-white hover:bg-slate-50 dark:bg-transparent dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl transition-all cursor-pointer"
                >
                  {state.cancelLabel}
                </Button>
              )}
              <Button
                onClick={() => handleClose(true)}
                className={`h-9 px-4 text-white text-xs font-bold rounded-xl shadow-sm transition-all active:scale-[0.98] cursor-pointer ${
                  state.destructive ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#008069] hover:bg-[#006d59]'
                }`}
              >
                {state.confirmLabel}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </DialogContext.Provider>
  )
}

export function useConfirm() {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useConfirm must be used within DialogProvider')
  return context.confirm
}

export function useAlert() {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useAlert must be used within DialogProvider')
  return context.alert
}
