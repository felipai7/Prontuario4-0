'use client'
import { useState, useRef, useEffect } from 'react'

interface Props {
  value: string
  onChange: (v: string) => void
  options: string[]
  placeholder?: string
  className?: string
}

/**
 * Campo de texto com sugestões filtradas por substring (acento-insensível).
 * Sempre aceita digitação livre — as opções são atalho, não um enum: útil
 * para droga/foco de ATB, onde a equipe às vezes precisa registrar algo
 * fora da lista padrão.
 */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export default function Combobox({ value, onChange, options, placeholder, className }: Props) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtradas = value.trim()
    ? options.filter(o => normalize(o).includes(normalize(value.trim())))
    : options

  return (
    <div ref={rootRef} className="relative">
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className={className}
      />
      {open && filtradas.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-lg py-1">
          {filtradas.map(o => (
            <li key={o}>
              <button type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(o); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors">
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
