'use client'

// Compartilhado entre BalancoTab (por turno, UTI) e BalancoDiarioTab (por
// dia, Hospital) — mesmo campo numérico com expressão aritmética e mesma
// validação de vírgula/ponto nos dois formulários. Extraído de BalancoTab.tsx
// (onde vivia sozinho antes do Hospital precisar da própria variante).

/** Vírgula é o separador decimal aqui (padrão BR) — normaliza pra ponto antes de
 * avaliar como expressão JS. Ponto digitado pelo usuário é bloqueado antes de
 * chegar aqui (ver temPontoInvalido): alguns liam "1.200" como mil e duzentos
 * (separador de milhar, uso comum no Brasil) e o eval devolvia 1.2, um erro de
 * 1000x silencioso num valor de balanço hídrico. */
export function evalMath(expr: string): number {
  const clean = (expr ?? '').trim().replace(/,/g, '.')
  if (!clean || clean === '0') return 0
  if (!/^[\d\s+\-*/().]+$/.test(clean)) return parseFloat(clean) || 0
  try {
    const result = new Function('return (' + clean + ')')()
    if (typeof result === 'number' && isFinite(result)) return Math.max(0, Math.round(result * 10) / 10)
  } catch {}
  return parseFloat(clean) || 0
}

/** Ponto é ambíguo (decimal ou milhar) — só vírgula é aceita como decimal. */
export function temPontoInvalido(expr: string): boolean {
  return expr.includes('.')
}

export function ExprField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const preview  = evalMath(value)
  const invalido = temPontoInvalido(value)
  const hasExpr  = !invalido && value.trim() !== '' && value.trim() !== '0' && value !== String(preview) && /[+\-*/()]/.test(value)
  return (
    <div className={`bg-white border rounded-lg px-3 py-2 ${invalido ? 'border-red-400 ring-1 ring-red-200' : 'border-slate-200'}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      {/* text-base (16px), não text-sm: abaixo de 16px o Safari do iPhone dá
          zoom automático ao tocar no campo. O zoom desloca a tela no meio do
          toque — é fácil o dedo acabar digitando no campo vizinho depois do
          salto, o que bagunça o turno inteiro (não só este campo) e só
          acontece em celular. */}
      <input type="text" inputMode="decimal" value={value} onChange={e => onChange(e.target.value)} placeholder="0"
        className="w-full text-base font-semibold focus:outline-none bg-transparent"/>
      {invalido && <p className="text-xs text-red-500 mt-0.5">Use vírgula, não ponto</p>}
      {hasExpr && <p className="text-xs text-indigo-500 mt-0.5">= {preview.toFixed(0)} mL</p>}
    </div>
  )
}
