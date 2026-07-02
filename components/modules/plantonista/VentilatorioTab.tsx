'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, diasDesde } from '@/lib/utils'
import type { Paciente, SuporteVentilatorio, ModalidadeVentilatoria, DispositivoO2, ViaAereaVM, ToastData } from '@/types'

interface Props {
  paciente: Paciente
  ventilatorio: SuporteVentilatorio | null
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

const MODALIDADES: { id: ModalidadeVentilatoria; label: string }[] = [
  { id: 'ar_ambiente',         label: '🌬️ Ar ambiente' },
  { id: 'o2_suplementar',      label: '💨 O₂ suplementar' },
  { id: 'ventilacao_mecanica', label: '🫁 Ventilação mecânica' },
]
const DISPOSITIVOS_O2: DispositivoO2[] = ['Cateter nasal', 'Máscara facial', 'Máscara com reservatório', 'CNAF', 'VNI', 'Outro']
const VIAS_VM: ViaAereaVM[] = ['TOT', 'TQT']

const labelCls = 'text-xs text-slate-500 font-medium block mb-1'
const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400'

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${
        selected
          ? 'bg-indigo-600 border-indigo-600 text-white'
          : 'bg-white border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600'
      }`}>
      {children}
    </button>
  )
}

export default function VentilatorioTab({ paciente, ventilatorio, onRefresh, showToast }: Props) {
  const supabase = createClient()
  const hoje = new Date().toISOString().split('T')[0]

  const [modalidade,   setModalidade]   = useState<ModalidadeVentilatoria | null>(ventilatorio?.modalidade ?? null)
  const [dispositivo,  setDispositivo]  = useState<DispositivoO2 | null>(ventilatorio?.o2_dispositivo ?? null)
  const [fluxo,        setFluxo]        = useState(ventilatorio?.o2_fluxo_l_min != null ? String(ventilatorio.o2_fluxo_l_min) : '')
  const [vmVia,        setVmVia]        = useState<ViaAereaVM | null>(ventilatorio?.vm_via ?? null)
  const [vmDataInicio, setVmDataInicio] = useState(ventilatorio?.vm_data_inicio ?? '')
  const [saving,       setSaving]       = useState(false)

  // Re-sincroniza quando o registro muda (realtime / reload)
  useEffect(() => {
    setModalidade(ventilatorio?.modalidade ?? null)
    setDispositivo(ventilatorio?.o2_dispositivo ?? null)
    setFluxo(ventilatorio?.o2_fluxo_l_min != null ? String(ventilatorio.o2_fluxo_l_min) : '')
    setVmVia(ventilatorio?.vm_via ?? null)
    setVmDataInicio(ventilatorio?.vm_data_inicio ?? '')
  }, [ventilatorio?.updated_at])

  const selecionarModalidade = (m: ModalidadeVentilatoria) => {
    setModalidade(m)
    // Default: data de início = hoje ao selecionar VM pela primeira vez
    if (m === 'ventilacao_mecanica' && !vmDataInicio) setVmDataInicio(hoje)
  }

  const handleSave = async () => {
    if (!modalidade) { showToast('Selecione a modalidade', 'error'); return }
    setSaving(true)
    // Trocar de modalidade oculta os campos das outras, mas PRESERVA os
    // valores no banco — por isso o payload salva todos os campos.
    const payload = {
      paciente_id:    paciente.id,
      modalidade,
      o2_dispositivo: dispositivo,
      o2_fluxo_l_min: fluxo ? parseFloat(fluxo) : null,
      vm_via:         vmVia,
      vm_data_inicio: vmDataInicio || null,
    }
    const { error } = await supabase.from('suportes_ventilatorios').upsert(payload, { onConflict: 'paciente_id' })
    setSaving(false)
    if (error) { showToast('Erro ao salvar: ' + error.message, 'error'); return }
    showToast('Suporte ventilatório salvo!')
    onRefresh()
  }

  return (
    <div className="space-y-6">

      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <h3 className="font-semibold text-slate-700">🫁 Suporte Ventilatório</h3>

        <div>
          <label className={labelCls}>Modalidade</label>
          <div className="flex gap-2 flex-wrap">
            {MODALIDADES.map(m => (
              <Chip key={m.id} selected={modalidade === m.id} onClick={() => selecionarModalidade(m.id)}>{m.label}</Chip>
            ))}
          </div>
        </div>

        {modalidade === 'o2_suplementar' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Dispositivo</label>
              <div className="flex gap-1.5 flex-wrap">
                {DISPOSITIVOS_O2.map(d => (
                  <Chip key={d} selected={dispositivo === d} onClick={() => setDispositivo(dispositivo === d ? null : d)}>{d}</Chip>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Fluxo (L/min) — opcional</label>
              <input type="number" step="0.5" min="0" max="80" value={fluxo}
                onChange={e => setFluxo(e.target.value)} className={`${inputCls} max-w-[10rem]`} />
            </div>
          </div>
        )}

        {modalidade === 'ventilacao_mecanica' && (
          <div className="space-y-3">
            <div>
              <label className={labelCls}>Via aérea</label>
              <div className="flex gap-2">
                {VIAS_VM.map(v => (
                  <Chip key={v} selected={vmVia === v} onClick={() => setVmVia(vmVia === v ? null : v)}>{v}</Chip>
                ))}
              </div>
            </div>
            <div>
              <label className={labelCls}>Data de início da VM</label>
              <input type="date" value={vmDataInicio} max={hoje}
                onChange={e => setVmDataInicio(e.target.value)} className={`${inputCls} max-w-[12rem]`} />
              {vmDataInicio && (
                <p className="text-sm font-bold text-indigo-700 mt-2">
                  ⏱️ {diasDesde(vmDataInicio)} dia(s) de VM (desde {fmtData(vmDataInicio)})
                </p>
              )}
            </div>
          </div>
        )}
      </section>

      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold px-6 py-2.5 rounded-lg transition-colors">
          {saving ? 'Salvando...' : '💾 Salvar suporte'}
        </button>
      </div>
    </div>
  )
}
