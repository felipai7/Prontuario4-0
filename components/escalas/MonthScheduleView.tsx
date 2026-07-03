'use client'
import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Shift, PublishedMonth, Staff, ShiftType, ToastData } from '@/types'

interface Props {
  unitId: string
  staffList: Staff[]
  shiftTypesList: ShiftType[]
  souChefe: boolean
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

interface PreviewRow {
  pub_date: string
  day_number: number
  shift_type_id: string
  shift_type_name: string
  staff_names: string[]
  vagas: number
}

function primeiroDiaMes(ref: Date): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-01`
}

function fmtMesAno(ref: Date): string {
  return ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function fmtDiaSemana(dataStr: string): string {
  const d = new Date(dataStr + 'T12:00:00')
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

export default function MonthScheduleView({ unitId, staffList, shiftTypesList, souChefe, showToast }: Props) {
  const supabase = createClient()
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [shifts, setShifts] = useState<Shift[]>([])
  const [publicado, setPublicado] = useState<PublishedMonth | null>(null)
  const [loading, setLoading] = useState(false)

  const [revisando, setRevisando] = useState(false)
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [publicando, setPublicando] = useState(false)

  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])

  const load = async () => {
    if (!unitId) return
    setLoading(true)
    const mesInicio = primeiroDiaMes(ref)
    const proxMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
    const mesFim = primeiroDiaMes(proxMes)

    const [{ data: shiftsData, error: shiftsErr }, { data: pubData, error: pubErr }] = await Promise.all([
      supabase.from('shifts').select('*').eq('unit_id', unitId).gte('date', mesInicio).lt('date', mesFim).order('date'),
      supabase.from('published_months').select('*').eq('unit_id', unitId).eq('month', mesInicio).maybeSingle(),
    ])
    setLoading(false)
    if (shiftsErr) { showToast('Erro ao carregar escala: ' + shiftsErr.message, 'error'); return }
    if (pubErr) { showToast('Erro ao carregar publicação: ' + pubErr.message, 'error'); return }
    setShifts((shiftsData as Shift[]) ?? [])
    setPublicado((pubData as PublishedMonth | null) ?? null)
  }

  useEffect(() => { load(); setRevisando(false); setPreview([]) }, [unitId, ref])

  const handleRevisar = async () => {
    setLoadingPreview(true)
    const { data, error } = await supabase.rpc('preview_publish_month', { p_unit_id: unitId, p_month: primeiroDiaMes(ref) })
    setLoadingPreview(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setPreview((data as PreviewRow[]) ?? [])
    setRevisando(true)
  }

  const temTurnoVazio = preview.some(p => p.vagas === 0)

  const handlePublicar = async () => {
    setPublicando(true)
    const { error } = await supabase.rpc('publish_month', { p_unit_id: unitId, p_month: primeiroDiaMes(ref) })
    setPublicando(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Mês publicado!')
    setRevisando(false); setPreview([])
    load()
  }

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-slate-700">📆 Escala publicada</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">←</button>
          <span className="text-sm font-medium text-slate-700 capitalize min-w-[9rem] text-center">{fmtMesAno(ref)}</span>
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">→</button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {publicado ? (
          <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5 inline-block">
            ✓ Mês publicado
          </p>
        ) : (
          <p className="text-xs text-slate-400 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 inline-block">
            Mês ainda não publicado
          </p>
        )}

        {souChefe && !publicado && !revisando && (
          <button onClick={handleRevisar} disabled={loadingPreview}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
            {loadingPreview ? 'Carregando...' : '🔍 Revisar publicação'}
          </button>
        )}
      </div>

      {revisando && (
        <div className="bg-slate-50 rounded-lg p-3 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Prévia da publicação — {fmtMesAno(ref)}</p>

          {temTurnoVazio && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-1.5">
              ⚠️ Há turnos sem nenhum profissional atribuído no mês padrão. Preencha o editor do mês padrão antes de publicar.
            </p>
          )}

          <ul className="space-y-1 max-h-72 overflow-y-auto">
            {preview.map((p, i) => {
              const bg = p.vagas === 0 ? 'bg-red-50' : p.vagas === 1 ? 'bg-amber-50' : 'bg-emerald-50'
              return (
                <li key={i} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-xs ${bg}`}>
                  <span className="text-slate-500 capitalize">{fmtDiaSemana(p.pub_date)}</span>
                  <span className="text-slate-700">{p.shift_type_name}</span>
                  <span className="font-medium text-slate-800">{p.staff_names.length ? p.staff_names.join(' / ') : '—'}</span>
                </li>
              )
            })}
          </ul>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setRevisando(false); setPreview([]) }}
              className="text-xs font-medium text-slate-500 border border-slate-200 rounded-lg px-3 py-1.5">
              Cancelar
            </button>
            <button onClick={handlePublicar} disabled={temTurnoVazio || publicando}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold px-3 py-1.5 rounded-lg">
              {publicando ? 'Publicando...' : '✓ Confirmar publicação'}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : shifts.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum plantão registrado para este mês nesta unidade.</p>
      ) : (
        <ul className="space-y-1.5">
          {shifts.map(s => (
            <li key={s.id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <span className="text-slate-500 capitalize">{fmtDiaSemana(s.date)}</span>
              <span className="text-slate-700">{s.shift_type_id ? shiftTypeMap[s.shift_type_id] ?? '?' : '?'}</span>
              <span className="font-medium text-slate-800">{s.staff_id ? staffMap[s.staff_id] ?? '?' : '—'}</span>
              {s.status !== 'scheduled' && (
                <span className="text-xs text-amber-600 uppercase font-bold">{s.status === 'swapped' ? 'trocado' : 'cancelado'}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
