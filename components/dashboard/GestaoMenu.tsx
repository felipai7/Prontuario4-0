'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

const ITENS = [
  { href: '/indicadores', emoji: '📊', label: 'Indicadores', title: undefined as string | undefined },
  { href: '/unidade',     emoji: '🏗️', label: 'Unidade',     title: 'Alas, leitos e cadastro de unidades' },
  { href: '/auditoria',   emoji: '🗂️', label: 'Auditoria',   title: 'Todos os pacientes e admissões, de todas as unidades' },
]

/**
 * Agrupa os 3 botões que só o chefe vê (Indicadores/Unidade/Auditoria) num
 * dropdown só — mesmo padrão de SeletorUnidade.tsx (dropdown próprio, não
 * <select> nativo, pra manter os cantos arredondados iguais fechado/aberto).
 * Escalas fica de fora: também é usado por plantonista, não é só do chefe.
 */
export default function GestaoMenu() {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!aberto) return
    const fecharFora = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setAberto(false)
    }
    document.addEventListener('mousedown', fecharFora)
    return () => document.removeEventListener('mousedown', fecharFora)
  }, [aberto])

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setAberto(a => !a)}
        className="bg-white/20 hover:bg-white/30 border border-white/30 rounded-lg px-3 py-1.5
                   text-white text-sm font-medium flex items-center gap-1.5 transition-colors"
      >
        📋 Gestão
        <span className={`text-[10px] transition-transform ${aberto ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {aberto && (
        <div className="absolute right-0 mt-1 min-w-full w-max bg-white border border-slate-200
                         rounded-lg shadow-lg overflow-hidden z-50">
          {ITENS.map(item => (
            <button
              key={item.href}
              type="button"
              title={item.title}
              onClick={() => { setAberto(false); router.push(item.href) }}
              className="w-full text-left px-3 py-2 text-sm whitespace-nowrap text-slate-800
                         hover:bg-indigo-50 transition-colors flex items-center gap-2"
            >
              <span>{item.emoji}</span>{item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
