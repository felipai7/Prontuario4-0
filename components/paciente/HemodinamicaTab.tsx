'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Paciente, DVA, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  dvas: DVA[]
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

// ── Drug registry ─────────────────────────────────────────────────────────────
interface Variante { label: string; valor: number; unidade_conc: string }
interface DrogaConfig {
  nome: string
  variantes: Variante[]
  dose_unidade: string
  dose_alvo_min: number
  dose_alvo_max: number
  dose_alvo_label: string
  usaPeso: boolean
  calcDose: (fluxo: number, conc: number, peso: number) => number
  formatDose: (d: number) => string
}

const DROGAS: DrogaConfig[] = [
  {
    nome: 'Noradrenalina',
    variantes: [
      { label: 'Simples (64 mcg/mL)', valor: 64,  unidade_conc: 'mcg/mL' },
      { label: 'Dobrada (128 mcg/mL)', valor: 128, unidade_conc: 'mcg/mL' },
    ],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 0.01, dose_alvo_max: 1.5,
    dose_alvo_label: '0,01 – 1,5 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => d.toFixed(3),
  },
  {
    nome: 'Vasopressina',
    variantes: [
      { label: 'Simples (0,2 UI/mL)',  valor: 0.2, unidade_conc: 'UI/mL' },
      { label: 'Dobrada (0,2 UI/mL)',  valor: 0.2, unidade_conc: 'UI/mL' },
    ],
    dose_unidade: 'UI/min', dose_alvo_min: 0.01, dose_alvo_max: 0.04,
    dose_alvo_label: '0,01 – 0,04 UI/min',
    usaPeso: false,
    calcDose: (f, c, _p) => (f * c) / 60,
    formatDose: d => d.toFixed(3),
  },
  {
    nome: 'Dopamina',
    variantes: [
      { label: 'Padrão (1.000 mcg/mL)', valor: 1000, unidade_conc: 'mcg/mL' },
    ],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 1, dose_alvo_max: 20,
    dose_alvo_label: '1 – 20 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => d.toFixed(2),
  },
  {
    nome: 'Dobutamina',
    variantes: [
      { label: 'Padrão (5.000 mcg/mL)', valor: 5000, unidade_conc: 'mcg/mL' },
    ],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 2, dose_alvo_max: 20,
    dose_alvo_label: '2 – 20 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => d.toFixed(2),
  },
  {
    nome: 'Nitroglicerina (Tridil)',
    variantes: [
      { label: 'Padrão (200 mcg/mL)', valor: 200, unidade_conc: 'mcg/mL' },
    ],
    dose_unidade: 'mcg/min', dose_alvo_min: 5, dose_alvo_max: 200,
    dose_alvo_label: '5 – 200 mcg/min',
    usaPeso: false,
    calcDose: (f, c, _p) => (f * c) / 60,
    formatDose: d => d.toFixed(1),
  },
  {
    nome: 'Nitroprussiato (Nipride)',
    variantes: [
      { label: 'Padrão (200 mcg/mL)', valor: 200, unidade_conc: 'mcg/mL' },
    ],
    dose_unidade: 'mcg/Kg/min', dose_alvo_min: 0.3, dose_alvo_max: 10,
    dose_alvo_label: '0,3 – 10 mcg/Kg/min',
    usaPeso: true,
    calcDose: (f, c, p) => (f * c) / (60 * p),
    formatDose: d => d.toFixed(3),
  },
]

function getDrogaConfig(nome: string): DrogaConfig | undefined {
  return DROGAS.find(d => d.nome === nome)
}

function calcDoseForDVA(dva: DVA, peso: number | null): number | null {
  const cfg = getDrogaConfig(dva.droga)
  if (!cfg) return null
  if (cfg.usaPeso && !peso) return null
  return cfg.calcDose(dva.fluxo_ml_h, dva.concentracao_valor, peso ?? 1)
}

function doseAlert(dose: number, cfg: DrogaConfig): 'ok' | 'warn' | 'crit' {
  if (dose < cfg.dose_alvo_min * 0.9 || dose > cfg.dose_alvo_max * 1.1) return 'crit'
  if (dose > cfg.dose_alvo_max) return 'warn'
  return 'ok'
}

function buildSummaryText(dvas: DVA[], peso: number | null): string {
  const ativos = dvas.filter(d => d.ativo)
  if (!ativos.length) return 'Hemodinâmica estável sem uso de agentes vasoativos'

  const partes = ativos.map(dva => {
    const cfg = getDrogaConfig(dva.droga)
    const fluxoStr = dva.fluxo_ml_h % 1 === 0 ? String(dva.fluxo_ml_h) : dva.fluxo_ml_h.toFixed(1)
    if (!cfg || !peso) return `${dva.droga} ${fluxoStr} mL/h`
    const dose = cfg.calcDose(dva.fluxo_ml_h, dva.concentracao_valor, peso)
    return `${dva.droga} ${fluxoStr} mL/h (${cfg.formatDose(dose)} ${cfg.dose_unidade})`
  })

  const inicio = 'Hemodinâmica mantida às custas do uso de '
  if (partes.length === 1) return inicio + partes[0]
  const last = partes[partes.length - 1]
  return inicio + partes.slice(0, -1).join(', ') + ' e ' + last
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function HemodinamicaTab({ paciente, dvas, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const peso = paciente.peso_kg

  const [formOpen,  setFormOpen]  = useState(false)
  const [selDroga,  setSelDroga]  = useState(DROGAS[0].nome)
  const [selVar,    setSelVar]    = useState(0)
  const [fluxo,     setFluxo]     = useState('')
  const [saving,    setSaving]    = useState(false)
  const [removing,  setRemoving]  = useState<string | null>(null)
  const [copied,    setCopied]    = useState(false)

  const ativosDVA  = dvas.filter(d => d.ativo)
  const summary    = buildSummaryText(ativosDVA, peso)
  const emUsoDVA   = ativosDVA.length > 0

  const drogaConfig    = getDrogaConfig(selDroga)!
  const varianteConfig = drogaConfig.variantes[selVar] ?? drogaConfig.variantes[0]
  const fluxoNum       = parseFloat(fluxo)
  const dosePreview    = !isNaN(fluxoNum) && fluxoNum > 0 && (drogaConfig.usaPeso ? !!peso : true)
    ? drogaConfig.calcDose(fluxoNum, varianteConfig.valor, peso ?? 1)
    : null

  const handleSave = async () => {
    if (!fluxo || isNaN(fluxoNum) || fluxoNum <= 0) {
      showToast('Informe o fluxo em mL/h', 'error'); return
    }
    setSaving(true)
    const { error } = await supabase.from('dvas').insert({
      paciente_id:          paciente.id,
      droga:                selDroga,
      concentracao_valor:   varianteConfig.valor,
      concentracao_unidade: varianteConfig.unidade_conc,
      concentracao_label:   varianteConfig.label,
      fluxo_ml_h:           fluxoNum,
      ativo:                true,
    })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('DVA registrada!')
    setFormOpen(false); setFluxo(''); onRefresh()
  }

  const handleRemove = async (id: string) => {
    if (!confirm('Encerrar uso desta DVA?')) return
    setRemoving(id)
    const { error } = await supabase.from('dvas').delete().eq('id', id)
    setRemoving(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('DVA encerrada')
    onRefresh()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(summary).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleDrogaChange = (nome: string) => {
    setSelDroga(nome); setSelVar(0); setFluxo('')
  }

  return (
    <div className="space-y-4">

      {/* Summary banner */}
      <div className={`rounded-xl p-4 border flex items-start justify-between gap-3 ${
        emUsoDVA
          ? 'bg-amber-50 border-amber-300'
          : 'bg-green-50 border-green-300'
      }`}>
        <div className="flex-1">
          <p className={`text-sm font-semibold leading-relaxed ${emUsoDVA ? 'text-amber-800' : 'text-green-800'}`}>
            {emUsoDVA ? '⚠️' : '✅'} {summary}
          </p>
          {emUsoDVA && !peso && (
            <p className="text-xs text-amber-600 mt-1">⚠️ Peso não cadastrado — doses em mL/h (sem conversão mcg/Kg/min)</p>
          )}
        </div>
        <button onClick={handleCopy}
          className={`flex-shrink-0 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-colors ${
            copied
              ? 'bg-green-600 text-white border-green-600'
              : emUsoDVA
                ? 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200'
                : 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200'
          }`}>
          {copied ? '✓ Copiado' : '📋 Copiar'}
        </button>
      </div>

      {/* DVA list */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-700">
          DVAs em uso ({ativosDVA.length})
        </h3>
        <button onClick={() => setFormOpen(o => !o)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors">
          {formOpen ? '✕ Cancelar' : '+ Adicionar DVA'}
        </button>
      </div>

      {ativosDVA.length === 0 && !formOpen && (
        <p className="text-slate-400 text-sm italic text-center py-6">Nenhuma DVA ativa</p>
      )}

      {ativosDVA.map(dva => {
        const cfg  = getDrogaConfig(dva.droga)
        const dose = calcDoseForDVA(dva, peso)
        const alrt = dose && cfg ? doseAlert(dose, cfg) : 'ok'
        const fluxoStr = dva.fluxo_ml_h % 1 === 0 ? String(dva.fluxo_ml_h) : dva.fluxo_ml_h.toFixed(1)

        return (
          <div key={dva.id} className={`border rounded-xl p-4 flex items-center gap-4 ${
            alrt === 'crit' ? 'bg-red-50 border-red-300' :
            alrt === 'warn' ? 'bg-amber-50 border-amber-200' :
                              'bg-white border-slate-200'
          }`}>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-800">{dva.droga}</p>
                <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">{dva.concentracao_label}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <span className="text-sm font-semibold text-indigo-700">{fluxoStr} mL/h</span>
                {dose !== null && cfg ? (
                  <span className={`text-sm font-bold ${
                    alrt === 'crit' ? 'text-red-700' :
                    alrt === 'warn' ? 'text-amber-700' :
                                     'text-slate-700'
                  }`}>
                    {cfg.formatDose(dose)} {cfg.dose_unidade}
                    {alrt !== 'ok' && <span className="ml-1 text-xs">{alrt === 'crit' ? '⚠️ fora do alvo' : '⬆️ acima do alvo'}</span>}
                  </span>
                ) : cfg?.usaPeso && !peso ? (
                  <span className="text-xs text-slate-400">cadastre o peso para calcular dose</span>
                ) : null}
                {cfg && (
                  <span className="text-xs text-slate-400">alvo: {cfg.dose_alvo_label}</span>
                )}
              </div>
            </div>
            <button onClick={() => handleRemove(dva.id)} disabled={removing === dva.id}
              className="text-xs text-red-400 hover:text-red-700 border border-red-100 hover:border-red-300 px-2 py-1.5 rounded-lg transition-colors flex-shrink-0">
              {removing === dva.id ? '⏳' : '⏹ Encerrar'}
            </button>
          </div>
        )
      })}

      {/* Add DVA form */}
      {formOpen && (
        <div className="border-2 border-indigo-200 rounded-xl bg-indigo-50 p-4 space-y-3">
          <p className="text-sm font-bold text-indigo-900">Nova DVA</p>

          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Droga *</label>
            <select value={selDroga} onChange={e => handleDrogaChange(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {DROGAS.map(d => <option key={d.nome} value={d.nome}>{d.nome}</option>)}
            </select>
          </div>

          {drogaConfig.variantes.length > 1 && (
            <div>
              <label className="text-xs text-slate-500 font-medium block mb-1">Concentração *</label>
              <div className="flex rounded-lg overflow-hidden border border-slate-300">
                {drogaConfig.variantes.map((v, i) => (
                  <button key={i} onClick={() => setSelVar(i)}
                    className={`flex-1 py-2 text-sm font-semibold transition-colors ${
                      selVar === i ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                    }`}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {drogaConfig.variantes.length === 1 && (
            <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-500">
              Concentração: <span className="font-semibold text-slate-700">{varianteConfig.label}</span>
            </div>
          )}

          <div>
            <label className="text-xs text-slate-500 font-medium block mb-1">Fluxo (mL/h) *</label>
            <input type="number" step="0.1" min="0" value={fluxo} onChange={e => setFluxo(e.target.value)}
              placeholder="ex: 5.5"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"/>
          </div>

          {/* Dose preview */}
          {dosePreview !== null && (
            <div className={`rounded-lg px-4 py-3 border text-sm ${
              doseAlert(dosePreview, drogaConfig) === 'crit' ? 'bg-red-50 border-red-300 text-red-800' :
              doseAlert(dosePreview, drogaConfig) === 'warn' ? 'bg-amber-50 border-amber-300 text-amber-800' :
                                                               'bg-green-50 border-green-300 text-green-800'
            }`}>
              <span className="font-bold">{drogaConfig.formatDose(dosePreview)} {drogaConfig.dose_unidade}</span>
              <span className="ml-2 text-xs opacity-70">(alvo: {drogaConfig.dose_alvo_label})</span>
            </div>
          )}
          {drogaConfig.usaPeso && !peso && (
            <p className="text-xs text-amber-600">⚠️ Cadastre o peso do paciente para calcular a dose em {drogaConfig.dose_unidade}</p>
          )}

          <button onClick={handleSave} disabled={saving}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold py-2.5 rounded-lg text-sm transition-colors">
            {saving ? 'Salvando...' : '+ Registrar DVA'}
          </button>
        </div>
      )}
    </div>
  )
}
