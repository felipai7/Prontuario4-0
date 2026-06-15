'use client'
import { useEffect } from 'react'
import type { ToastData } from '@/types'

interface Props { toasts: ToastData[]; remove: (id: string) => void }

export default function ToastContainer({ toasts, remove }: Props) {
  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 items-center pointer-events-none">
      {toasts.map(t => <ToastItem key={t.id} toast={t} remove={remove} />)}
    </div>
  )
}

function ToastItem({ toast, remove }: { toast: ToastData; remove: (id: string) => void }) {
  useEffect(() => {
    const t = setTimeout(() => remove(toast.id), 4000)
    return () => clearTimeout(t)
  }, [toast.id, remove])

  const bg =
    toast.tipo === 'success' ? 'bg-emerald-600' :
    toast.tipo === 'error'   ? 'bg-red-600' :
                               'bg-amber-500'

  return (
    <div className={`${bg} text-white px-6 py-3 rounded-xl shadow-xl text-sm font-semibold
                     animate-in slide-in-from-bottom-4 pointer-events-auto`}>
      {toast.msg}
    </div>
  )
}

// Hook
import { useState, useCallback } from 'react'

export function useToast() {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const showToast = useCallback((msg: string, tipo: ToastData['tipo'] = 'success') => {
    const id = Date.now().toString()
    setToasts(prev => [...prev, { id, msg, tipo }])
  }, [])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, showToast, removeToast }
}
