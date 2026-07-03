'use client'
import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* PWA é um extra, nunca deve quebrar o app */ })
    }
  }, [])
  return null
}
