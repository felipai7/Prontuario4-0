import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import ServiceWorkerRegister from '@/components/pwa/ServiceWorkerRegister'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'ProMed UTI',
  description: 'Gerenciamento de pacientes internados',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ProMed UTI',
  },
}

export const viewport: Viewport = {
  themeColor: '#4f46e5',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={inter.className}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
