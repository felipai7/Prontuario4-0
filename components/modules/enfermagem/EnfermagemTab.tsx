'use client'
import { useState, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, diasDesde, hojeISO, ultimoPorTurno } from '@/lib/utils'
import type {
  Paciente, Dispositivo, TipoDispositivo, LppEvento, EstagioLPP, SwabVigilancia, SuporteVentilatorio, ToastData,
} from '@/types'

interface Props {
  paciente: Paciente
  dispositivos: Dispositivo[]
  lpps: LppEvento[]
  swabs: SwabVigilancia[]
  /** Só pra cruzar com dispositivos e alertar "VM sem TOT/TQT" — não editado aqui. */
  ventHistorico: SuporteVentilatorio[]
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

// Ícones revisados pra cada um ter uma associação clínica própria — antes
// AVP/CVC dividiam 💉 e SVD/CISTO dividiam 🩺, sem nada distinguir um do outro.
// PICC e TOT trocados de novo (💪/🌬️ eram vagos demais, sem ligação clara com
// o dispositivo): PICC agora é 🧵 — é literalmente um cateter longo e fino
// "enfiado" pela veia periférica até um vaso central, e TOT é 👄 — "oro"
// traqueal = via a boca, em contraste direto com TQT (🫁, via traqueostomia
// no pescoço, sem passar pela boca).
const TIPOS: { id: TipoDispositivo; label: string; emoji: string }[] = [
  { id: 'AVP',   label: 'Acesso venoso periférico',           emoji: '💉' },
  { id: 'PICC',  label: 'Cateter central de inserção periférica', emoji: '🧵' },
  { id: 'CVC',   label: 'Cateter venoso central',             emoji: '🫀' },
  { id: 'SVD',   label: 'Sonda vesical de demora',            emoji: '🚽' },
  { id: 'CISTO', label: 'Cistostomia',                        emoji: '💧' },
  { id: 'PAI',   label: 'Cateter de pressão arterial invasiva', emoji: '📈' },
  { id: 'CDL',   label: 'Cateter de diálise',                 emoji: '🩸' },
  { id: 'DRENO', label: 'Dreno',                              emoji: '🪣' },
  { id: 'GTT',   label: 'Gastrostomia',                       emoji: '🍽️' },
  { id: 'TOT',   label: 'Tubo orotraqueal',                   emoji: '👄' },
  { id: 'TQT',   label: 'Traqueostomia',                      emoji: '🫁' },
  { id: 'OUTRO', label: 'Outro dispositivo',                  emoji: '🔧' },
]

// CVC/PICC/DRENO/OUTRO podem ter mais de um simultâneo (múltiplos sítios/
// lumens/drenos ao mesmo tempo é rotina). SVD/PAI/CDL/GTT/TOT/TQT ficam
// travados a 1 por vez — clinicamente não há cenário de duas vias aéreas ao
// mesmo tempo (TOT vira TQT, não soma); ainda dá pra trocar no mesmo dia
// (retira e insere de novo), só não acumular dois "instalados".
const PERMITE_MULTIPLOS = new Set<TipoDispositivo>(['CVC', 'PICC', 'DRENO', 'AVP', 'OUTRO'])

// Sítio de inserção (CVC/PICC/PAI/CDL/AVP) é opcional; descrição de
// DRENO/OUTRO é o que dá sentido ao registro, por isso obrigatória.
const OBS_OBRIGATORIA = new Set<TipoDispositivo>(['DRENO', 'OUTRO'])
const OBS_LABEL: Record<TipoDispositivo, string> = {
  AVP: 'Sítio de inserção', PICC: 'Sítio de inserção', CVC: 'Sítio de inserção', SVD: 'Observação', CISTO: 'Observação', PAI: 'Sítio de inserção',
  CDL: 'Sítio de inserção', DRENO: 'Qual dreno e onde está inserido', GTT: 'Observação',
  TOT: 'Observação (nº, fixação)', TQT: 'Observação', OUTRO: 'Descrição',
}
const OBS_PLACEHOLDER: Record<TipoDispositivo, string> = {
  AVP: 'Ex: dorso da mão direita', PICC: 'Ex: basílica direita', CVC: 'Ex: jugular direita', SVD: '', CISTO: '', PAI: 'Ex: radial esquerda',
  CDL: 'Ex: femoral direita', DRENO: 'Ex: Penrose em flanco direito', GTT: '',
  TOT: 'Ex: nº 7,5, fixado em 22cm', TQT: '', OUTRO: 'Descreva o dispositivo',
}

const ESTAGIOS: EstagioLPP[] = ['1', '2', '3', '4', 'Não classificável', 'Tissular profunda']


export default function EnfermagemTab({
  paciente, dispositivos, lpps, swabs, ventHistorico, podeEditar, onRefresh, showToast,
}: Props) {
  const supabase = createClient()

  const ventAtual = ultimoPorTurno(ventHistorico)
  const emVM = ventAtual?.modalidade === 'ventilacao_mecanica'
  const viaAereaInstalada = dispositivos.some(d => !d.data_remocao && (d.tipo === 'TOT' || d.tipo === 'TQT'))

  const [tipoNovo, setTipoNovo] = useState<TipoDispositivo | ''>('')
  const [dataInsercao, setDataInsercao] = useState(hojeISO)
  const [obsNovo, setObsNovo] = useState('')
  const [saving, setSaving] = useState(false)

  // Edição de datas/observação de um dispositivo já lançado (instalado ou
  // retirado) — corrige inserção/retirada marcadas errado, inclusive
  // "reabrir" um dispositivo retirado por engano (limpando a data de retirada).
  const [editandoDisp, setEditandoDisp] = useState<Dispositivo | null>(null)
  const [editInsercao, setEditInsercao] = useState('')
  const [editRemocao, setEditRemocao] = useState('')
  const [editObs, setEditObs] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  const [lppAberto, setLppAberto] = useState(false)
  const [lppData, setLppData] = useState(hojeISO)
  const [lppEstagio, setLppEstagio] = useState<EstagioLPP>('1')
  const [lppLocal, setLppLocal] = useState('')
  const [lppAdquirida, setLppAdquirida] = useState(true)

  const [swabData, setSwabData] = useState(hojeISO)
  const [swabSaving, setSwabSaving] = useState(false)

  const instalados = useMemo(() => dispositivos.filter(d => !d.data_remocao), [dispositivos])
  const retirados  = useMemo(
    () => dispositivos.filter(d => d.data_remocao)
      .sort((a, b) => (b.data_remocao ?? '').localeCompare(a.data_remocao ?? '')),
    [dispositivos])
  const lppsOrdenadas = useMemo(
    () => [...lpps].sort((a, b) => b.data.localeCompare(a.data)), [lpps])
  const swabsPendentes = useMemo(
    () => swabs.filter(s => !s.resultado_disponivel).sort((a, b) => a.data_coleta.localeCompare(b.data_coleta)),
    [swabs])
  const swabsResolvidos = useMemo(
    () => swabs.filter(s => s.resultado_disponivel).sort((a, b) => b.data_coleta.localeCompare(a.data_coleta)),
    [swabs])

  const handleInserir = async () => {
    if (!tipoNovo) { showToast('Selecione o dispositivo', 'error'); return }
    if (!PERMITE_MULTIPLOS.has(tipoNovo) && instalados.some(d => d.tipo === tipoNovo)) {
      showToast(`Já existe ${tipoNovo} instalado — registre a retirada antes.`, 'error'); return
    }
    if (OBS_OBRIGATORIA.has(tipoNovo) && !obsNovo.trim()) {
      showToast(`Descreva: ${OBS_LABEL[tipoNovo]}`, 'error'); return
    }
    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('dispositivos').insert({
      paciente_id: paciente.id, tipo: tipoNovo, data_insercao: dataInsercao,
      observacao: obsNovo.trim() || null,
      criado_por: user.user?.id ?? null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Dispositivo registrado!')
    setTipoNovo(''); setDataInsercao(hojeISO()); setObsNovo(''); onRefresh()
  }

  const handleRetirar = async (d: Dispositivo) => {
    const { error } = await supabase.from('dispositivos')
      .update({ data_remocao: hojeISO() }).eq('id', d.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast(`${d.tipo} retirado hoje`)
    onRefresh()
  }

  const abrirEdicaoDisp = (d: Dispositivo) => {
    setEditandoDisp(d)
    setEditInsercao(d.data_insercao)
    setEditRemocao(d.data_remocao ?? '')
    setEditObs(d.observacao ?? '')
  }

  const handleSalvarEdicaoDisp = async () => {
    if (!editandoDisp) return
    if (!editInsercao) { showToast('Informe a data de inserção', 'error'); return }
    setEditSaving(true)
    const { error } = await supabase.from('dispositivos').update({
      data_insercao: editInsercao,
      data_remocao: editRemocao || null,
      observacao: editObs.trim() || null,
    }).eq('id', editandoDisp.id)
    setEditSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Dispositivo atualizado!')
    setEditandoDisp(null); onRefresh()
  }

  const handleSalvarLpp = async () => {
    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('lpp_eventos').insert({
      paciente_id: paciente.id, data: lppData, estagio: lppEstagio,
      local: lppLocal.trim() || null, adquirida_na_uti: lppAdquirida,
      criado_por: user.user?.id ?? null,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('LPP registrada!')
    setLppAberto(false); setLppLocal(''); setLppEstagio('1'); setLppAdquirida(true)
    setLppData(hojeISO()); onRefresh()
  }

  const handleExcluirLpp = async (id: string) => {
    const { error } = await supabase.from('lpp_eventos').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('LPP excluída'); onRefresh()
  }

  const handleColetarSwab = async () => {
    if (!swabData) { showToast('Informe a data da coleta', 'error'); return }
    setSwabSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('swabs_vigilancia').insert({
      paciente_id: paciente.id, data_coleta: swabData, criado_por: user.user?.id ?? null,
    })
    setSwabSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Swab de vigilância registrado — pendente até marcar o resultado')
    setSwabData(hojeISO()); onRefresh()
  }

  const handleMarcarResultadoSwab = async (s: SwabVigilancia) => {
    const { error } = await supabase.from('swabs_vigilancia')
      .update({ resultado_disponivel: true, data_resultado: hojeISO() }).eq('id', s.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Resultado marcado como disponível'); onRefresh()
  }

  const handleExcluirSwab = async (id: string) => {
    if (!confirm('Excluir este registro de swab?')) return
    const { error } = await supabase.from('swabs_vigilancia').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Registro excluído'); onRefresh()
  }

  return (
    <div className="space-y-4">
      {emVM && !viaAereaInstalada && (
        <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 text-sm text-amber-800">
          ⚠️ Paciente está em <strong>ventilação mecânica</strong>, mas não há TOT ou TQT
          registrado como dispositivo instalado — registre a via aérea abaixo.
        </div>
      )}

      {/* Dispositivos instalados */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-slate-700">🔌 Dispositivos instalados</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Os dias-dispositivo são contados a partir daqui — registre a retirada
            para o cálculo não seguir correndo.
          </p>
        </div>

        {instalados.length === 0 ? (
          <p className="text-sm text-slate-400 italic">Nenhum dispositivo instalado</p>
        ) : (
          <ul className="space-y-1.5">
            {instalados.map(d => (
              <li key={d.id} className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-emerald-900">
                    {TIPOS.find(t => t.id === d.tipo)?.emoji} {d.tipo}
                    {d.observacao && <span className="font-normal"> · {d.observacao}</span>}
                  </p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    desde {fmtData(d.data_insercao)} · {diasDesde(d.data_insercao)} dia(s)
                  </p>
                </div>
                {podeEditar && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => abrirEdicaoDisp(d)} title="Editar datas/observação"
                      className="text-xs text-emerald-700 border border-emerald-300 hover:bg-emerald-100 rounded-lg px-2 py-1.5">
                      ✏️
                    </button>
                    <button onClick={() => handleRetirar(d)}
                      className="text-xs font-medium text-emerald-700 border border-emerald-300 hover:bg-emerald-100 rounded-lg px-2.5 py-1.5">
                      Retirar hoje
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {podeEditar && (
          <div className="border-t border-slate-100 pt-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              {TIPOS.map(t => {
                const bloqueado = !PERMITE_MULTIPLOS.has(t.id) && instalados.some(d => d.tipo === t.id)
                return (
                  <button key={t.id} onClick={() => setTipoNovo(tipoNovo === t.id ? '' : t.id)}
                    disabled={bloqueado}
                    title={bloqueado ? 'Já instalado — retire antes de inserir outro' : undefined}
                    className={`border rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-40 ${
                      tipoNovo === t.id
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-200'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                    {t.emoji} {t.label}
                  </button>
                )
              })}
            </div>
            {tipoNovo && (
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Data de inserção</label>
                  <input type="date" value={dataInsercao} max={hojeISO()}
                    onChange={e => setDataInsercao(e.target.value)}
                    className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <div className="flex-1 min-w-[12rem]">
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {OBS_LABEL[tipoNovo]}{OBS_OBRIGATORIA.has(tipoNovo) ? ' *' : ' (opcional)'}
                  </label>
                  <input type="text" value={obsNovo} onChange={e => setObsNovo(e.target.value)}
                    placeholder={OBS_PLACEHOLDER[tipoNovo]}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
                </div>
                <button onClick={handleInserir}
                  disabled={saving || (OBS_OBRIGATORIA.has(tipoNovo) && !obsNovo.trim())}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm">
                  {saving ? 'Salvando...' : 'Registrar'}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Histórico de dispositivos retirados */}
      {retirados.length > 0 && (
        <section className="border border-slate-200 rounded-xl p-4 space-y-2">
          <h3 className="font-semibold text-slate-700 text-sm">Dispositivos retirados</h3>
          <ul className="space-y-1">
            {retirados.map(d => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span>{d.tipo}{d.observacao && ` (${d.observacao})`} · {fmtData(d.data_insercao)} a {fmtData(d.data_remocao!)}</span>
                {podeEditar && (
                  <button onClick={() => abrirEdicaoDisp(d)} title="Editar datas/observação — ex.: retirada marcada por engano"
                    className="text-indigo-400 hover:text-indigo-700 flex-shrink-0">✏️</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Swabs de vigilância */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">🧫 Swabs de Vigilância</h3>
        </div>

        {swabsPendentes.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 space-y-1.5">
            <p className="text-xs font-bold text-amber-700 uppercase tracking-wide">⚠️ Resultado pendente</p>
            {swabsPendentes.map(s => (
              <div key={s.id} className="flex items-center justify-between gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                <p className="text-sm text-amber-900">
                  Coletado em {fmtData(s.data_coleta)} · há {diasDesde(s.data_coleta)} dia(s)
                </p>
                {podeEditar && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button onClick={() => handleMarcarResultadoSwab(s)}
                      className="text-xs font-medium text-amber-700 border border-amber-300 hover:bg-amber-100 rounded-lg px-2.5 py-1.5">
                      Resultado disponível
                    </button>
                    <button onClick={() => handleExcluirSwab(s.id)} title="Excluir registro"
                      className="text-slate-300 hover:text-red-500 text-sm">🗑️</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {swabsPendentes.length === 0 && swabs.length === 0 && (
          <p className="text-sm text-slate-400 italic">Nenhum swab de vigilância registrado</p>
        )}

        {podeEditar && (
          <div className="border-t border-slate-100 pt-3 flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Data da coleta</label>
              <input type="date" value={swabData} max={hojeISO()}
                onChange={e => setSwabData(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
            </div>
            <button onClick={handleColetarSwab} disabled={swabSaving}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm">
              {swabSaving ? 'Salvando...' : '+ Registrar coleta'}
            </button>
          </div>
        )}

        {swabsResolvidos.length > 0 && (
          <details className="pt-1">
            <summary className="text-xs text-indigo-500 hover:text-indigo-700 font-medium cursor-pointer">
              Histórico com resultado ({swabsResolvidos.length})
            </summary>
            <ul className="space-y-1 mt-2">
              {swabsResolvidos.map(s => (
                <li key={s.id} className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                  Coletado {fmtData(s.data_coleta)} · resultado em {fmtData(s.data_resultado)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* LPP */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">🩹 Lesão por pressão ({lpps.length})</h3>
          {podeEditar && (
            <button onClick={() => setLppAberto(o => !o)}
              className="text-xs font-medium text-indigo-600 border border-indigo-200 hover:bg-indigo-50 rounded-lg px-2.5 py-1.5">
              {lppAberto ? 'Cancelar' : '+ Registrar LPP'}
            </button>
          )}
        </div>

        {lppAberto && (
          <div className="border border-indigo-200 bg-indigo-50 rounded-lg p-3 space-y-2">
            <div className="flex gap-2 flex-wrap">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Data</label>
                <input type="date" value={lppData} max={hojeISO()}
                  onChange={e => setLppData(e.target.value)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Estágio</label>
                <select value={lppEstagio} onChange={e => setLppEstagio(e.target.value as EstagioLPP)}
                  className="px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white">
                  {ESTAGIOS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[10rem]">
                <label className="block text-xs font-medium text-slate-600 mb-1">Local</label>
                <input type="text" value={lppLocal} onChange={e => setLppLocal(e.target.value)}
                  placeholder="Ex: sacral, calcâneo"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={lppAdquirida}
                onChange={e => setLppAdquirida(e.target.checked)}
                className="w-4 h-4 accent-indigo-600" />
              <span className="text-sm text-slate-700">Adquirida na UTI</span>
            </label>
            <p className="text-xs text-slate-500">
              Desmarque se o paciente já chegou com a lesão: o indicador conta só as
              adquiridas aqui.
            </p>
            <button onClick={handleSalvarLpp} disabled={saving}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2 rounded-lg text-sm">
              {saving ? 'Salvando...' : 'Registrar LPP'}
            </button>
          </div>
        )}

        {lppsOrdenadas.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-3">Nenhuma LPP registrada</p>
        ) : (
          <ul className="space-y-1.5">
            {lppsOrdenadas.map(l => (
              <li key={l.id} className="flex items-start gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">
                    Estágio {l.estagio}{l.local ? ` · ${l.local}` : ''}
                    {!l.adquirida_na_uti && (
                      <span className="text-xs text-slate-500"> (admissão)</span>
                    )}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmtData(l.data)}</p>
                </div>
                {podeEditar && (
                  <button onClick={() => handleExcluirLpp(l.id)} title="Excluir"
                    className="text-slate-300 hover:text-red-500 text-sm flex-shrink-0">🗑️</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Editar dispositivo: corrige data de inserção/retirada ou observação
          já lançadas — inclusive "reabrir" um retirado por engano, limpando
          a data de retirada. */}
      {editandoDisp && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={e => e.target === e.currentTarget && setEditandoDisp(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-3">
            <div className="flex items-center justify-between">
              <p className="font-bold text-slate-800">
                ✏️ Editar {TIPOS.find(t => t.id === editandoDisp.tipo)?.emoji} {editandoDisp.tipo}
              </p>
              <button onClick={() => setEditandoDisp(null)} className="text-slate-400 hover:text-slate-700 text-lg">✕</button>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Data de inserção</label>
              <input type="date" value={editInsercao} max={hojeISO()}
                onChange={e => setEditInsercao(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Data de retirada</label>
              <input type="date" value={editRemocao} min={editInsercao} max={hojeISO()}
                onChange={e => setEditRemocao(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              <p className="text-xs text-slate-500 mt-1">
                Deixe em branco se o dispositivo ainda está instalado (ex.: retirada marcada por engano).
              </p>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">{OBS_LABEL[editandoDisp.tipo]}</label>
              <input type="text" value={editObs} onChange={e => setEditObs(e.target.value)}
                placeholder={OBS_PLACEHOLDER[editandoDisp.tipo]}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditandoDisp(null)}
                className="flex-1 border border-slate-300 text-slate-600 text-sm font-semibold py-2 rounded-lg hover:bg-slate-50">
                Cancelar
              </button>
              <button onClick={handleSalvarEdicaoDisp} disabled={editSaving}
                className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-lg">
                {editSaving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
