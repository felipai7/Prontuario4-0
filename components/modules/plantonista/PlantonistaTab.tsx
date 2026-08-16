'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcBalanco, calcAcumuladoMovel, calcDiurese24h, diaAtualATB, diasDesde, fmtNum, fmtTurno, hojeISO, balancoDaUnidade } from '@/lib/utils'
import { fmtData } from '@/lib/utils'
import type { Paciente, SinalVital, DVA, PeriodoBalanco, ATB, CuidadosHorizontais, Intercorrencia, PendenciaIntensivista, RegistroIntensivista, SwabVigilancia, ExameImagem, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  sinais: SinalVital[]
  dvas: DVA[]
  periodos: PeriodoBalanco[]
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  intercorrencias: Intercorrencia[]
  pendencias: PendenciaIntensivista[]
  registrosIntensivista: RegistroIntensivista[]
  swabs: SwabVigilancia[]
  examesImagem: ExameImagem[]
  /** UTI mostra DVA/saldo/acumulado; Hospital ("Resumo") esconde DVA e mostra
   *  só a diurese 24h do balanço diário — ver decisões do plano de Hospital. */
  tipoUnidade: 'uti' | 'enfermaria'
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'
const labelCls = 'text-xs text-slate-500 font-medium block mb-1'

function fmtHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Valor default para <input type="datetime-local">: agora, no fuso local. */
function agoraLocal(): string {
  const d = new Date()
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset())
  return d.toISOString().slice(0, 16)
}

export default function PlantonistaTab({ paciente, sinais, dvas, periodos: periodosTodos, atbs, cuidados, intercorrencias, pendencias, registrosIntensivista, swabs, examesImagem, tipoUnidade, onRefresh, showToast }: Props) {
  const supabase = createClient()

  // Só o balanço lançado NESTA unidade — se o paciente já esteve em outra
  // (transferência UTI↔Hospital), o balanço de lá fica visível só em modo
  // leitura na aba Balanço, e não entra no card-resumo daqui.
  const periodos = balancoDaUnidade(periodosTodos, paciente.unit_id)

  // Intercorrências são carregadas e assinadas pela casca (PacienteModal) — este
  // módulo só precisa do e-mail do autor logado para registrar novas entradas.
  const [autorEmail, setAutorEmail] = useState('')
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAutorEmail(data.user?.email ?? ''))
  }, [])

  // ── Histórico patológico pregresso e medicações de uso contínuo ──────────
  // Contexto da internação como um todo, não por turno — por isso mora direto
  // em `pacientes`, e não numa tabela filha. Reseta ao trocar de paciente
  // (setas de leito reaproveitam o mesmo componente), mas não some se um
  // realtime update do MESMO paciente chegar enquanto alguém está digitando.
  const [hpp,         setHpp]         = useState(paciente.historico_patologico_pregresso ?? '')
  const [medicacoes,  setMedicacoes]  = useState(paciente.medicacoes_uso_continuo ?? '')
  const [savingHist,  setSavingHist]  = useState(false)
  useEffect(() => {
    setHpp(paciente.historico_patologico_pregresso ?? '')
    setMedicacoes(paciente.medicacoes_uso_continuo ?? '')
  }, [paciente.id])

  const histDirty = hpp !== (paciente.historico_patologico_pregresso ?? '')
    || medicacoes !== (paciente.medicacoes_uso_continuo ?? '')

  const handleSalvarHistorico = async () => {
    setSavingHist(true)
    const { error } = await supabase.from('pacientes').update({
      historico_patologico_pregresso: hpp.trim() || null,
      medicacoes_uso_continuo: medicacoes.trim() || null,
    }).eq('id', paciente.id)
    setSavingHist(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Histórico e medicações atualizados!')
    onRefresh()
  }

  // ── Form de nova intercorrência ────────────────────────────────────────────
  const [formOpen,  setFormOpen]  = useState(false)
  const [horario,   setHorario]   = useState(agoraLocal)
  const [descricao, setDescricao] = useState('')
  const [conduta,   setConduta]   = useState('')
  const [saving,    setSaving]    = useState(false)

  const handleSave = async () => {
    if (!descricao.trim()) { showToast('Descreva a intercorrência', 'error'); return }
    if (!horario) { showToast('Informe o horário', 'error'); return }
    setSaving(true)
    const { error } = await supabase.from('intercorrencias').insert({
      paciente_id: paciente.id,
      horario:     new Date(horario).toISOString(),
      descricao:   descricao.trim(),
      conduta:     conduta.trim() || null,
      autor_email: autorEmail,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Intercorrência registrada!')
    setFormOpen(false); setDescricao(''); setConduta(''); setHorario(agoraLocal())
    onRefresh()
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este registro de intercorrência?')) return
    const { error } = await supabase.from('intercorrencias').delete().eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Registro excluído')
    onRefresh()
  }

  // ── Dados do painel-resumo (derivados do que a casca já carregou) ─────────
  const ultimoSinal   = sinais.length ? sinais[sinais.length - 1] : null
  const dvasAtivas    = dvas.filter(d => d.ativo)
  const atbsAtivos    = atbs.filter(a => a.ativo)
  const ultimoPeriodo = periodos.length
    ? [...periodos].sort((a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime())[0]
    : null
  const bhUltimo = ultimoPeriodo ? calcBalanco(ultimoPeriodo) : null
  const bhMovel  = calcAcumuladoMovel(periodos)
  const { horas: duHoras, total: duTotal } = calcDiurese24h(periodos)
  // Só usado no Hospital — lá o balanço em si perde relevância (ver
  // BalancoDiarioTab), mas diurese e última evacuação continuam úteis.
  const ultimaEvacuacao = [...periodos].reverse().find(p => p.evacuacao > 0) ?? null
  const ultimoRegistroIntensivista = registrosIntensivista.length
    ? [...registrosIntensivista].sort((a, b) => new Date(b.data).getTime() - new Date(a.data).getTime())[0]
    : null
  // Fica visível todo dia enquanto não marcarem o resultado — não é um aviso
  // único disparado na coleta, é uma condição que persiste (ver EnfermagemTab).
  const swabsPendentes = swabs.filter(s => !s.resultado_disponivel)
  const previsaoAlta = cuidados?.previsao_alta ?? null
  const altaVencida = previsaoAlta != null && previsaoAlta <= hojeISO()
  const examesCriticos = examesImagem.filter(e => e.critico)

  const handleDesmarcarCritico = async (id: string) => {
    const { error } = await supabase.from('exames_imagem').update({ critico: false }).eq('id', id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    onRefresh()
  }

  return (
    <div className="space-y-6">

      {/* Painel-resumo para passagem de plantão */}
      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-700 mb-3">
          {tipoUnidade === 'enfermaria' ? '📋 Resumo' : '📟 Painel do Plantão'}
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">

          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">❤️ Últimos sinais vitais</p>
            {ultimoSinal ? (
              <>
                <p className="text-sm text-slate-700">
                  FC {ultimoSinal.fc ?? '–'} bpm · PA {ultimoSinal.pas ?? '–'}/{ultimoSinal.pad ?? '–'} mmHg
                  {ultimoSinal.pam != null && <> · PAM {ultimoSinal.pam}</>} · SatO₂ {ultimoSinal.sato2 ?? '–'}%
                  {ultimoSinal.temperatura != null && <> · {ultimoSinal.temperatura}°C</>}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">aferido em {fmtHora(ultimoSinal.horario)}</p>
              </>
            ) : <p className="text-sm text-slate-400">Sem aferições registradas.</p>}
          </div>

          {/* DVA não existe no Hospital — Hemodinâmica saiu de lá por completo. */}
          {tipoUnidade === 'uti' && (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💉 Drogas vasoativas</p>
              {dvasAtivas.length ? (
                <p className="text-sm text-slate-700">{dvasAtivas.map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(' · ')}</p>
              ) : <p className="text-sm text-emerald-600">Sem vasopressores/inotrópicos em uso.</p>}
            </div>
          )}

          {tipoUnidade === 'enfermaria' ? (
            // Hospital: o balanço em si perde relevância (ver BalancoDiarioTab
            // — ganho nem sempre é quantificado lá), então o resumo troca o
            // card único de balanço por diurese registrada + última evacuação.
            <>
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💧 Diurese registrada</p>
                {periodos.length > 0 ? (
                  <p className="text-sm text-slate-700">
                    {duTotal.toFixed(0)} mL
                    {duHoras > 0 && <> → {fmtNum(duTotal / (paciente.peso_kg ?? 70) / duHoras, 2)} mL/Kg/h{!paciente.peso_kg && ' (peso 70 Kg)'}</>}
                  </p>
                ) : <p className="text-sm text-slate-400">Sem diurese registrada.</p>}
              </div>

              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">🚽 Última evacuação</p>
                {ultimaEvacuacao ? (
                  <p className="text-sm text-slate-700">
                    {ultimaEvacuacao.evacuacao.toFixed(0)} mL — {fmtTurno(ultimaEvacuacao.turno, ultimaEvacuacao.inicio)}
                  </p>
                ) : <p className="text-sm text-slate-400">Ausente desde admissão.</p>}
              </div>
            </>
          ) : (
            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💧 Balanço hídrico</p>
              {ultimoPeriodo && bhUltimo ? (
                <p className="text-sm text-slate-700">
                  Último turno: {bhUltimo.parcial > 0 ? '+' : ''}{bhUltimo.parcial.toFixed(0)} mL
                  {/* mL/Kg/h, e não mL/h: é a forma em que se lê oligúria (<0,5) e
                      anúria (<0,1). Mesma conta e mesmas 2 casas do cartão de
                      Débito Urinário da aba Balanço, inclusive o fallback de 70 Kg
                      — que é sinalizado, porque um limiar clínico calculado sobre
                      peso presumido não pode passar por medido. Diurese em 24h (não
                      do último turno) via calcDiurese24h, a mesma função do
                      cabeçalho do Balanço Hídrico — os dois têm que bater. */}
                  (diurese 24h {duTotal.toFixed(0)} mL{duHoras > 0 && <> → {fmtNum(duTotal / (paciente.peso_kg ?? 70) / duHoras, 2)} mL/Kg/h{!paciente.peso_kg && ' (peso 70 Kg)'}</>}{duHoras > 0 && duHoras < 24 && ` — dados de ${duHoras.toFixed(0)}h`})
                  · Acum. móvel: {bhMovel > 0 ? '+' : ''}{bhMovel.toFixed(0)} mL
                </p>
              ) : <p className="text-sm text-slate-400">Sem balanço registrado.</p>}
            </div>
          )}

          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💊 Antibioticoterapia</p>
            {atbsAtivos.length ? (
              <p className="text-sm text-slate-700">
                {atbsAtivos.map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''})`).join(' · ')}
              </p>
            ) : <p className="text-sm text-slate-400">Sem ATB em curso.</p>}
          </div>

          <div className={`rounded-lg p-3 ${altaVencida ? 'bg-amber-50 border border-amber-300' : 'bg-slate-50'}`}>
            <p className={`text-xs font-bold uppercase tracking-wide mb-1 ${altaVencida ? 'text-amber-700' : 'text-slate-500'}`}>
              📅 Previsão de alta
            </p>
            {previsaoAlta ? (
              <p className={`text-sm ${altaVencida ? 'text-amber-900 font-semibold' : 'text-slate-700'}`}>
                {fmtData(previsaoAlta)}
                {altaVencida && (
                  <> — ⚠️ {previsaoAlta === hojeISO() ? 'é hoje' : `venceu há ${diasDesde(previsaoAlta)} dia(s)`}</>
                )}
              </p>
            ) : <p className="text-sm text-slate-400">Não definida pelo intensivista.</p>}
          </div>

          {examesCriticos.length > 0 && (
            <div className="bg-red-50 border border-red-300 rounded-lg p-3 md:col-span-2">
              <p className="text-xs font-bold text-red-700 uppercase tracking-wide mb-1">🔴 Exames com resultado crítico</p>
              <ul className="text-sm text-red-900 space-y-1">
                {examesCriticos.map(e => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <span>• {e.tipo_exame}{e.data_exame && <span className="text-red-600"> — {e.data_exame}</span>}</span>
                    <button onClick={() => handleDesmarcarCritico(e.id)}
                      className="text-xs text-red-500 hover:text-red-700 underline flex-shrink-0">
                      desmarcar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {pendencias.some(p => !p.resolvida) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 md:col-span-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">📝 Pendências em aberto</p>
              <ul className="text-sm text-amber-900 space-y-0.5">
                {pendencias.filter(p => !p.resolvida).map(p => <li key={p.id}>• {p.texto}</li>)}
              </ul>
            </div>
          )}

          {swabsPendentes.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 md:col-span-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">🧫 Swab(s) de vigilância pendente(s)</p>
              <ul className="text-sm text-amber-900 space-y-0.5">
                {swabsPendentes.map(s => (
                  <li key={s.id}>• Coletado em {fmtData(s.data_coleta)} — há {diasDesde(s.data_coleta)} dia(s) sem resultado</li>
                ))}
              </ul>
            </div>
          )}

          {ultimoRegistroIntensivista && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-3 md:col-span-2">
              <p className="text-xs font-bold text-indigo-700 uppercase tracking-wide mb-1">
                🗒️ Orientações e Condutas (Médico Intensivista) — {fmtData(ultimoRegistroIntensivista.data)}
              </p>
              <p className="text-sm text-indigo-900 whitespace-pre-wrap">{ultimoRegistroIntensivista.orientacoes_condutas}</p>
            </div>
          )}
        </div>
      </section>

      {/* Histórico patológico pregresso e medicações de uso contínuo */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-700">📋 Histórico e Medicações</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Histórico Patológico Pregresso</label>
            <textarea value={hpp} onChange={e => setHpp(e.target.value)} rows={4}
              placeholder="Ex: HAS, DM2, Fibrilação atrial..." className={`${inputCls} resize-none`} />
          </div>
          <div>
            <label className={labelCls}>Medicações de Uso Contínuo</label>
            <textarea value={medicacoes} onChange={e => setMedicacoes(e.target.value)} rows={4}
              placeholder="Ex: Losartana 50mg VO 1x/dia, Metformina 850mg VO 2x/dia..." className={`${inputCls} resize-none`} />
          </div>
        </div>
        {histDirty && (
          <div className="flex justify-end">
            <button onClick={handleSalvarHistorico} disabled={savingHist}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
              {savingHist ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        )}
      </section>

      {/* Intercorrências e condutas */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-700">🚨 Intercorrências do Plantão ({intercorrencias.length})</h3>
          <button onClick={() => setFormOpen(o => !o)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg transition-colors">
            {formOpen ? 'Cancelar' : '+ Nova intercorrência'}
          </button>
        </div>

        {formOpen && (
          <div className="bg-slate-50 rounded-lg p-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <div>
                <label className={labelCls}>Horário *</label>
                <input type="datetime-local" value={horario} onChange={e => setHorario(e.target.value)} className={inputCls} />
              </div>
              <div className="md:col-span-2">
                <label className={labelCls}>Intercorrência *</label>
                <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
                  placeholder="Ex: Hipotensão sustentada, dessaturação, febre..." className={`${inputCls} resize-none`} />
              </div>
              <div className="md:col-span-3">
                <label className={labelCls}>Conduta</label>
                <textarea value={conduta} onChange={e => setConduta(e.target.value)} rows={2}
                  placeholder="Ex: Iniciado noradrenalina, coletadas culturas, solicitado RX de tórax..." className={`${inputCls} resize-none`} />
              </div>
            </div>
            <div className="flex justify-end">
              <button onClick={handleSave} disabled={saving}
                className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-2 rounded-lg transition-colors">
                {saving ? 'Salvando...' : 'Registrar'}
              </button>
            </div>
          </div>
        )}

        {intercorrencias.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">Nenhuma intercorrência registrada para este paciente.</p>
        ) : (
          <ul className="space-y-2">
            {intercorrencias.map(i => (
              <li key={i.id} className="border border-slate-200 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-400">
                      🕐 {fmtHora(i.horario)}{i.autor_email && <> · ✍️ {i.autor_email}</>}
                    </p>
                    <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap">{i.descricao}</p>
                    {i.conduta && (
                      <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">
                        <span className="font-semibold text-slate-500">Conduta:</span> {i.conduta}
                      </p>
                    )}
                  </div>
                  <button onClick={() => handleDelete(i.id)} title="Excluir registro"
                    className="text-slate-300 hover:text-red-500 flex-shrink-0 text-sm transition-colors">
                    🗑️
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
