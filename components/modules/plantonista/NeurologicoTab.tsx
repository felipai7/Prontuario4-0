'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Paciente, AvaliacaoNeurologica, EscalaNeuro, Sedativo, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  neuro: AvaliacaoNeurologica | null
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const RASS_DESCRICOES: Record<number, string> = {
  [-5]: 'Não desperta',
  [-4]: 'Sedação profunda',
  [-3]: 'Sedação moderada',
  [-2]: 'Sedação leve',
  [-1]: 'Sonolento',
  0:    'Alerta e calmo',
  1:    'Inquieto',
  2:    'Agitado',
  3:    'Muito agitado',
  4:    'Combativo',
}
const RASS_VALORES = [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4]

const GLASGOW_COMPONENTES = [
  { key: 'ao' as const, label: 'Abertura Ocular (AO)',   valores: [1, 2, 3, 4] },
  { key: 'rv' as const, label: 'Resposta Verbal (RV)',   valores: [1, 2, 3, 4, 5] },
  { key: 'rm' as const, label: 'Resposta Motora (RM)',   valores: [1, 2, 3, 4, 5, 6] },
]

const SEDATIVOS: Sedativo[] = ['Propofol', 'Midazolam', 'Fentanil', 'Dexmedetomidina', 'Cetamina', 'Outro']

const labelCls = 'text-xs text-slate-500 font-medium block mb-1'
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'

function Chip({ selected, onClick, children, title }: {
  selected: boolean; onClick: () => void; children: React.ReactNode; title?: string
}) {
  return (
    <button type="button" onClick={onClick} title={title}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
        selected
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600'
      }`}>
      {children}
    </button>
  )
}

export default function NeurologicoTab({ paciente, neuro, onRefresh, showToast }: Props) {
  const supabase = createClient()

  const [escala,          setEscala]          = useState<EscalaNeuro>(neuro?.escala ?? 'RASS')
  const [rass,            setRass]            = useState<number | null>(neuro?.rass ?? null)
  const [ao,              setAo]              = useState<number | null>(neuro?.glasgow_ao ?? null)
  const [rv,              setRv]              = useState<number | null>(neuro?.glasgow_rv ?? null)
  const [rm,              setRm]              = useState<number | null>(neuro?.glasgow_rm ?? null)
  const [sedacao,         setSedacao]         = useState(neuro?.sedacao_em_uso ?? false)
  const [sedativos,       setSedativos]       = useState<Sedativo[]>(neuro?.sedativos ?? [])
  const [sedativoOutro,   setSedativoOutro]   = useState(neuro?.sedativo_outro ?? '')
  const [despertarDiario, setDespertarDiario] = useState<boolean | null>(neuro?.despertar_diario ?? null)
  const [saving,          setSaving]          = useState(false)

  // Re-sincroniza quando o registro muda (realtime / reload)
  useEffect(() => {
    setEscala(neuro?.escala ?? 'RASS')
    setRass(neuro?.rass ?? null)
    setAo(neuro?.glasgow_ao ?? null)
    setRv(neuro?.glasgow_rv ?? null)
    setRm(neuro?.glasgow_rm ?? null)
    setSedacao(neuro?.sedacao_em_uso ?? false)
    setSedativos(neuro?.sedativos ?? [])
    setSedativoOutro(neuro?.sedativo_outro ?? '')
    setDespertarDiario(neuro?.despertar_diario ?? null)
  }, [neuro?.updated_at])

  const glasgowTotal = ao != null && rv != null && rm != null ? ao + rv + rm : null

  const toggleSedativo = (s: Sedativo) => {
    setSedativos(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
  }

  const handleSave = async () => {
    if (sedacao && sedativos.includes('Outro') && !sedativoOutro.trim()) {
      showToast('Especifique o sedativo "Outro"', 'error'); return
    }
    setSaving(true)
    // "Não" em sedação limpa os campos dependentes; trocar de escala preserva
    // os valores da outra no banco (só alterna a exibição).
    const payload = {
      paciente_id:      paciente.id,
      escala,
      rass,
      glasgow_ao:       ao,
      glasgow_rv:       rv,
      glasgow_rm:       rm,
      sedacao_em_uso:   sedacao,
      sedativos:        sedacao && sedativos.length ? sedativos : null,
      sedativo_outro:   sedacao && sedativos.includes('Outro') ? (sedativoOutro.trim() || null) : null,
      despertar_diario: sedacao ? despertarDiario : null,
    }
    const { error } = await supabase.from('avaliacoes_neurologicas').upsert(payload, { onConflict: 'paciente_id' })
    setSaving(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    showToast('Avaliação neurológica salva!')
    onRefresh()
  }

  return (
    <div className="space-y-6">

      {/* Escala */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-700">🧠 Nível de Consciência / Sedação</h3>

        <div>
          <label className={labelCls}>Escala</label>
          <div className="flex gap-2">
            <Chip selected={escala === 'RASS'} onClick={() => setEscala('RASS')}>RASS</Chip>
            <Chip selected={escala === 'GLASGOW'} onClick={() => setEscala('GLASGOW')}>Glasgow</Chip>
          </div>
        </div>

        {escala === 'RASS' ? (
          <div>
            <label className={labelCls}>RASS {rass != null && <span className="text-indigo-600 font-bold">— {rass > 0 ? '+' : ''}{rass}: {RASS_DESCRICOES[rass]}</span>}</label>
            <div className="flex gap-1.5 flex-wrap">
              {RASS_VALORES.map(v => (
                <Chip key={v} selected={rass === v} onClick={() => setRass(rass === v ? null : v)}
                  title={`${v > 0 ? '+' : ''}${v} — ${RASS_DESCRICOES[v]}`}>
                  {v > 0 ? `+${v}` : v}
                </Chip>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {GLASGOW_COMPONENTES.map(comp => {
              const valor    = comp.key === 'ao' ? ao : comp.key === 'rv' ? rv : rm
              const setValor = comp.key === 'ao' ? setAo : comp.key === 'rv' ? setRv : setRm
              return (
                <div key={comp.key}>
                  <label className={labelCls}>{comp.label}</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {comp.valores.map(v => (
                      <Chip key={v} selected={valor === v} onClick={() => setValor(valor === v ? null : v)}>{v}</Chip>
                    ))}
                  </div>
                </div>
              )
            })}
            <div className={`rounded-lg p-3 text-sm font-bold ${glasgowTotal != null ? 'bg-indigo-50 text-indigo-700' : 'bg-slate-50 text-slate-400'}`}>
              Glasgow total: {glasgowTotal != null ? `${glasgowTotal} / 15` : 'selecione os três componentes'}
            </div>
          </div>
        )}
      </section>

      {/* Sedação */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <label className={labelCls}>Em uso de sedativos?</label>
          <div className="flex gap-2">
            <Chip selected={sedacao} onClick={() => setSedacao(true)}>Sim</Chip>
            <Chip selected={!sedacao} onClick={() => { setSedacao(false); setSedativos([]); setSedativoOutro(''); setDespertarDiario(null) }}>Não</Chip>
          </div>
        </div>

        {sedacao && (
          <>
            <div>
              <label className={labelCls}>Quais sedativos (múltipla escolha)</label>
              <div className="flex gap-1.5 flex-wrap">
                {SEDATIVOS.map(s => (
                  <Chip key={s} selected={sedativos.includes(s)} onClick={() => toggleSedativo(s)}>{s}</Chip>
                ))}
              </div>
              {sedativos.includes('Outro') && (
                <input value={sedativoOutro} onChange={e => setSedativoOutro(e.target.value)}
                  placeholder="Qual sedativo?" className={`${inputCls} mt-2 max-w-sm`} />
              )}
            </div>

            <div>
              <label className={labelCls}>Despertar diário</label>
              <div className="flex gap-2">
                <Chip selected={despertarDiario === true} onClick={() => setDespertarDiario(true)}>Sim</Chip>
                <Chip selected={despertarDiario === false} onClick={() => setDespertarDiario(false)}>Não</Chip>
              </div>
            </div>
          </>
        )}
      </section>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-6 py-2.5 rounded-lg transition-colors">
          {saving ? 'Salvando...' : '💾 Salvar avaliação'}
        </button>
      </div>
    </div>
  )
}
