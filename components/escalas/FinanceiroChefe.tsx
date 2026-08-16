'use client'
import { useState, useEffect, useMemo } from 'react'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/client'
import type { Shift, ShiftPayment, ShiftType, Staff, ToastData } from '@/types'

interface Props {
  unitId: string
  staffList: Staff[]
  shiftTypesList: ShiftType[]
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

type PagamentoComPlantao = ShiftPayment & { shift: Shift }

function primeiroDiaMes(ref: Date): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-01`
}
function fmtMesAno(ref: Date): string {
  return ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
function fmtData(d: string): string {
  return new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtValor(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function FinanceiroChefe({ unitId, staffList, shiftTypesList, showToast }: Props) {
  const supabase = createClient()
  const [ref, setRef] = useState(() => { const d = new Date(); d.setDate(1); return d })
  const [pagamentos, setPagamentos] = useState<PagamentoComPlantao[]>([])
  const [loading, setLoading] = useState(false)
  const [marcandoId, setMarcandoId] = useState<string | null>(null)

  const staffMap = useMemo(() => Object.fromEntries(staffList.map(s => [s.id, s.full_name])), [staffList])
  const shiftTypeMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.name])), [shiftTypesList])
  // Desempate diurno/noturno dentro do mesmo dia pelo horário de início do
  // tipo de turno — mesmo ajuste de ComparativoView.tsx.
  const shiftTypeStartMap = useMemo(() => Object.fromEntries(shiftTypesList.map(t => [t.id, t.start_time])), [shiftTypesList])

  const load = async () => {
    if (!unitId) { setPagamentos([]); return }
    setLoading(true)
    const mesInicio = primeiroDiaMes(ref)
    const proxMes = new Date(ref.getFullYear(), ref.getMonth() + 1, 1)
    const mesFim = primeiroDiaMes(proxMes)

    const { data, error } = await supabase
      .from('shift_payments')
      .select('*, shift:shifts!inner(*)')
      .eq('shift.unit_id', unitId)
      .gte('shift.date', mesInicio)
      .lt('shift.date', mesFim)
    setLoading(false)
    if (error) { showToast('Erro ao carregar pagamentos: ' + error.message, 'error'); return }
    const lista = ((data as unknown as PagamentoComPlantao[]) ?? []).sort((a, b) => {
      if (a.shift.date !== b.shift.date) return a.shift.date.localeCompare(b.shift.date)
      const sa = a.shift.shift_type_id ? shiftTypeStartMap[a.shift.shift_type_id] ?? '' : ''
      const sb = b.shift.shift_type_id ? shiftTypeStartMap[b.shift.shift_type_id] ?? '' : ''
      return sa.localeCompare(sb)
    })
    setPagamentos(lista)
  }

  useEffect(() => { load() }, [unitId, ref])

  // Agrupamento por plantonista: alimenta o resumo na tela e o relatório
  // impresso. Um pagamento sem staff_id (plantão sem ninguém atribuído,
  // caso raro) cai num grupo "Sem profissional" em vez de sumir da conta.
  type GrupoPlantonista = {
    staffId: string; nome: string; pagamentos: PagamentoComPlantao[]
    total: number; totalPago: number; totalPendente: number
  }
  const totaisPorPlantonista: GrupoPlantonista[] = useMemo(() => {
    const grupos = new Map<string, GrupoPlantonista>()
    for (const p of pagamentos) {
      const staffId = p.shift.staff_id ?? '—'
      const nome = p.shift.staff_id ? (staffMap[p.shift.staff_id] ?? '?') : 'Sem profissional'
      if (!grupos.has(staffId)) grupos.set(staffId, { staffId, nome, pagamentos: [], total: 0, totalPago: 0, totalPendente: 0 })
      const g = grupos.get(staffId)!
      g.pagamentos.push(p)
      g.total += p.payment_value
      if (p.payment_status === 'paid') g.totalPago += p.payment_value
      else g.totalPendente += p.payment_value
    }
    return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  }, [pagamentos, staffMap])

  // Pagamento é marcado por plantonista, não plantão a plantão: um clique
  // atualiza TODOS os plantões daquele profissional no mês de uma vez — reflete
  // como o chefe paga de verdade (um valor por pessoa no fim do mês, não por
  // turno individual). Já totalmente pago desmarca tudo pra pendente de novo.
  const handleMarcarGrupoPago = async (g: GrupoPlantonista) => {
    setMarcandoId(g.staffId)
    const proximoStatus = g.totalPendente === 0 ? 'pending' : 'paid'
    const shiftIds = g.pagamentos.map(p => p.shift_id)
    const { error } = await supabase.from('shift_payments').update({
      payment_status: proximoStatus, paid_at: proximoStatus === 'paid' ? new Date().toISOString() : null,
    }).in('shift_id', shiftIds)
    setMarcandoId(null)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    load()
  }

  const handleGerarRelatorio = () => {
    const win = window.open('', '_blank', 'width=850,height=700')
    if (!win) return
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const total = pagamentos.reduce((acc, p) => acc + p.payment_value, 0)
    const totalPago = pagamentos.filter(p => p.payment_status === 'paid').reduce((acc, p) => acc + p.payment_value, 0)

    const secoes = totaisPorPlantonista.map(g => `
      <h3>${esc(g.nome)}</h3>
      <table>
        <thead><tr><th>Data</th><th>Turno</th><th>Valor</th><th>Status</th></tr></thead>
        <tbody>
          ${g.pagamentos.map(p => `<tr>
            <td>${fmtData(p.shift.date)}</td>
            <td>${esc(p.shift.shift_type_id ? shiftTypeMap[p.shift.shift_type_id] ?? '?' : '?')}</td>
            <td>${fmtValor(p.payment_value)}</td>
            <td>${p.payment_status === 'paid' ? 'Pago' : 'Pendente'}</td>
          </tr>`).join('')}
        </tbody>
        <tfoot>
          <tr><td colspan="2">Subtotal — ${esc(g.nome)}</td><td>${fmtValor(g.total)}</td><td></td></tr>
        </tfoot>
      </table>
    `).join('')

    const conclusao = totaisPorPlantonista.map(g => `
      <tr>
        <td>${esc(g.nome)}</td><td>${g.pagamentos.length}</td>
        <td class="total">${fmtValor(g.total)}</td>
        <td>${fmtValor(g.totalPago)}</td>
        <td>${fmtValor(g.totalPendente)}</td>
      </tr>
    `).join('')

    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
      <title>Relatório de pagamentos — ${esc(fmtMesAno(ref))}</title>
      <style>
        body{font-family:Arial,sans-serif;font-size:12px;padding:20mm 15mm;color:#000;}
        h1{font-size:18px;margin:0 0 2px;}
        h2{font-size:13px;font-weight:normal;color:#555;margin:0 0 16px;}
        h3{font-size:13px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:2px;}
        table{width:100%;border-collapse:collapse;margin-bottom:4px;}
        th,td{text-align:left;padding:3px 6px;border-bottom:1px solid #eee;}
        th{font-size:11px;color:#555;}
        tfoot td{font-weight:bold;border-top:1px solid #999;border-bottom:none;padding-top:4px;}
        .conclusao{margin-top:28px;border-top:2px solid #000;padding-top:10px;}
        .conclusao table{margin-top:6px;}
        .conclusao td.total{font-weight:bold;}
        .grand-total{margin-top:10px;font-size:14px;font-weight:bold;text-align:right;}
        @media print { h3 { page-break-after: avoid; } table { page-break-inside: avoid; } }
      </style></head><body>
      <h1>Relatório de pagamentos</h1>
      <h2>${esc(fmtMesAno(ref))} — gerado em ${new Date().toLocaleString('pt-BR')}</h2>
      ${secoes}
      <div class="conclusao">
        <strong>Conclusão — total por plantonista</strong>
        <table>
          <thead><tr><th>Plantonista</th><th>Plantões</th><th>Total</th><th>Pago</th><th>Pendente</th></tr></thead>
          <tbody>${conclusao}</tbody>
        </table>
        <p class="grand-total">Total geral do mês: ${fmtValor(total)} — já pago: ${fmtValor(totalPago)}</p>
      </div>
      <script>window.onload=function(){setTimeout(function(){window.print();},400);};<\/script>
      </body></html>`)
    win.document.close()
  }

  const [gerandoExcel, setGerandoExcel] = useState(false)

  // Mesma estrutura do relatório impresso (handleGerarRelatorio) — seções por
  // plantonista com subtotal, depois a conclusão — só que como planilha de
  // verdade: cabeçalho em negrito, cores e subtotais já formatados, em vez do
  // CSV plano que só listava linha a linha sem nenhuma organização visual.
  const CORES = {
    titulo: 'FF3730A3', faixaGrupo: 'FFEEF2FF', headerTabela: 'FFF1F5F9',
    subtotal: 'FFE0E7FF', conclusaoHeader: 'FF3730A3', linhaBorda: 'FFE2E8F0',
  }
  const handleExportarExcel = async () => {
    setGerandoExcel(true)
    const wb = new ExcelJS.Workbook()
    wb.creator = 'ProMed UTI'
    wb.created = new Date()
    const ws = wb.addWorksheet('Financeiro', { views: [{ showGridLines: false }] })
    ws.columns = [
      { key: 'a', width: 14 }, { key: 'b', width: 26 }, { key: 'c', width: 16 },
      { key: 'd', width: 14 }, { key: 'e', width: 14 },
    ]

    const linhaBorda = { top: { style: 'thin' as const, color: { argb: CORES.linhaBorda } } }
    const moeda = '"R$" #,##0.00'

    const titulo = ws.addRow(['Relatório de pagamentos'])
    titulo.getCell(1).font = { bold: true, size: 16, color: { argb: CORES.titulo } }
    ws.mergeCells(titulo.number, 1, titulo.number, 5)

    const subtitulo = ws.addRow([`${fmtMesAno(ref)} — gerado em ${new Date().toLocaleString('pt-BR')}`])
    subtitulo.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF64748B' } }
    ws.mergeCells(subtitulo.number, 1, subtitulo.number, 5)
    ws.addRow([])

    for (const g of totaisPorPlantonista) {
      const cabecalhoGrupo = ws.addRow([g.nome])
      cabecalhoGrupo.font = { bold: true, size: 12 }
      cabecalhoGrupo.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.faixaGrupo } } })
      ws.mergeCells(cabecalhoGrupo.number, 1, cabecalhoGrupo.number, 5)

      const header = ws.addRow(['Data', 'Turno', '', 'Valor', 'Status'])
      header.font = { bold: true, size: 10, color: { argb: 'FF475569' } }
      header.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.headerTabela } } })

      for (const p of g.pagamentos) {
        const linha = ws.addRow([
          fmtData(p.shift.date),
          p.shift.shift_type_id ? shiftTypeMap[p.shift.shift_type_id] ?? '?' : '?',
          '',
          p.payment_value,
          p.payment_status === 'paid' ? 'Pago' : 'Pendente',
        ])
        linha.getCell(4).numFmt = moeda
      }

      const subtotal = ws.addRow(['', `Subtotal — ${g.nome}`, '', g.total, ''])
      subtotal.font = { bold: true }
      subtotal.getCell(4).numFmt = moeda
      subtotal.eachCell(c => { c.border = linhaBorda })
      ws.addRow([])
    }

    ws.addRow([])
    const conclusaoTitulo = ws.addRow(['Conclusão — total por plantonista'])
    conclusaoTitulo.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } }
    conclusaoTitulo.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.conclusaoHeader } } })
    ws.mergeCells(conclusaoTitulo.number, 1, conclusaoTitulo.number, 5)

    const conclusaoHeader = ws.addRow(['Plantonista', '', 'Plantões', 'Total', 'Pago / Pendente'])
    conclusaoHeader.font = { bold: true, size: 10, color: { argb: 'FF475569' } }
    conclusaoHeader.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.headerTabela } } })

    for (const g of totaisPorPlantonista) {
      const linha = ws.addRow([g.nome, '', g.pagamentos.length, g.total, `${fmtValor(g.totalPago)} / ${fmtValor(g.totalPendente)}`])
      linha.getCell(4).numFmt = moeda
    }

    const linhaTotal = ws.addRow(['Total geral do mês', '', pagamentos.length, total, `Já pago: ${fmtValor(totalPago)}`])
    linhaTotal.font = { bold: true, size: 12 }
    linhaTotal.getCell(4).numFmt = moeda
    linhaTotal.eachCell(c => {
      c.border = { top: { style: 'medium' as const, color: { argb: 'FF1E293B' } } }
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: CORES.subtotal } }
    })

    const buffer = await wb.xlsx.writeBuffer()
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `financeiro_${primeiroDiaMes(ref)}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    setGerandoExcel(false)
  }

  const total = pagamentos.reduce((acc, p) => acc + p.payment_value, 0)
  const totalPago = pagamentos.filter(p => p.payment_status === 'paid').reduce((acc, p) => acc + p.payment_value, 0)

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="font-semibold text-slate-700">💰 Financeiro (chefe)</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">←</button>
          <span className="text-sm font-medium text-slate-700 capitalize min-w-[9rem] text-center">{fmtMesAno(ref)}</span>
          <button onClick={() => setRef(new Date(ref.getFullYear(), ref.getMonth() + 1, 1))}
            className="text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1 text-sm">→</button>
          {pagamentos.length > 0 && (
            <>
              <button onClick={handleGerarRelatorio}
                className="text-xs font-medium text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1.5">
                📄 Relatório
              </button>
              <button onClick={handleExportarExcel} disabled={gerandoExcel}
                className="text-xs font-medium text-slate-500 hover:text-indigo-600 disabled:opacity-50 border border-slate-200 rounded-lg px-2 py-1.5">
                {gerandoExcel ? 'Gerando...' : '⬇️ Excel'}
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Carregando...</p>
      ) : pagamentos.length === 0 ? (
        <p className="text-sm text-slate-400">Nenhum plantão publicado com pagamento neste mês.</p>
      ) : (
        <>
          {/* Pagamento é marcado por plantonista aqui — um botão só por linha,
              cobrindo todos os plantões dele no mês. A lista cronológica
              abaixo é só conferência, sem ação própria. */}
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs text-slate-500">
                  <th className="text-left px-3 py-1.5 font-semibold">Plantonista</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Plantões</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Total</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Pago</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Pendente</th>
                  <th className="text-right px-3 py-1.5 font-semibold">Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {totaisPorPlantonista.map(g => (
                  <tr key={g.staffId} className="border-t border-slate-100">
                    <td className="px-3 py-1.5 text-slate-700">{g.nome}</td>
                    <td className="px-3 py-1.5 text-right text-slate-500">{g.pagamentos.length}</td>
                    <td className="px-3 py-1.5 text-right font-semibold text-slate-800">{fmtValor(g.total)}</td>
                    <td className="px-3 py-1.5 text-right text-emerald-700">{fmtValor(g.totalPago)}</td>
                    <td className="px-3 py-1.5 text-right text-amber-700">{fmtValor(g.totalPendente)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button onClick={() => handleMarcarGrupoPago(g)} disabled={marcandoId === g.staffId || g.staffId === '—'}
                        className={`text-xs font-bold px-2 py-1 rounded-full transition-colors disabled:opacity-50 ${
                          g.totalPendente === 0 ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                        }`}>
                        {g.totalPendente === 0 ? 'Pago' : 'Marcar como pago'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-1.5 max-h-96 overflow-y-auto">
            {pagamentos.map(p => (
              <li key={p.shift_id} className="flex items-center justify-between gap-2 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-500 flex-shrink-0">{fmtData(p.shift.date)}</span>
                <span className="text-slate-700 flex-1 min-w-0 truncate">{p.shift.staff_id ? staffMap[p.shift.staff_id] ?? '?' : '—'}</span>
                <span className="text-slate-500 flex-shrink-0">{p.shift.shift_type_id ? shiftTypeMap[p.shift.shift_type_id] ?? '?' : '?'}</span>
                <span className="font-medium text-slate-800 flex-shrink-0">{fmtValor(p.payment_value)}</span>
                <span className={`text-xs font-bold px-2 py-1 rounded-full flex-shrink-0 ${
                  p.payment_status === 'paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {p.payment_status === 'paid' ? 'Pago' : 'Pendente'}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-4 text-sm pt-2 border-t border-slate-200">
            <span className="text-slate-500">Total do mês: <strong className="text-slate-800">{fmtValor(total)}</strong></span>
            <span className="text-slate-500">Já pago: <strong className="text-emerald-700">{fmtValor(totalPago)}</strong></span>
          </div>
        </>
      )}
    </section>
  )
}
