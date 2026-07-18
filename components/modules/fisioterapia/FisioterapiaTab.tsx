'use client'
import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData } from '@/lib/utils'
import type {
  Paciente, FisioEvento, FisioAvaliacaoDiaria, TipoEventoFisio,
  SuporteVentilatorio, ToastData,
} from '@/types'

interface Props {
  paciente: Paciente
  eventos: FisioEvento[]
  avaliacoes: FisioAvaliacaoDiaria[]
  ventHistorico: SuporteVentilatorio[]
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const TIPOS: { id: TipoEventoFisio; label: string; emoji: string }[] = [
  { id: 'extubacao',       label: 'Extubação',       emoji: '🫁' },
  { id: 'desmame_dificil', label: 'Desmame difícil', emoji: '⏳' },
  { id: 'vni',             label: 'VNI',             emoji: '😷' },
  { id: 'traqueostomia',   label: 'Traqueostomia',   emoji: '🔧' },
]

const hojeISO = () => new Date().toISOString().split('T')[0]

/** Descrição legível do evento, para o histórico. */
function descrever(e: FisioEvento): string {
  if (e.tipo === 'extubacao') {
    const partes = [e.planejada ? 'planejada' : 'não planejada']
    if (e.sucesso) partes.push('sucesso')
    if (e.reintubou_48h) partes.push('reintubou em 48h')
    return `Extubação (${partes.join(', ')})`
  }
  if (e.tipo === 'desmame_dificil') {
    return `Desmame difícil — ${e.sucesso ? 'desmamou' : 'ainda em curso / sem sucesso'}`
  }
  if (e.tipo === 'vni') {
    if (!e.objetivo_evitar_iot) return 'VNI (outro objetivo)'
    return `VNI para evitar IOT — ${e.evitou_iot ? 'evitou' : 'não evitou'}`
  }
  const partes: string[] = []
  if (e.elegivel_decanulacao) partes.push('elegível a decanulação')
  if (e.decanulado_na_uti) partes.push('decanulado na UTI')
  return `Traqueostomia${partes.length ? ` (${partes.join(', ')})` : ''}`
}

export default function FisioterapiaTab({
  paciente, eventos, avaliacoes, ventHistorico, podeEditar, onRefresh, showToast,
}: Props) {
  const supabase = createClient()

  const [tipo, setTipo] = useState<TipoEventoFisio | ''>('')
  const [data, setData] = useState(hojeISO)
  const [planejada, setPlanejada] = useState(true)
  const [sucesso, setSucesso] = useState(false)
  const [reintubou, setReintubou] = useState(false)
  const [objetivoEvitarIot, setObjetivoEvitarIot] = useState(true)
  const [evitouIot, setEvitouIot] = useState(false)
  const [elegivel, setElegivel] = useState(false)
  const [decanulado, setDecanulado] = useState(false)
  const [observacao, setObservacao] = useState('')
  const [saving, setSaving] = useState(false)

  const ordenados = useMemo(
    () => [...eventos].sort((a, b) => b.data.localeCompare(a.data)),
    [eventos])

  // VM protetora só faz sentido em dia com VM: o denominador do indicador é
  // ventilador-dia, e marcar fora de VM inflaria o resultado acima de 100%.
  const emVMHoje = useMemo(
    () => ventHistorico.some(v => v.data === hojeISO() && v.modalidade === 'ventilacao_mecanica'),
    [ventHistorico])

  const avaliacaoHoje = useMemo(
    () => avaliacoes.find(a => a.data === hojeISO()) ?? null,
    [avaliacoes])

  const limpar = () => {
    setTipo(''); setData(hojeISO()); setPlanejada(true); setSucesso(false)
    setReintubou(false); setObjetivoEvitarIot(true); setEvitouIot(false)
    setElegivel(false); setDecanulado(false); setObservacao('')
  }

  const handleSalvarEvento = async () => {
    if (!tipo) { showToast('Selecione o tipo de evento', 'error'); return }
    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('fisio_eventos').insert({
      paciente_id: paciente.id,
      tipo, data,
      planejada:            tipo === 'extubacao' ? planejada : null,
      sucesso:              tipo === 'extubacao' || tipo === 'desmame_dificil' ? sucesso : null,
      reintubou_48h:        tipo === 'extubacao' ? reintubou : null,
      objetivo_evitar_iot:  tipo === 'vni' ? objetivoEvitarIot : null,
      evitou_iot:           tipo === 'vni' ? evitouIot : null,
      elegivel_decanulacao: tipo === 'traqueostomia' ? elegivel : null,
      decanulado_na_uti:    tipo === 'traqueostomia' ? decanulado : null,
      observacao: observacao.trim() || null,
      criado_por: user.user?.id ?? null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Evento registrado!')
    limpar(); onRefresh()
  }

  const handleVmProtetora = async (valor: boolean) => {
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('fisio_avaliacoes_diarias').upsert({
      paciente_id: paciente.id,
      data: hojeISO(),
      vm_protetora: valor,
      criado_por: user.user?.id ?? null,
    }, { onConflict: 'paciente_id,data' })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Avaliação do dia salva!')
    onRefresh()
  }

  const handleExcluir = async (id: string) => {
    const { error } = await supabase.from('fisio_eventos').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Evento excluído')
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {/* Avaliação do dia */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-slate-700">📅 Avaliação de hoje</h3>
        {!emVMHoje ? (
          <p className="text-sm text-slate-400">
            Paciente não está em ventilação mecânica hoje — a marcação de VM protetora
            só vale em dia de VM. Registre a modalidade na aba Ventilatório.
          </p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-600">Ventilação protetora hoje?</span>
            <button onClick={() => handleVmProtetora(true)} disabled={!podeEditar}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                avaliacaoHoje?.vm_protetora === true
                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              Sim
            </button>
            <button onClick={() => handleVmProtetora(false)} disabled={!podeEditar}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                avaliacaoHoje?.vm_protetora === false
                  ? 'border-amber-500 bg-amber-50 text-amber-700'
                  : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              Não
            </button>
            {avaliacaoHoje == null && (
              <span className="text-xs text-slate-400">ainda não registrado</span>
            )}
          </div>
        )}
      </section>

      {/* Novo evento */}
      {podeEditar && (
        <section className="border border-slate-200 rounded-xl p-4 space-y-3">
          <h3 className="font-semibold text-slate-700">➕ Registrar evento</h3>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {TIPOS.map(t => (
              <button key={t.id} onClick={() => setTipo(t.id)}
                className={`border rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
                  tipo === t.id
                    ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200'
                    : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                <span className="block text-base mb-0.5">{t.emoji}</span>
                {t.label}
              </button>
            ))}
          </div>

          {tipo && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Data</label>
                <input type="date" value={data} max={hojeISO()} onChange={e => setData(e.target.value)}
                  className="w-full sm:w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>

              {tipo === 'extubacao' && (
                <div className="space-y-1.5">
                  <Check label="Extubação planejada (não acidental)" v={planejada} set={setPlanejada}
                    dica="Reintubar após autoextubação não conta como falha de extubação." />
                  <Check label="Sucesso (não precisou reintubar em 48h)" v={sucesso} set={setSucesso} />
                  <Check label="Reintubou em até 48h" v={reintubou} set={setReintubou} />
                </div>
              )}

              {tipo === 'desmame_dificil' && (
                <Check label="Desmame concluído com sucesso" v={sucesso} set={setSucesso} />
              )}

              {tipo === 'vni' && (
                <div className="space-y-1.5">
                  <Check label="Objetivo era evitar intubação" v={objetivoEvitarIot} set={setObjetivoEvitarIot} />
                  <Check label="Evitou a intubação" v={evitouIot} set={setEvitouIot} />
                </div>
              )}

              {tipo === 'traqueostomia' && (
                <div className="space-y-1.5">
                  <Check label="Elegível a decanulação" v={elegivel} set={setElegivel} />
                  <Check label="Decanulado na UTI" v={decanulado} set={setDecanulado} />
                </div>
              )}

              <textarea value={observacao} onChange={e => setObservacao(e.target.value)}
                placeholder="Observação (opcional)" rows={2}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" style={{ resize: 'vertical' }} />

              <div className="flex gap-2">
                <button onClick={limpar}
                  className="flex-1 border border-slate-300 text-slate-700 font-semibold py-2 rounded-lg text-sm hover:bg-slate-50">
                  Cancelar
                </button>
                <button onClick={handleSalvarEvento} disabled={saving}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm">
                  {saving ? 'Salvando...' : 'Registrar'}
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {/* Histórico */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-slate-700">📜 Eventos ({ordenados.length})</h3>
        {ordenados.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-4">Nenhum evento registrado</p>
        ) : (
          <ul className="space-y-1.5">
            {ordenados.map(e => (
              <li key={e.id} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">{descrever(e)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {fmtData(e.data)}{e.observacao ? ` · ${e.observacao}` : ''}
                  </p>
                </div>
                {podeEditar && (
                  <button onClick={() => handleExcluir(e.id)} title="Excluir"
                    className="text-slate-300 hover:text-red-500 text-sm flex-shrink-0">🗑️</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Check({ label, v, set, dica }: {
  label: string; v: boolean; set: (b: boolean) => void; dica?: string
}) {
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={v} onChange={e => set(e.target.checked)}
          className="w-4 h-4 accent-indigo-600" />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
      {dica && <p className="text-xs text-slate-400 ml-6">{dica}</p>}
    </div>
  )
}
