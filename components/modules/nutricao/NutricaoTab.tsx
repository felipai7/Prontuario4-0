'use client'
import { useState, useMemo, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fmtData, diasDesde } from '@/lib/utils'
import type {
  Paciente, NutricaoAvaliacao, NutricaoDia, PeriodoBalanco, SuporteVentilatorio,
  CuidadosHorizontais, AuditoriaIntensivista, ToastData,
} from '@/types'

interface Props {
  paciente: Paciente
  avaliacao: NutricaoAvaliacao | null
  dias: NutricaoDia[]
  /** Só para derivar constipação e diarreia — a nutrição não edita o Balanço. */
  periodosBalanco: PeriodoBalanco[]
  /** Só para derivar dias de VM. */
  ventHistorico: SuporteVentilatorio[]
  /** Só para derivar uso de opioide (estado atual). */
  cuidados: CuidadosHorizontais | null
  /** Auditoria dos Cuidados Horizontais: dá a data em que o opioide foi marcado/desmarcado. */
  auditoria: AuditoriaIntensivista[]
  podeEditar: boolean
  onRefresh: () => void
  showToast: (msg: string, tipo?: ToastData['tipo']) => void
}

/**
 * Última mudança do campo de opioide, com o sentido honesto do dado: o banco
 * guarda quando ALGUÉM MEXEU na caixinha (via auditoria), não quando a droga foi
 * administrada ou suspensa. Por isso "marcado até", não "último uso".
 */
function opioideInfo(cuidados: CuidadosHorizontais | null, auditoria: AuditoriaIntensivista[]): string | null {
  const emUso = cuidados?.opioide_em_uso ?? false

  // Auditoria de cuidados_horizontais em ordem cronológica.
  const audit = auditoria
    .filter(a => a.tabela === 'cuidados_horizontais')
    .sort((a, b) => a.changed_at.localeCompare(b.changed_at))

  // Data da última TRANSIÇÃO do campo (de/para o valor atual).
  let ultimaMudanca: string | null = null
  let anterior: boolean | null = null
  for (const a of audit) {
    const v = (a.dados_novos?.opioide_em_uso ?? null) as boolean | null
    if (v == null) continue
    if (v !== anterior) ultimaMudanca = a.changed_at
    anterior = v
  }

  if (emUso) {
    return ultimaMudanca ? `em uso desde ${fmtData(ultimaMudanca.split('T')[0])}` : 'em uso'
  }
  // Não está em uso: só interessa se houve uso antes, e há quantos dias parou —
  // a constipação por opioide persiste dias depois de suspender.
  if (!ultimaMudanca || anterior !== false) return null
  const dias = Math.floor((Date.now() - new Date(ultimaMudanca).getTime()) / (24 * 3600 * 1000))
  return `marcado até ${fmtData(ultimaMudanca.split('T')[0])} (há ${dias}d)`
}

const hojeISO = () => new Date().toISOString().split('T')[0]

/** Campo de porcentagem: vazio = não recebeu por essa via no dia. */
function Pct({ label, valor, onChange, disabled, dica }: {
  label: string; valor: string; onChange: (v: string) => void; disabled: boolean; dica?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <div className="flex items-center gap-1">
        <input type="number" min="0" max="200" step="1" value={valor} disabled={disabled}
          onChange={e => onChange(e.target.value)} placeholder="—"
          className="w-20 px-2 py-1.5 border border-slate-300 rounded-lg text-sm disabled:opacity-60" />
        <span className="text-xs text-slate-400">%</span>
      </div>
      {dica && <p className="text-[11px] text-slate-400 mt-0.5">{dica}</p>}
    </div>
  )
}

function Fato({ label, valor, tom }: { label: string; valor: string; tom: 'normal' | 'atencao' }) {
  return (
    <div className={`rounded-lg px-2.5 py-2 border ${
      tom === 'atencao' ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'}`}>
      <p className="text-slate-500">{label}</p>
      <p className={`font-semibold mt-0.5 ${tom === 'atencao' ? 'text-amber-800' : 'text-slate-700'}`}>{valor}</p>
    </div>
  )
}

function Check({ label, v, set, disabled, dica }: {
  label: string; v: boolean; set: (b: boolean) => void; disabled: boolean; dica?: string
}) {
  return (
    <div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={v} disabled={disabled}
          onChange={e => set(e.target.checked)}
          className="w-4 h-4 accent-indigo-600 disabled:opacity-50" />
        <span className="text-sm text-slate-700">{label}</span>
      </label>
      {dica && <p className="text-[11px] text-slate-400 ml-6">{dica}</p>}
    </div>
  )
}

export default function NutricaoTab({
  paciente, avaliacao, dias, periodosBalanco, ventHistorico, cuidados, auditoria,
  podeEditar, onRefresh, showToast,
}: Props) {
  const supabase = createClient()
  const [saving, setSaving] = useState(false)

  // ── Painel "o que já sabemos" ───────────────────────────────────────────
  // A nutrição hoje levanta esses quatro dados por fora (perguntando, olhando
  // o prontuário de papel), mesmo já derivando deles. Se ela não vê o que o
  // app já sabe, continua levantando do mesmo jeito e a economia de
  // preenchimento não se paga. Nada aqui é lido do banco de novo — são os
  // mesmos dados que a casca já carregou para Balanço e Ventilatório.
  const emVMHoje = useMemo(
    () => ventHistorico.some(v => v.data === hojeISO() && v.modalidade === 'ventilacao_mecanica'),
    [ventHistorico])

  const balancoOrdenado = useMemo(
    () => [...periodosBalanco].sort((a, b) => b.inicio.localeCompare(a.inicio)), [periodosBalanco])

  const ultimaEvacuacao = useMemo(
    () => balancoOrdenado.find(p => p.evacuacao > 0) ?? null, [balancoOrdenado])

  // Mesmo critério de constipação usado no indicador: 72h sem evacuar. Sem
  // nenhum registro de evacuação ainda, conta a partir da admissão — mas só se
  // já houver balanço lançado (sem isso, "sem evacuar" seria só falta de dado).
  const diasSemEvacuar = ultimaEvacuacao
    ? Math.floor((Date.now() - new Date(ultimaEvacuacao.inicio).getTime()) / (24 * 3600 * 1000))
    : (periodosBalanco.length > 0 ? diasDesde(paciente.data_internacao) : null)
  const constipado = diasSemEvacuar != null && diasSemEvacuar >= 3

  // Diarreia recente: últimos 2 dias, qualquer um dos dois ter marcado sim —
  // mesma regra "conta se qualquer um marcou" da agregação mensal.
  const diarreicaRecente = useMemo(() => {
    const limite = Date.now() - 2 * 24 * 3600 * 1000
    return balancoOrdenado
      .filter(p => new Date(p.inicio).getTime() >= limite)
      .some(p => p.diarreica_medico || p.diarreica_nutricao)
  }, [balancoOrdenado])

  const opioide = useMemo(() => opioideInfo(cuidados, auditoria), [cuidados, auditoria])

  // ── Avaliação inicial ───────────────────────────────────────────────────
  const [avData, setAvData] = useState(avaliacao?.data_avaliacao ?? hojeISO())
  const [avRisco, setAvRisco] = useState(avaliacao?.risco_nutricional ?? false)
  const [avDeficit, setAvDeficit] = useState(avaliacao?.deficit ?? false)

  useEffect(() => {
    setAvData(avaliacao?.data_avaliacao ?? hojeISO())
    setAvRisco(avaliacao?.risco_nutricional ?? false)
    setAvDeficit(avaliacao?.deficit ?? false)
  }, [avaliacao?.id, avaliacao?.criado_em])

  const salvarAvaliacao = async () => {
    setSaving(true)
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('nutricao_avaliacoes').upsert({
      paciente_id: paciente.id, data_avaliacao: avData,
      risco_nutricional: avRisco, deficit: avDeficit,
      criado_por: user.user?.id ?? null,
    }, { onConflict: 'paciente_id' })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Avaliação nutricional salva!')
    onRefresh()
  }

  // ── Registro do dia ─────────────────────────────────────────────────────
  const diaHoje = useMemo(() => dias.find(d => d.data === hojeISO()) ?? null, [dias])
  /** Dia mais recente antes de hoje — a base para herdar. */
  const ultimoAnterior = useMemo(
    () => [...dias].filter(d => d.data < hojeISO()).sort((a, b) => b.data.localeCompare(a.data))[0] ?? null,
    [dias])

  const base = diaHoje ?? ultimoAnterior
  const num = (v: number | null | undefined) => (v == null ? '' : String(v))

  const [elegivelTn, setElegivelTn] = useState(base?.elegivel_tn ?? false)
  const [elegivelNe, setElegivelNe] = useState(base?.elegivel_ne ?? false)
  const [jejum, setJejum] = useState(base?.jejum ?? false)
  const [np, setNp] = useState(num(base?.np_pct_meta))
  const [ne, setNe] = useState(num(base?.ne_pct_meta))
  const [vo, setVo] = useState(num(base?.vo_pct_aceitacao))
  const [proteica, setProteica] = useState(num(base?.proteica_pct))
  const [intolerancia, setIntolerancia] = useState(diaHoje?.intolerancia_gi_grave ?? false)
  const [interrupcao, setInterrupcao] = useState(diaHoje?.interrupcao_nao_justificada ?? false)
  const [round, setRound] = useState(diaHoje?.discutido_round ?? false)
  const [hipoTn, setHipoTn] = useState(diaHoje?.hipoglicemia_relacionada_tn ?? false)

  // Recarrega o formulário quando os dados mudam (ex.: após salvar).
  useEffect(() => {
    const b = dias.find(d => d.data === hojeISO())
      ?? [...dias].filter(d => d.data < hojeISO()).sort((a, b2) => b2.data.localeCompare(a.data))[0]
      ?? null
    const hoje = dias.find(d => d.data === hojeISO()) ?? null
    setElegivelTn(b?.elegivel_tn ?? false)
    setElegivelNe(b?.elegivel_ne ?? false)
    setJejum(b?.jejum ?? false)
    setNp(b?.np_pct_meta == null ? '' : String(b.np_pct_meta))
    setNe(b?.ne_pct_meta == null ? '' : String(b.ne_pct_meta))
    setVo(b?.vo_pct_aceitacao == null ? '' : String(b.vo_pct_aceitacao))
    setProteica(b?.proteica_pct == null ? '' : String(b.proteica_pct))
    // Sintomas NÃO são herdados: intolerância de ontem não é intolerância de
    // hoje. Só via e elegibilidade, que costumam se manter.
    setIntolerancia(hoje?.intolerancia_gi_grave ?? false)
    setInterrupcao(hoje?.interrupcao_nao_justificada ?? false)
    setRound(hoje?.discutido_round ?? false)
    setHipoTn(hoje?.hipoglicemia_relacionada_tn ?? false)
  }, [dias])

  const salvarDia = async () => {
    setSaving(true)
    const n = (s: string) => (s.trim() === '' ? null : parseFloat(s))
    const { data: user } = await supabase.auth.getUser()
    const { error } = await supabase.from('nutricao_dia').upsert({
      paciente_id: paciente.id, data: hojeISO(),
      elegivel_tn: elegivelTn, elegivel_ne: elegivelNe, jejum,
      np_pct_meta: n(np), ne_pct_meta: n(ne), vo_pct_aceitacao: n(vo),
      proteica_pct: n(proteica),
      intolerancia_gi_grave: intolerancia,
      interrupcao_nao_justificada: interrupcao,
      discutido_round: round,
      hipoglicemia_relacionada_tn: hipoTn,
      criado_por: user.user?.id ?? null,
    }, { onConflict: 'paciente_id,data' })
    setSaving(false)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    showToast('Registro do dia salvo!')
    onRefresh()
  }

  const historico = useMemo(
    () => [...dias].sort((a, b) => b.data.localeCompare(a.data)).slice(0, 10), [dias])

  const resumoVias = (d: NutricaoDia) => {
    const p: string[] = []
    if (d.np_pct_meta != null) p.push(`NP ${d.np_pct_meta}%`)
    if (d.ne_pct_meta != null) p.push(`NE ${d.ne_pct_meta}%`)
    if (d.vo_pct_aceitacao != null) p.push(`VO ${d.vo_pct_aceitacao}%`)
    if (d.jejum) p.push('jejum')
    return p.length ? p.join(' · ') : 'sem via registrada'
  }

  return (
    <div className="space-y-4">
      {/* O que já sabemos: dados derivados de outras abas, para a nutrição
          confirmar em vez de levantar de novo por fora do app. */}
      <section className="border border-indigo-100 bg-indigo-50/50 rounded-xl p-4">
        <h3 className="font-semibold text-slate-700 text-sm mb-2">🔎 O que já sabemos</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <Fato
            label="Ventilação mecânica"
            valor={emVMHoje ? 'Em VM hoje' : 'Sem VM hoje'}
            tom={emVMHoje ? 'atencao' : 'normal'} />
          <Fato
            label="Última evacuação"
            valor={ultimaEvacuacao
              ? fmtData(ultimaEvacuacao.inicio.split('T')[0])
              : periodosBalanco.length > 0 ? 'nenhuma desde a admissão' : 'sem balanço lançado'}
            tom="normal" />
          <Fato
            label="Constipação (≥72h)"
            valor={diasSemEvacuar == null ? 'sem dado de balanço' : constipado ? `${diasSemEvacuar}d sem evacuar` : 'não'}
            tom={constipado ? 'atencao' : 'normal'} />
          <Fato
            label="Diarreia (últ. 2 dias)"
            valor={diarreicaRecente ? 'sim' : 'não'}
            tom={diarreicaRecente ? 'atencao' : 'normal'} />
          <Fato
            label="Opioide"
            valor={opioide ?? 'sem registro'}
            tom={opioide ? 'atencao' : 'normal'} />
        </div>

        {/* Cruzamento que o indicador "constipação relacionada a opioides" faz:
            a constipação por opioide persiste dias depois de suspender, então a
            data importa mesmo com o opioide já parado. */}
        {constipado && opioide && (
          <p className="text-xs text-amber-800 bg-amber-100 border border-amber-200 rounded-lg px-3 py-2 mt-2">
            ⚠️ Constipação com opioide ({opioide}). A obstipação por opioide costuma
            persistir dias após a suspensão — considere ao avaliar.
          </p>
        )}

        <p className="text-[11px] text-slate-400 mt-2">
          Vem das abas Ventilatório, Balanço Hídrico e Cuidados Horizontais. A data do
          opioide é a de <strong>marcação</strong> nos Cuidados Horizontais, não a da
          administração — confira antes de concluir.
        </p>
      </section>

      {/* Avaliação inicial */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-slate-700">🥗 Avaliação nutricional</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {avaliacao
              ? `Avaliado em ${fmtData(avaliacao.data_avaliacao)}`
              : 'Ainda não avaliado — o indicador cobra avaliação em até 24h da admissão.'}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Data da avaliação</label>
            <input type="date" value={avData} max={hojeISO()} disabled={!podeEditar}
              onChange={e => setAvData(e.target.value)}
              className="px-3 py-2 border border-slate-300 rounded-lg text-sm disabled:opacity-60" />
          </div>
          <div className="space-y-1.5">
            <Check label="Risco nutricional" v={avRisco} set={setAvRisco} disabled={!podeEditar} />
            <Check label="Déficit nutricional" v={avDeficit} set={setAvDeficit} disabled={!podeEditar} />
          </div>
        </div>
        {podeEditar && (
          <button onClick={salvarAvaliacao} disabled={saving}
            className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-lg text-sm">
            {saving ? 'Salvando...' : avaliacao ? '💾 Atualizar avaliação' : '💾 Registrar avaliação'}
          </button>
        )}
      </section>

      {/* Registro de hoje */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-3">
        <div>
          <h3 className="font-semibold text-slate-700">📅 Registro de hoje</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {diaHoje
              ? 'Já registrado hoje — alterar sobrescreve.'
              : ultimoAnterior
                ? `Campos herdados do último registro (${fmtData(ultimoAnterior.data)}). Ajuste o que mudou.`
                : 'Primeiro registro deste paciente.'}
          </p>
        </div>

        <div className="space-y-1.5">
          <Check label="Elegível para terapia nutricional hoje" v={elegivelTn} set={setElegivelTn}
            disabled={!podeEditar}
            dica="Julgamento da nutrição, avaliado a cada dia." />
          <Check label="Elegível para nutrição enteral hoje" v={elegivelNe} set={setElegivelNe} disabled={!podeEditar} />
          <Check label="Em jejum" v={jejum} set={setJejum} disabled={!podeEditar} />
        </div>

        <div className="flex flex-wrap gap-4">
          <Pct label="NP — % da meta" valor={np} onChange={setNp} disabled={!podeEditar} />
          <Pct label="NE — % da meta" valor={ne} onChange={setNe} disabled={!podeEditar} />
          <Pct label="VO — % de aceitação" valor={vo} onChange={setVo} disabled={!podeEditar} />
          <Pct label="Meta proteica — %" valor={proteica} onChange={setProteica} disabled={!podeEditar} />
        </div>
        <p className="text-[11px] text-slate-400">
          Deixe vazio a via que o paciente não recebeu. Mais de uma via pode ser preenchida
          no mesmo dia.
        </p>

        <div className="space-y-1.5 border-t border-slate-100 pt-3">
          <Check label="Intolerância GI grave" v={intolerancia} set={setIntolerancia} disabled={!podeEditar} />
          <Check label="Interrupção não justificada da TN" v={interrupcao} set={setInterrupcao} disabled={!podeEditar} />
          <Check label="Hipoglicemia relacionada à terapia nutricional" v={hipoTn} set={setHipoTn} disabled={!podeEditar} />
          <Check label="Discutido no round de hoje" v={round} set={setRound} disabled={!podeEditar} />
        </div>

        {podeEditar && (
          <button onClick={salvarDia} disabled={saving}
            className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold py-2.5 rounded-lg text-sm">
            {saving ? 'Salvando...' : '💾 Salvar registro de hoje'}
          </button>
        )}
      </section>

      {/* Histórico */}
      <section className="border border-slate-200 rounded-xl p-4 space-y-2">
        <h3 className="font-semibold text-slate-700 text-sm">Últimos dias ({dias.length})</h3>
        {historico.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-3">Nenhum registro</p>
        ) : (
          <ul className="space-y-1">
            {historico.map(d => (
              <li key={d.id} className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                <span className="font-medium text-slate-600">{fmtData(d.data)}</span>
                <span className="text-slate-500"> · {resumoVias(d)}</span>
                {d.proteica_pct != null && <span className="text-slate-400"> · proteica {d.proteica_pct}%</span>}
                {d.intolerancia_gi_grave && <span className="text-amber-600"> · intolerância GI</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
