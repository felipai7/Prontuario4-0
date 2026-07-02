'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { calcBalanco, calcAcumuladoMovel, diaAtualATB, fmtNum } from '@/lib/utils'
import type { Paciente, SinalVital, DVA, PeriodoBalanco, ATB, CuidadosHorizontais, Intercorrencia, PendenciaIntensivista, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  sinais: SinalVital[]
  dvas: DVA[]
  periodos: PeriodoBalanco[]
  atbs: ATB[]
  cuidados: CuidadosHorizontais | null
  intercorrencias: Intercorrencia[]
  pendencias: PendenciaIntensivista[]
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

export default function PlantonistaTab({ paciente, sinais, dvas, periodos, atbs, cuidados, intercorrencias, pendencias, onRefresh, showToast }: Props) {
  const supabase = createClient()

  // Intercorrências são carregadas e assinadas pela casca (PacienteModal) — este
  // módulo só precisa do e-mail do autor logado para registrar novas entradas.
  const [autorEmail, setAutorEmail] = useState('')
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setAutorEmail(data.user?.email ?? ''))
  }, [])

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

  return (
    <div className="space-y-6">

      {/* Painel-resumo para passagem de plantão */}
      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-700 mb-3">📟 Painel do Plantão</h3>
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

          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💉 Drogas vasoativas</p>
            {dvasAtivas.length ? (
              <p className="text-sm text-slate-700">{dvasAtivas.map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(' · ')}</p>
            ) : <p className="text-sm text-emerald-600">Sem vasopressores/inotrópicos em uso.</p>}
          </div>

          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💧 Balanço hídrico</p>
            {ultimoPeriodo && bhUltimo ? (
              <p className="text-sm text-slate-700">
                Último turno: {bhUltimo.parcial > 0 ? '+' : ''}{bhUltimo.parcial.toFixed(0)} mL
                (diurese {ultimoPeriodo.diurese} mL{ultimoPeriodo.horas_periodo > 0 && <> → {fmtNum(ultimoPeriodo.diurese / ultimoPeriodo.horas_periodo, 1)} mL/h</>})
                · Acum. móvel: {bhMovel > 0 ? '+' : ''}{bhMovel.toFixed(0)} mL
              </p>
            ) : <p className="text-sm text-slate-400">Sem balanço registrado.</p>}
          </div>

          <div className="bg-slate-50 rounded-lg p-3">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">💊 Antibioticoterapia</p>
            {atbsAtivos.length ? (
              <p className="text-sm text-slate-700">
                {atbsAtivos.map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''})`).join(' · ')}
              </p>
            ) : <p className="text-sm text-slate-400">Sem ATB em curso.</p>}
          </div>

          {pendencias.some(p => !p.resolvida) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 md:col-span-2">
              <p className="text-xs font-bold text-amber-700 uppercase tracking-wide mb-1">📝 Pendências em aberto</p>
              <ul className="text-sm text-amber-900 space-y-0.5">
                {pendencias.filter(p => !p.resolvida).map(p => <li key={p.id}>• {p.texto}</li>)}
              </ul>
            </div>
          )}
        </div>
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
