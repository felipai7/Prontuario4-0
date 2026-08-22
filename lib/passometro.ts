import type { SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { Ala, Unidade } from '@/lib/unidade'
import { compararLeitos } from '@/lib/unidade'
import { calcAge, diaAtualATB, calcDiurese24h, balancoDaUnidade, hojeISO, ultimoPorTurno } from '@/lib/utils'
import { parseExameTimestamp } from '@/lib/exames/agrupamento'
import type {
  Paciente, ATB, DVA, CuidadosHorizontais, Dispositivo, PeriodoBalanco,
  SinalVital, Exame, PendenciaIntensivista, RegistroIntensivista, SuporteVentilatorio,
} from '@/types'

// Os marcadores do passômetro batem 1:1 com o catálogo de analitos usado na
// extração de exames (lib/exames/extracao/catalogo/analitos.json) — o mesmo
// id que a IA reconhece no laudo é o que buscamos aqui. Vários têm variantes
// por origem no catálogo (soro/arterial/venoso): Na, K e Ca iônico já tinham
// isso mapeado, mas pH, HCO3 (Bic), pCO2, pO2 e Lactato NÃO tinham — só
// `.serum` estava listado, e gasometria nunca grava nesse id (grava
// `.art`/`.ven`), daí a coluna de exames nunca mostrar gasometria nenhuma.
// Corrigido incluindo as 3 variantes onde o catálogo as tem.
const ANALITOS_LABS: { key: string; label: string; serum?: string; art?: string; ven?: string }[] = [
  { key: 'hb', label: 'Hb', serum: 'hemoglobina.serum' },
  { key: 'ht', label: 'Ht', serum: 'hematocrito.serum' },
  { key: 'leuco', label: 'Leuco', serum: 'leucocitos.serum' },
  { key: 'plaq', label: 'Plaq', serum: 'plaquetas.serum' },
  { key: 'pcr', label: 'PCR', serum: 'pcr.serum' },
  { key: 'lactato', label: 'Lactato', serum: 'lactato.serum', art: 'lactato.art', ven: 'lactato.ven' },
  { key: 'ureia', label: 'Ureia', serum: 'ureia.serum' },
  { key: 'creat', label: 'Creat', serum: 'creatinina.serum' },
  { key: 'na', label: 'Na', serum: 'sodio.serum', art: 'sodio.art', ven: 'sodio.ven' },
  { key: 'k', label: 'K', serum: 'potassio.serum', art: 'potassio.art', ven: 'potassio.ven' },
  { key: 'mg', label: 'Mg', serum: 'magnesio.serum' },
  { key: 'ph', label: 'pH', serum: 'ph.serum', art: 'ph.art', ven: 'ph.ven' },
  { key: 'bic', label: 'Bic', serum: 'hco3.serum', art: 'hco3.art', ven: 'hco3.ven' },
  { key: 'pco2', label: 'pCO2', serum: 'pco2.serum', art: 'pco2.art', ven: 'pco2.ven' },
  { key: 'po2', label: 'pO2', serum: 'po2.serum', art: 'po2.art', ven: 'po2.ven' },
  { key: 'ca', label: 'Ca', serum: 'calcio.ionico.serum', art: 'calcio.ionico.art', ven: 'calcio.ionico.ven' },
]

export interface LinhaPassometro {
  alaId: string
  /** Leito sem paciente ativo — mostra só o código do leito, o resto em
   *  branco (pedido do Felipe: "gere as linhas dos leitos vazios também"). */
  vazio: boolean
  leito: string
  nome: string
  idade: string
  admissao: string
  hd: string
  peso: string
  diurese: string
  /** SVD/Cistostomia se houver o dispositivo ativo; "Espontânea" quando
   *  nenhum dos dois está marcado. */
  viaDiurese: string
  acesso: string
  hgt: string
  /** Mín–máx das últimas 24h (não uma aferição isolada). */
  temp: string
  /** Da aba de Ventilatório (registro mais recente) — "A.A.", "C.N. 2 L/min",
   *  "MNR 10 L/min", "VM TOT" etc. Vazio quando não há registro ainda. */
  respiracao: string
  /** Bloco de 3 linhas, já com "Máx/Méd/Mín" embutido (ex.:
   *  "FC Máx: 98\nFC Méd: 85\nFC Mín: 72") — substitui a antiga classificação
   *  por seta ("↑ taquicárdico" etc.), pedido do Felipe: números direto. */
  fcResumo: string
  /** PAS e PAD combinados numa única linha por posição ("150x82"), cada
   *  componente resumido de forma independente — ver blocoPA(). */
  paResumo: string
  evac: string
  /** >= 3 dias sem evacuar (ou nunca desde a admissão, se já faz 3+ dias) —
   *  destaca a célula em vermelho no Excel. */
  evacConstipado: boolean
  antimicrobiano: string
  dva: string
  corticoide: string
  /** IBP e anticoagulante ficam em campos separados porque ocupam duas linhas
   *  distintas na mesma célula, exatamente como no papel: "linha de cima me
   *  fala sobre IBP... a de baixo sobre anticoagulantes". */
  ibp: string
  anticoag: string
  /** Negrito na linha de anticoagulante quando é terapêutico (não profilático). */
  anticoagTerapeutico: boolean
  labs: Record<string, string>
  pendencias: string
  previsaoAlta: string
  /** Destaca "Hoje!" abaixo da data quando a previsão cai no dia da geração. */
  previsaoAltaHoje: boolean
}

export interface SecaoPassometro {
  ala: Ala
  linhas: LinhaPassometro[]
}

function porPacienteId<T extends { paciente_id: string }>(linhas: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>()
  for (const l of linhas) {
    const grupo = mapa.get(l.paciente_id)
    if (grupo) grupo.push(l); else mapa.set(l.paciente_id, [l])
  }
  return mapa
}

/**
 * Exame mais recente primeiro — por data de coleta; sem data, usa o upload.
 * `data_exame` é texto livre "DD/MM/AAAA" (ou com HH:MM) — `new Date()` direto
 * nele interpretava como MM/DD (formato americano), embaralhando dia e mês ou
 * retornando Invalid Date em qualquer dia > 12, e fazia o "mais recente"
 * escolhido aqui — inclusive nas colunas de exames do passômetro — não ser o
 * de fato mais recente. `parseExameTimestamp` é o mesmo parser já usado (e já
 * correto) na aba de Exames Laboratoriais.
 */
export function ordenarExamesRecentes(exames: Exame[]): Exame[] {
  return [...exames].sort((a, b) => parseExameTimestamp(b) - parseExameTimestamp(a))
}

/**
 * Só o valor, sem unidade (mmol, mg/dL...) — a coluna já deixa claro o que é
 * cada marcador (rótulo impresso), a unidade só ocupava espaço à toa.
 *
 * Dentro do exame mais recente que tiver QUALQUER uma das variantes, prioriza
 * arterial > venosa > soro — pedido do Felipe: "caso tenha gasometria venosa
 * e arterial, exiba os dados apenas da arterial; caso tenha apenas uma das
 * duas, exiba daquela que existe". Soro entra como 3º critério pros
 * marcadores que também podem vir de bioquímica comum (Na/K/Ca), não só de
 * gasometria.
 */
export function valorLabsMaisRecente(examesOrdenados: Exame[], variantes: { serum?: string; art?: string; ven?: string }): string {
  for (const exame of examesOrdenados) {
    const porId = new Map((exame.resultados ?? []).map(r => [r.analito_id, r.valor]))
    if (variantes.art && porId.has(variantes.art)) return porId.get(variantes.art)!
    if (variantes.ven && porId.has(variantes.ven)) return porId.get(variantes.ven)!
    if (variantes.serum && porId.has(variantes.serum)) return porId.get(variantes.serum)!
  }
  return ''
}

/** "2026-08-16" -> "16/08" — ano e hora não importam pro passômetro do dia,
 *  só atrapalham a leitura rápida (vale pra admissão e previsão de alta). */
function dataCurta(dataISO: string): string {
  const [, mes, dia] = dataISO.split('-')
  return `${dia}/${mes}`
}

const JANELA_24H_MS = 24 * 3_600_000

/** Só as aferições dentro das últimas 24h — usado por Temp./FC/PAS/PAD, que
 *  agora mostram a faixa do dia, não uma aferição isolada. */
function sinaisUltimas24h(sinais: SinalVital[]): SinalVital[] {
  const limite = Date.now() - JANELA_24H_MS
  return sinais.filter(s => new Date(s.horario).getTime() >= limite)
}

function fmtDecimal(v: number): string {
  return v.toFixed(1).replace('.', ',')
}

/** "36,1–37,8" (ou só "36,5" se só houve 1 aferição); "" sem nenhuma. */
export function faixaMinMax(valores: number[]): string {
  if (valores.length === 0) return ''
  const min = Math.min(...valores), max = Math.max(...valores)
  return min === max ? fmtDecimal(min) : `${fmtDecimal(min)}–${fmtDecimal(max)}`
}

/**
 * Bloco de 3 linhas pra um vital (hoje só FC — PAS/PAD usam blocoPA) —
 * sempre as 3 (máx, méd, mín), mesmo quando todas as aferições deram o
 * mesmo valor: o pedido foi "3 linhas... uma pra cada min, med, max", um
 * formato fixo, não um resumo que colapsa.
 */
export function blocoVital(nome: string, valores: number[]): string {
  if (valores.length === 0) return ''
  const min = Math.min(...valores), max = Math.max(...valores)
  const med = Math.round(valores.reduce((a, b) => a + b, 0) / valores.length)
  return `${nome} Máx: ${max}\n${nome} Méd: ${med}\n${nome} Mín: ${min}`
}

/**
 * PAS e PAD combinados numa única linha por posição ("150x82"), 3 linhas
 * (Máx/Méd/Mín) em vez dos 6 de dois blocos separados — poluía demais.
 * Cada componente é resumido de forma INDEPENDENTE (a maior PAS entre as
 * aferições x a maior PAD entre as aferições, não necessariamente da mesma
 * aferição) — pedido explícito: "junte a menor PAS com a menor PAD e a
 * maior PAS com a maior PAD... como se a maior aferição de PA fosse
 * aquela". Ex.: aferições 150x70, 140x80, 142x82 → Máx 150x82, Mín 140x70,
 * Méd = média das sistólicas x média das diastólicas.
 */
export function blocoPA(pasValores: number[], padValores: number[]): string {
  if (pasValores.length === 0 && padValores.length === 0) return ''
  const resumo = (valores: number[]) => valores.length === 0 ? null : {
    max: Math.max(...valores),
    min: Math.min(...valores),
    med: Math.round(valores.reduce((a, b) => a + b, 0) / valores.length),
  }
  const pas = resumo(pasValores)
  const pad = resumo(padValores)
  const par = (a: number | undefined, b: number | undefined) =>
    a != null && b != null ? `${a}x${b}` : a != null ? `${a}` : b != null ? `x${b}` : '—'
  return `PA Máx: ${par(pas?.max, pad?.max)}\nPA Méd: ${par(pas?.med, pad?.med)}\nPA Mín: ${par(pas?.min, pad?.min)}`
}

const DIAS_CONSTIPACAO = 3
/** Cada episódio de evacuação lançado no Balanço equivale a 200mL — o campo
 *  Evacuação guarda volume, não contagem; dividir por isso é o que dá o
 *  número de episódios do dia. */
const ML_POR_EPISODIO_EVACUACAO = 200

/**
 * Quantas vezes (episódios) e em que dia o paciente evacuou pela última
 * vez — soma por DIA (um período diurno + um noturno do mesmo dia contam
 * juntos), marca diarreica se algum período daquele dia foi flagado, e
 * sinaliza constipação (>= 3 dias sem evacuar, contando da admissão se nunca
 * evacuou) pro destaque visual na planilha.
 *
 * Débito de ostomia conta como evacuação pra todos esses efeitos (quem tem
 * ostomia não evacua pelo reto) — mas, diferente do campo Evacuação, o
 * volume da ostomia É mostrado (não convertido em episódios): o pedido foi
 * "mostrar o volume apenas quando for proveniente de ostomia".
 */
export function ultimaEvacuacao(periodos: PeriodoBalanco[], dataInternacao: string): { texto: string; constipado: boolean } {
  const porDia = new Map<string, { episodios: number; volumeOstomia: number; diarreica: boolean; data: Date }>()
  for (const p of periodos) {
    const data = new Date(p.inicio)
    const chave = data.toDateString()
    const atual = porDia.get(chave) ?? { episodios: 0, volumeOstomia: 0, diarreica: false, data }
    if (p.evacuacao > 0) atual.episodios += Math.round(p.evacuacao / ML_POR_EPISODIO_EVACUACAO)
    if (p.ostomia > 0) atual.volumeOstomia += p.ostomia
    if (p.diarreica_medico || p.diarreica_nutricao) atual.diarreica = true
    porDia.set(chave, atual)
  }
  const diasComEvac = [...porDia.values()]
    .filter(d => d.episodios > 0 || d.volumeOstomia > 0)
    .sort((a, b) => b.data.getTime() - a.data.getTime())
  const diasDesde = (data: Date) => Math.floor((Date.now() - data.getTime()) / 86400000)

  if (diasComEvac.length === 0) {
    const desde = diasDesde(new Date(dataInternacao + 'T00:00:00'))
    return { texto: 'Não desde admissão', constipado: desde >= DIAS_CONSTIPACAO }
  }
  const ultimo = diasComEvac[0]
  // Formata pela data LOCAL do Date (não toISOString, que é UTC e pode
  // virar o dia perto da meia-noite num fuso atrás de UTC como o nosso).
  const dataLocal = `${String(ultimo.data.getDate()).padStart(2, '0')}/${String(ultimo.data.getMonth() + 1).padStart(2, '0')}`
  const partes: string[] = []
  if (ultimo.episodios > 0) partes.push(`${ultimo.episodios}x`)
  if (ultimo.volumeOstomia > 0) partes.push(`${ultimo.volumeOstomia}mL (ostomia)`)
  const texto = `${partes.join(' + ')} ${dataLocal}${ultimo.diarreica ? ' - diarreica' : ''}`
  return { texto, constipado: diasDesde(ultimo.data) >= DIAS_CONSTIPACAO }
}

// "1x/dia" não aparece (é o padrão, não precisa dizer) — qualquer outra
// frequência aparece, abreviada quando possível ("2x/dia" -> "2x").
function frequenciaDestaque(frequencia: string | null): string {
  if (!frequencia) return ''
  const norm = frequencia.trim()
  if (norm === '' || norm === '1x/dia') return ''
  const match = /^(\d+)x\/dia$/i.exec(norm)
  return match ? `${match[1]}x` : norm
}

const VIA_ABREVIADA: Record<string, string> = { Enteral: 'VO', Endovenoso: 'EV', Subcutâneo: 'SC' }

/** "Pant 40mg VO" ou "Pant 40mg EV 2x" — a única droga que a aba de Cuidados
 *  Horizontais permite pra IBP hoje é Pantoprazol (não há campo de escolha
 *  de droga), daí "Pant" fixo. */
export function formatarIbp(cuidados: CuidadosHorizontais | null): string {
  if (!cuidados?.ibp_em_uso) return ''
  const via = cuidados.ibp_via ? (VIA_ABREVIADA[cuidados.ibp_via] ?? cuidados.ibp_via) : ''
  const dose = cuidados.ibp_dose_valor != null ? `${cuidados.ibp_dose_valor}${cuidados.ibp_dose_unidade ?? ''}` : ''
  const freq = frequenciaDestaque(cuidados.ibp_frequencia)
  return ['Pant', dose, via, freq].filter(Boolean).join(' ')
}

const DROGA_ANTICOAG_ABREVIADA: Record<string, string> = {
  'Enoxaparina': 'Enoxa',
  'Heparina Não Fracionada': 'HNF',
  'Apixabana': 'Apixa',
  'Rivaroxabana': 'Rivaroxa',
}

/** "Enoxa 40mg" ou "Rivaroxa 2,5mg 2x" — negrito (via `anticoagTerapeutico`
 *  em LinhaPassometro) fica a cargo de quem monta a coluna, não deste texto. */
export function formatarAnticoag(cuidados: CuidadosHorizontais | null): string {
  if (!cuidados?.anticoag_em_uso) return ''
  const drogaBase = cuidados.anticoag_droga === 'Outro'
    ? (cuidados.anticoag_droga_outro ?? 'Outro')
    : (cuidados.anticoag_droga ?? '')
  const droga = DROGA_ANTICOAG_ABREVIADA[drogaBase] ?? drogaBase
  const dose = cuidados.anticoag_dose_valor != null ? `${cuidados.anticoag_dose_valor}${cuidados.anticoag_dose_unidade ?? ''}` : ''
  const freq = frequenciaDestaque(cuidados.anticoag_frequencia)
  return [droga, dose, freq].filter(Boolean).join(' ')
}

// Abreviação do dispositivo de O2 suplementar — mesmo padrão do exemplo do
// Felipe ("C.N." pra Cateter nasal, "MNR" pra Máscara com reservatório, que
// na beira do leito é chamada de "máscara não reinalante").
const O2_DISPOSITIVO_ABREVIADO: Record<string, string> = {
  'Cateter nasal': 'C.N.',
  'Máscara facial': 'M.F.',
  'Máscara com reservatório': 'MNR',
  'CNAF': 'CNAF',
  'VNI': 'VNI',
}

/** "A.A." / "C.N. 2 L/min" / "MNR 10 L/min" / "VM TOT" — a partir do
 *  registro mais recente da aba Ventilatório (mesmo critério de "atual" que
 *  `EnfermagemTab` já usa: `ultimoPorTurno`). */
export function formatarRespiracao(vent: SuporteVentilatorio | null): string {
  if (!vent?.modalidade) return ''
  if (vent.modalidade === 'ar_ambiente') return 'A.A.'
  if (vent.modalidade === 'ventilacao_mecanica') return ['VM', vent.vm_via].filter(Boolean).join(' ')
  const abrev = vent.o2_dispositivo ? (O2_DISPOSITIVO_ABREVIADO[vent.o2_dispositivo] ?? vent.o2_dispositivo) : ''
  const fluxo = vent.o2_fluxo_l_min != null ? `${vent.o2_fluxo_l_min} L/min` : ''
  return [abrev, fluxo].filter(Boolean).join(' ')
}

export async function buscarDadosPassometro(
  supabase: SupabaseClient, unitId: string, alaId?: string,
): Promise<LinhaPassometro[]> {
  let query = supabase.from('pacientes').select('*').eq('unit_id', unitId).eq('ativo', true)
  if (alaId) query = query.eq('ala_id', alaId)
  const { data: pacientesData } = await query
  const pacientes = (pacientesData ?? []) as Paciente[]
  if (pacientes.length === 0) return []
  const ids = pacientes.map(p => p.id)

  const [atbsR, dvasR, cuidadosR, dispR, balancoR, sinaisR, examesR, pendR, regR, ventR] = await Promise.all([
    supabase.from('atbs').select('*').in('paciente_id', ids).eq('ativo', true),
    supabase.from('dvas').select('*').in('paciente_id', ids).eq('ativo', true),
    supabase.from('cuidados_horizontais').select('*').in('paciente_id', ids),
    supabase.from('dispositivos').select('*').in('paciente_id', ids).is('data_remocao', null).in('tipo', ['AVP', 'PICC', 'CVC', 'PAI', 'CDL', 'SVD', 'CISTO']),
    supabase.from('periodos_balanco').select('*').in('paciente_id', ids).order('inicio', { ascending: false }),
    supabase.from('sinais_vitais').select('*').in('paciente_id', ids).order('horario', { ascending: false }),
    supabase.from('exames').select('*').in('paciente_id', ids),
    supabase.from('pendencias_intensivista').select('*').in('paciente_id', ids).eq('resolvida', false),
    supabase.from('registros_intensivista').select('*').in('paciente_id', ids).order('data', { ascending: false }),
    supabase.from('suportes_ventilatorios').select('*').in('paciente_id', ids),
  ])

  const atbsPorPac     = porPacienteId((atbsR.data ?? []) as ATB[])
  const dvasPorPac     = porPacienteId((dvasR.data ?? []) as DVA[])
  const cuidadosPorPac = new Map(((cuidadosR.data ?? []) as CuidadosHorizontais[]).map(c => [c.paciente_id, c]))
  const dispPorPac     = porPacienteId((dispR.data ?? []) as Dispositivo[])
  const balancoPorPac  = porPacienteId((balancoR.data ?? []) as PeriodoBalanco[])
  const sinaisPorPac   = porPacienteId((sinaisR.data ?? []) as SinalVital[])
  const examesPorPac   = porPacienteId((examesR.data ?? []) as Exame[])
  const pendPorPac     = porPacienteId((pendR.data ?? []) as PendenciaIntensivista[])
  const regPorPac      = porPacienteId((regR.data ?? []) as RegistroIntensivista[])
  const ventPorPac     = porPacienteId((ventR.data ?? []) as SuporteVentilatorio[])

  return pacientes.map(paciente => {
    const cuidados      = cuidadosPorPac.get(paciente.id) ?? null
    const dispositivos  = dispPorPac.get(paciente.id) ?? []
    const periodos       = balancoDaUnidade(balancoPorPac.get(paciente.id) ?? [], paciente.unit_id)
    const sinaisRecente  = sinaisPorPac.get(paciente.id) ?? []
    const examesOrd      = ordenarExamesRecentes(examesPorPac.get(paciente.id) ?? [])
    const pendencias     = pendPorPac.get(paciente.id) ?? []
    const orientacao     = (regPorPac.get(paciente.id) ?? [])[0]?.orientacoes_condutas ?? ''
    const ventAtual      = ultimoPorTurno(ventPorPac.get(paciente.id) ?? [])

    // Temp./FC/PAS/PAD: faixa (mín-méd-máx) das últimas 24h, não uma
    // aferição isolada. HGT é diferente — ela anota TODAS as aferições
    // disponíveis no dia, não uma janela de 24h corridas.
    const sinais24h = sinaisUltimas24h(sinaisRecente)
    const temps24h  = sinais24h.map(s => s.temperatura).filter((v): v is number => v != null)
    const fcs24h    = sinais24h.map(s => s.fc).filter((v): v is number => v != null)
    const pas24h    = sinais24h.map(s => s.pas).filter((v): v is number => v != null)
    const pad24h    = sinais24h.map(s => s.pad).filter((v): v is number => v != null)
    const hoje = new Date().toDateString()
    const hgtHoje = sinaisRecente
      .filter(s => s.hgt != null && new Date(s.horario).toDateString() === hoje)
      .sort((a, b) => new Date(a.horario).getTime() - new Date(b.horario).getTime())
      .map(s => s.hgt)
    const diurese    = calcDiurese24h(periodos)
    const taxaDiurese = diurese.horas > 0 && paciente.peso_kg
      ? `${(diurese.total / paciente.peso_kg / diurese.horas).toFixed(2).replace('.', ',')}mL/Kg/h` : ''
    const { texto: evacTexto, constipado: evacConstipado } = ultimaEvacuacao(periodos, paciente.data_internacao)
    const svd       = dispositivos.find(d => d.tipo === 'SVD')
    const temCisto  = dispositivos.some(d => d.tipo === 'CISTO')
    const viaDiurese = svd ? `SVD ${dataCurta(svd.data_insercao)}` : temCisto ? 'Cistostomia' : 'Espontânea'
    const acessoVascular = dispositivos.filter(d => d.tipo === 'AVP' || d.tipo === 'PICC' || d.tipo === 'CVC' || d.tipo === 'PAI' || d.tipo === 'CDL')

    const labs: Record<string, string> = {}
    for (const a of ANALITOS_LABS) labs[a.key] = valorLabsMaisRecente(examesOrd, a)

    const linha: LinhaPassometro = {
      alaId: paciente.ala_id,
      vazio: false,
      leito: paciente.numero_leito,
      nome: paciente.nome.trim(),
      idade: calcAge(paciente.data_nascimento),
      admissao: dataCurta(paciente.data_internacao),
      hd: paciente.hipoteses ?? '',
      peso: paciente.peso_kg != null ? `${paciente.peso_kg}Kg` : '',
      diurese: diurese.horas > 0 ? `${diurese.total}mL(${diurese.horas}h)${taxaDiurese ? ' ' + taxaDiurese : ''}` : '',
      viaDiurese,
      acesso: acessoVascular
        .map(d => (d.tipo === 'CVC' || d.tipo === 'PICC') ? `${d.tipo} ${dataCurta(d.data_insercao)}` : d.tipo)
        .join('; '),
      hgt: hgtHoje.join('/'),
      temp: faixaMinMax(temps24h),
      respiracao: formatarRespiracao(ventAtual),
      fcResumo: blocoVital('FC', fcs24h),
      paResumo: blocoPA(pas24h, pad24h),
      evac: evacTexto,
      evacConstipado,
      antimicrobiano: (atbsPorPac.get(paciente.id) ?? [])
        .map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''})`).join(' · '),
      dva: (dvasPorPac.get(paciente.id) ?? []).map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(' · '),
      corticoide: cuidados?.corticoide_em_uso ? 'Sim' : '',
      ibp: formatarIbp(cuidados),
      anticoag: formatarAnticoag(cuidados),
      anticoagTerapeutico: cuidados?.anticoag_em_uso === true && cuidados.anticoag_objetivo === 'terapeutico',
      labs,
      pendencias: [...pendencias.map(p => p.texto), orientacao].filter(Boolean).join(' · '),
      previsaoAlta: cuidados?.previsao_alta ? dataCurta(cuidados.previsao_alta) : '',
      previsaoAltaHoje: cuidados?.previsao_alta === hojeISO(),
    }
    return linha
  })
}

function linhaVazia(alaId: string, leito: string): LinhaPassometro {
  return {
    alaId, vazio: true, leito, nome: '', idade: '', admissao: '', hd: '', peso: '', diurese: '',
    viaDiurese: '', acesso: '', hgt: '', temp: '', respiracao: '', fcResumo: '', paResumo: '',
    evac: '', evacConstipado: false, antimicrobiano: '', dva: '', corticoide: '', ibp: '', anticoag: '',
    anticoagTerapeutico: false, labs: {}, pendencias: '', previsaoAlta: '', previsaoAltaHoje: false,
  }
}

/**
 * Uma seção por ala, com uma linha por LEITO — ocupado ou vazio — na ordem
 * vigente da planta (`ala.leitos`). Ala rotativo (leito de trânsito) só
 * entra se tiver alguém nela agora: vazia, ela já some do resto do app
 * (dashboard/indicadores) e o passômetro segue a mesma regra.
 */
export function agruparPorAla(alas: Ala[], linhasPacientes: LinhaPassometro[]): SecaoPassometro[] {
  const porLeito = new Map<string, LinhaPassometro>()
  for (const l of linhasPacientes) porLeito.set(`${l.alaId}|${l.leito}`, l)
  return alas
    .filter(ala => !ala.rotativo || ala.leitos.some(cod => porLeito.has(`${ala.id}|${cod}`)))
    .map(ala => ({
      ala,
      linhas: ala.leitos
        .map(cod => porLeito.get(`${ala.id}|${cod}`) ?? linhaVazia(ala.id, cod))
        .sort((a, b) => compararLeitos(a.leito, b.leito)),
    }))
}

// Cada paciente ocupa 2 linhas físicas da planilha — igual ao papel do
// Felipe. A maioria das colunas mescla as duas (1 valor só, possivelmente em
// várias linhas de texto dentro da célula mesclada); as colunas que sempre
// têm 2 itens distintos por paciente (Acesso/Insulina, Temp./Respiração,
// psicotrópico/analgesia, DVA/corticoide, IBP/anticoagulante) NÃO mesclam:
// `texto` cai na 1ª linha física, `texto2` na 2ª — cada item na própria
// linha, sem espremer os dois num \n só. O cabeçalho segue o mesmo padrão da
// coluna (`label`/`label2`) — ver montagem do cabeçalho mais abaixo.
interface Coluna {
  label: string
  /** Rótulo da 2ª linha física do cabeçalho — só usado (e só faz sentido)
   *  quando a coluna tem `texto2`. */
  label2?: string
  width: number
  texto: (l: LinhaPassometro) => string
  texto2?: (l: LinhaPassometro) => string
  /** Sobrepõe a fonte padrão da célula da 1ª linha física (`texto`) — pra
   *  destacar algo condicionalmente (Evac. em constipação) ou dar mais
   *  espaço a um campo central (Nome, Leito). `null` = fonte padrão. */
  fonte?: (l: LinhaPassometro) => Partial<ExcelJS.Font> | null
  /** Mesma ideia, pra 2ª linha física (`texto2`) — independente de `fonte`
   *  (ex.: negrito só na linha de anticoagulante terapêutico, não na de IBP). */
  fonte2?: (l: LinhaPassometro) => Partial<ExcelJS.Font> | null
  /** Colunas com o mesmo `grupoCabecalho` mesclam o CABEÇALHO num título só
   *  (as células de dado continuam separadas) — usado nos 3 blocos de
   *  exames, que sozinhos cortavam o nome de cada marcador. */
  grupoCabecalho?: string
}

const labs = (l: LinhaPassometro, ...keys: string[]) => keys.map(k => l.labs[k] || '').join('/')

const COLUNAS: Coluna[] = [
  // Leito é o dado mais consultado num relance — fonte bem maior que o resto
  // da tabela, sem problema ficar desigual (pedido do Felipe: "prefiro ocupe
  // mais espaço" a espremer o número num quadrado grande e vazio).
  { label: 'Leito', width: 7, texto: l => l.leito, fonte: () => ({ size: 20, bold: true }) },
  {
    label: 'Nome/Idade\nAdmissão', width: 15, texto: l => `${l.nome}\n${l.idade}\n${l.admissao}`,
    fonte: () => ({ size: 9 }),
  },
  { label: 'Diagnóstico', width: 13, texto: l => l.hd },
  { label: 'Peso\nDiurese\nVia', width: 12, texto: l => `${l.peso}\n${l.diurese}\n${l.viaDiurese}` },
  // 2 linhas físicas: de cima o tipo de acesso vem automático (dispositivos
  // ativos — AVP/PICC/CVC/PAI/CDL), hidratação fica pra completar à mão na
  // mesma linha; de baixo já vem o roteiro de insulina pré-impresso, um item
  // por linha de escrita — igual à planilha em branco que o Felipe mandou.
  {
    label: 'Acesso/Hidrat.', label2: 'Insulina', width: 15,
    texto: l => l.acesso, texto2: () => 'NPH:\nREG:\nSOS:',
  },
  { label: 'Dieta\nHGT', width: 9, texto: l => `\n${l.hgt}` },
  // 2 linhas físicas, ambas automáticas: Temp. (mín–máx das últimas 24h) e
  // Respiração (registro mais recente da aba Ventilatório — "A.A.", "C.N. 2
  // L/min", "VM TOT" etc.).
  { label: 'Temp.', label2: 'Respiração', width: 8, texto: l => l.temp, texto2: l => l.respiracao },
  {
    // Só negrito, sem cor — a impressora é preto e branco, cor não imprime
    // como sinal (pedido do Felipe).
    label: 'Evac.', width: 10, texto: l => l.evac,
    fonte: l => l.evacConstipado ? { bold: true } : null,
  },
  { label: 'Antimicrob.', width: 13, texto: l => l.antimicrobiano },
  // Em branco de propósito nas duas linhas — psicotrópico/analgesia e o nome
  // do anti-hipertensivo vêm de texto livre (Medicações de Uso Contínuo),
  // que o Felipe pediu pra NÃO importar: "deixe em branco, não importe das MUC".
  { label: 'Psicotróp.', label2: 'Analgesia', width: 10, texto: () => '', texto2: () => '' },
  { label: 'DVA', label2: 'Corticoide', width: 11, texto: l => l.dva, texto2: l => l.corticoide },
  {
    label: 'IBP', label2: 'Anticoag.', width: 12, texto: l => l.ibp, texto2: l => l.anticoag,
    fonte2: l => l.anticoagTerapeutico ? { bold: true } : null,
  },
  // Substitui a antiga classificação por seta ("↑ taquicárdico" etc.) por
  // números direto. 2 linhas físicas, mesmo padrão do resto: em cima PA
  // (3 linhas, PAS e PAD combinados como "150x82" — ver blocoPA); embaixo FC
  // (3 linhas). Largura bem maior que o normal — pedido do Felipe, pra
  // sobrar espaço de escrever à mão as medicações que impactam FC/PA ao
  // lado dos números.
  {
    label: 'PA (PASxPAD)', label2: 'FC', width: 24,
    texto: l => l.paResumo,
    texto2: l => l.fcResumo,
  },
  // Nome do exame repetido em cada linha do valor (não só no cabeçalho) —
  // pedido do Felipe: rolando a planilha pra baixo, o cabeçalho já ficou
  // longe e a coluna sozinha não deixava claro o que era cada número. As 3
  // colunas dividem um único título de cabeçalho ("Últimos Exames
  // Laboratoriais", via `grupoCabecalho`) — os nomes individuais bastam nas
  // linhas de dado, o cabeçalho separado só cortava o texto.
  { label: '', width: 13, grupoCabecalho: 'Últimos Exames Laboratoriais', texto: l => `Leuco: ${labs(l, 'leuco')}\nHb/Ht: ${labs(l, 'hb', 'ht')}\nPlaq: ${labs(l, 'plaq')}\nPCR: ${labs(l, 'pcr')}\nLactato: ${labs(l, 'lactato')}` },
  { label: '', width: 11, grupoCabecalho: 'Últimos Exames Laboratoriais', texto: l => `Ur: ${labs(l, 'ureia')}\nCreat: ${labs(l, 'creat')}\nNa: ${labs(l, 'na')}\nK: ${labs(l, 'k')}\nMg: ${labs(l, 'mg')}` },
  { label: '', width: 11, grupoCabecalho: 'Últimos Exames Laboratoriais', texto: l => `pH: ${labs(l, 'ph')}\nHCO3: ${labs(l, 'bic')}\npCO2: ${labs(l, 'pco2')}\npO2: ${labs(l, 'po2')}\nCai: ${labs(l, 'ca')}` },
  { label: 'Programações / Pendências / Condutas / Lembretes', width: 22, texto: l => l.pendencias },
  // Data crítica pra decisão do dia — fonte bem maior, mesmo raciocínio do
  // Leito. "Hoje!" abaixo da data quando a previsão cai no dia da geração.
  {
    label: 'Previsão de Alta', width: 10,
    texto: l => l.previsaoAlta + (l.previsaoAltaHoje ? '\nHoje!' : ''),
    fonte: () => ({ size: 16, bold: true }),
  },
]

const COR_GRUPO = 'FFEEF2FF'
const COR_LABEL = 'FFF1F5F9'
const COR_BORDA = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
const BORDA_FINA = { top: COR_BORDA, left: COR_BORDA, bottom: COR_BORDA, right: COR_BORDA }
// Borda de baixo mais espessa que separa um paciente do próximo — pedido do
// Felipe pra ficar mais fácil de ver onde um leito termina e o outro começa.
const COR_BORDA_GROSSA = { style: 'medium' as const, color: { argb: 'FF64748B' } }
const BORDA_ENTRE_PACIENTES = { ...BORDA_FINA, bottom: COR_BORDA_GROSSA }

export function gerarPlanilhaPassometro(unidade: Unidade, secoes: SecaoPassometro[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ProMed'
  wb.created = new Date()
  const ws = wb.addWorksheet('Passômetro', {
    views: [{ showGridLines: false }],
    pageSetup: {
      // Largura sempre cabe numa página (nunca corta paciente ao meio na
      // horizontal); altura livre (fitToHeight 0 com fitToPage true = "só
      // ajusta a largura") — deixa a fonte no tamanho legível pedido e, se
      // uma ala tiver muitos leitos, transborda pra 2ª página em vez de
      // espremer tudo pra caber numa altura fixa.
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.3, header: 0, footer: 0 },
    },
  })
  ws.columns = COLUNAS.map(c => ({ width: c.width }))

  const titulo = ws.addRow([`🗒️ Passômetro — ${unidade.nome}`])
  titulo.getCell(1).font = { bold: true, size: 13 }
  ws.mergeCells(titulo.number, 1, titulo.number, COLUNAS.length)
  const subtitulo = ws.addRow([`Gerado em ${new Date().toLocaleString('pt-BR')}`])
  subtitulo.getCell(1).font = { italic: true, size: 8, color: { argb: 'FF64748B' } }
  ws.mergeCells(subtitulo.number, 1, subtitulo.number, COLUNAS.length)

  for (const { ala, linhas } of secoes) {
    const ocupados = linhas.filter(l => !l.vazio).length
    const cabecalhoAla = ws.addRow([`${ala.nome} (${ocupados}/${linhas.length} leitos ocupados)`])
    cabecalhoAla.font = { bold: true, size: 11 }
    cabecalhoAla.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_GRUPO } } })
    ws.mergeCells(cabecalhoAla.number, 1, cabecalhoAla.number, COLUNAS.length)

    // Cabeçalho em 2 linhas físicas, no mesmo padrão dos dados: colunas com
    // `texto2` (2 itens por paciente) mostram `label` em cima e `label2`
    // embaixo, sem mesclar; colunas mescladas (1 valor só) mesclam o
    // cabeçalho verticalmente também, igual ao bloco de dados abaixo.
    const headerA = ws.addRow(COLUNAS.map(c => c.label))
    const headerB = ws.addRow(COLUNAS.map(c => c.texto2 ? (c.label2 ?? '') : ''))
    for (const r of [headerA, headerB]) {
      r.font = { bold: true, size: 8, color: { argb: 'FF475569' } }
      r.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
      r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_LABEL } }; c.border = BORDA_FINA })
      r.height = 22
    }

    // Colunas consecutivas com o mesmo `grupoCabecalho` mesclam o cabeçalho
    // (as 2 linhas físicas E as colunas do grupo) num título só (as células
    // de dado abaixo continuam separadas); colunas sem `texto2` mesclam só
    // verticalmente, igual ao bloco de dados.
    for (let col = 1; col <= COLUNAS.length;) {
      const coluna = COLUNAS[col - 1]
      if (coluna.grupoCabecalho) {
        let fim = col
        while (fim < COLUNAS.length && COLUNAS[fim].grupoCabecalho === coluna.grupoCabecalho) fim++
        ws.mergeCells(headerA.number, col, headerB.number, fim)
        headerA.getCell(col).value = coluna.grupoCabecalho
        col = fim + 1
      } else if (!coluna.texto2) {
        ws.mergeCells(headerA.number, col, headerB.number, col)
        col++
      } else {
        col++
      }
    }

    for (const linha of linhas) {
      // 2 linhas físicas por paciente: colunas sem `texto2` mesclam as duas
      // (1 valor, possivelmente multi-linha via \n); as com `texto2` ficam
      // sem mesclar — 1 item em cada linha física. Leito vazio fica em
      // branco (sem preenchimento cinza) — é onde o Felipe anota à mão uma
      // admissão nova antes de passar pro app, e o cinza atrapalhava escrever
      // na planilha impressa.
      const rowA = ws.addRow(COLUNAS.map(c => c.texto(linha)))
      const rowB = ws.addRow(COLUNAS.map(c => c.texto2?.(linha) ?? ''))
      rowA.font = { size: 8 }
      rowB.font = { size: 8 }
      for (const r of [rowA, rowB]) r.alignment = { wrapText: true, vertical: 'top' }
      // rowA (PA combinado, Nome/Idade/Admissão) e rowB (NPH/REG/SOS da
      // Insulina, ou FC) precisam da MESMA altura — as duas cabem até 3
      // linhas curtas sozinhas. 27pt (o que rowA tinha) só dava pra ~2
      // linhas e cortava "PA Mín" (a 3ª); 34pt (o que rowB já usava, sem
      // reclamação de corte) cobre 3 linhas de 8pt com folga — Excel não
      // faz auto-fit de altura quando ela é setada manualmente.
      rowA.height = 34
      rowB.height = 34
      COLUNAS.forEach((c, i) => {
        const col = i + 1
        if (!c.texto2) ws.mergeCells(rowA.number, col, rowB.number, col)
        rowA.getCell(col).border = BORDA_FINA
        rowB.getCell(col).border = BORDA_ENTRE_PACIENTES
        const fonteA = c.fonte?.(linha)
        const fonteB = (c.fonte2 ?? c.fonte)?.(linha)
        if (fonteA) rowA.getCell(col).font = { ...rowA.font, ...fonteA }
        if (fonteB) rowB.getCell(col).font = { ...rowB.font, ...fonteB }
      })
    }
    ws.addRow([])
  }

  return wb
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function corCss(fonte: Partial<ExcelJS.Font>): string {
  const argb = (fonte.color as { argb?: string } | undefined)?.argb
  return `${fonte.bold ? 'font-weight:bold;' : ''}${argb ? `color:#${argb.slice(2)};` : ''}${fonte.size ? `font-size:${fonte.size}pt;` : ''}`
}

// Limite de leitos por página impressa: mesmo com quebra de página forçada
// por ala, uma ala grande ainda podia não caber inteira numa A4 — em vez de
// deixar o navegador cortar a tabela em qualquer altura (inclusive no meio
// de um paciente), cada ala vira 1+ páginas de no máximo esta quantidade de
// leitos, cada uma com seu próprio cabeçalho de ala/coluna repetido.
const LEITOS_POR_PAGINA = 10

function agruparEmPaginas<T>(itens: T[], tamanho: number): T[][] {
  const paginas: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) paginas.push(itens.slice(i, i + tamanho))
  return paginas
}

/**
 * Mesma estrutura do Excel (reaproveita COLUNAS), como página HTML pronta
 * pra imprimir na hora — sem baixar o .xlsx, abrir no Excel, autorizar
 * edição e só então mandar imprimir. Quem chama abre isso numa aba/janela
 * nova e dispara `window.print()` (ver PassometroButton.tsx).
 */
export function gerarHtmlPassometro(unidade: Unidade, secoes: SecaoPassometro[]): string {
  const totalWidth = COLUNAS.reduce((s, c) => s + c.width, 0)
  const colgroup = COLUNAS.map(c => `<col style="width:${(c.width / totalWidth * 100).toFixed(2)}%">`).join('')
  // Largura NATURAL da tabela (em mm), aproximando a mesma conversão que o
  // Excel usa de "largura em caracteres" pra pixels — é o que faz esta
  // tabela nascer do MESMO tamanho "cheio" que o Excel usa antes de encolher
  // pra caber na página (fitToWidth). Antes a tabela nascia já fixa em
  // 281mm (a largura da página), then o script de auto-escala só sobrava
  // pra encolher a ALTURA — dobrando o encolhimento e deixando o texto bem
  // menor/mais apertado do que o mesmo arquivo impresso a partir do Excel.
  const larguraNaturalMm = COLUNAS.reduce((s, c) => s + (c.width * 7 + 5) * 25.4 / 96, 0)

  // Cabeçalho em 2 <tr>, no mesmo padrão dos dados: colunas com `texto2`
  // mostram `label` numa linha e `label2` na outra, sem rowspan; colunas
  // mescladas (1 valor só) ganham rowspan="2", igual ao bloco de dados —
  // e os 3 blocos de exames somam colspan (horizontal) com rowspan (vertical).
  const headerRowACells: string[] = []
  const headerRowBCells: string[] = []
  for (let col = 0; col < COLUNAS.length;) {
    const c = COLUNAS[col]
    if (c.grupoCabecalho) {
      let fim = col
      while (fim < COLUNAS.length && COLUNAS[fim].grupoCabecalho === c.grupoCabecalho) fim++
      headerRowACells.push(`<th colspan="${fim - col}" rowspan="2">${escapeHtml(c.grupoCabecalho)}</th>`)
      col = fim
      continue
    }
    if (c.texto2) {
      headerRowACells.push(`<th>${escapeHtml(c.label).replace(/\n/g, '<br>')}</th>`)
      headerRowBCells.push(`<th>${escapeHtml(c.label2 ?? '').replace(/\n/g, '<br>')}</th>`)
    } else {
      headerRowACells.push(`<th rowspan="2">${escapeHtml(c.label).replace(/\n/g, '<br>')}</th>`)
    }
    col++
  }
  const linhaCabecalho = `<tr>${headerRowACells.join('')}</tr><tr>${headerRowBCells.join('')}</tr>`

  // Cada paciente vira um <tbody> próprio (não <tr> soltos direto na tabela)
  // — é o que permite `break-inside: avoid` impedir que a impressão corte
  // um paciente ao meio entre as duas linhas físicas dele.
  const linhasParaHtml = (linhas: LinhaPassometro[]) => linhas.map(linha => {
    const celsA: string[] = []
    const celsB: string[] = []
    COLUNAS.forEach(c => {
      const estiloA = corCss(c.fonte?.(linha) ?? {})
      const attrA = estiloA ? ` style="${estiloA}"` : ''
      if (c.texto2) {
        const estiloB = corCss((c.fonte2 ?? c.fonte)?.(linha) ?? {})
        const attrB = estiloB ? ` style="${estiloB}"` : ''
        celsA.push(`<td${attrA}>${escapeHtml(c.texto(linha)).replace(/\n/g, '<br>')}</td>`)
        celsB.push(`<td${attrB}>${escapeHtml(c.texto2(linha)).replace(/\n/g, '<br>')}</td>`)
      } else {
        celsA.push(`<td rowspan="2"${attrA}>${escapeHtml(c.texto(linha)).replace(/\n/g, '<br>')}</td>`)
      }
    })
    return `<tbody><tr>${celsA.join('')}</tr><tr>${celsB.join('')}</tr></tbody>`
  }).join('')

  // 1 página por ala — ou por bloco de até LEITOS_POR_PAGINA leitos, quando
  // a ala tem mais do que isso — cada uma numa <table> própria dentro de um
  // <div class="pagina"> com quebra de página explícita entre elas. Antes
  // disso tudo vivia numa única tabela gigante e o navegador decidia sozinho
  // onde cortar, vazando uma ala pra página da outra.
  //
  // Título + "gerado em" entram DENTRO de cada .pagina (repetidos por
  // página), não uma vez só no topo do body: viviam fora antes, e por isso
  // sua altura não contava no cálculo de "encolher pra caber numa página"
  // (script no fim do body) — sobrava só pro conteúdo da 1ª página, que
  // vazava pra uma 2ª mesmo já escalado.
  const paginasHtml = secoes.flatMap(({ ala, linhas }) => {
    const ocupados = linhas.filter(l => !l.vazio).length
    const blocos = agruparEmPaginas(linhas, LEITOS_POR_PAGINA)
    return blocos.map((bloco, i) => {
      const sufixoPagina = blocos.length > 1 ? ` — página ${i + 1}/${blocos.length}` : ''
      const cabecalhoAla = `<tr><td class="ala" colspan="${COLUNAS.length}">${escapeHtml(ala.nome)} (${ocupados}/${linhas.length} leitos ocupados)${sufixoPagina}</td></tr>`
      return `<div class="pagina"><div class="pagina-conteudo">
        <h1>🗒️ Passômetro — ${escapeHtml(unidade.nome)}</h1>
        <p class="subtitulo">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        <table><colgroup>${colgroup}</colgroup><thead>${cabecalhoAla}${linhaCabecalho}</thead>${linhasParaHtml(bloco)}</table>
      </div></div>`
    })
  }).join('')

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Passômetro — ${escapeHtml(unidade.nome)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  /* Fundo branco fixo — é uma página pra imprimir em papel, não deve seguir
     o tema escuro do sistema/navegador (senão o texto escuro some no fundo
     escuro na pré-visualização, antes mesmo de chegar no diálogo de impressão). */
  html, body { background: #ffffff; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; margin: 0; color: #0f172a; }
  h1 { font-size: 13pt; margin: 0 0 2px; }
  .subtitulo { font-size: 8pt; color: #64748b; font-style: italic; margin: 0 0 6px; }
  table { border-collapse: collapse; width: ${larguraNaturalMm.toFixed(1)}mm; table-layout: fixed; }
  td, th { border: 1px solid #94a3b8; padding: 2px 3px; vertical-align: top; word-wrap: break-word; }
  th { background: #f1f5f9; font-size: 7.5pt; text-align: center; font-weight: bold; }
  td.ala { background: #eef2ff; font-weight: bold; font-size: 11pt; padding: 4px; }
  /* 1 página por ala (ou por bloco de até 10 leitos) — cada uma força quebra
     de página, e cada paciente (1 <tbody>) não pode ser cortado ao meio.
     .pagina-conteudo (título + tabela) nasce na largura NATURAL (acima) e o
     script de auto-escala (fim do body) encolhe ela pra caber na página —
     o mesmo "ajustar à página" que o Excel já faz sozinho (fitToWidth),
     calculado aqui a partir do tamanho real renderizado. */
  .pagina { page-break-after: always; break-after: page; overflow: hidden; }
  .pagina:last-child { page-break-after: auto; break-after: auto; }
  .pagina-conteudo { width: ${larguraNaturalMm.toFixed(1)}mm; transform-origin: top left; }
  .pagina tbody { page-break-inside: avoid; break-inside: avoid; }
  /* Altura mínima nas 2 linhas físicas de cada paciente — sem isso, um
     leito vazio (todo campo em branco, só o número do leito com rowspan=2
     em fonte 20pt) deixava o navegador jogar quase toda a altura pra linha
     de baixo e encolher a de cima quase a zero (distribuição de rowspan
     entre as duas <tr>, sem nenhum outro conteúdo pra sustentar a de
     cima). 34pt casa com a altura de linha do Excel (rowA/rowB). */
  .pagina tbody tr { height: 34pt; }
  /* Borda de baixo mais espessa separando um paciente do próximo — a última
     <tr> de cada <tbody> é sempre a 2ª linha física do paciente. */
  .pagina tbody tr:last-child td { border-bottom: 2px solid #475569; }
</style>
</head><body>
  ${paginasHtml}
  <script>
  (function () {
    // Mede quantos px o navegador usa por mm (evita supor 96dpi) e encolhe
    // cada página, via transform: scale(), até caber na área imprimível de
    // uma A4 paisagem com margem de 8mm (297x210mm - 16mm = 281x194mm) —
    // o mesmo espírito do "ajustar à página" que o Excel já faz sozinho
    // (fitToWidth), só que aqui calculado pro conteúdo real renderizado
    // (título + tabela juntos — os dois vivem dentro de .pagina-conteudo).
    function pxPorMm() {
      var sonda = document.createElement('div')
      sonda.style.cssText = 'position:absolute;visibility:hidden;height:100mm;width:0;padding:0;margin:0;border:0;'
      document.body.appendChild(sonda)
      var px = sonda.getBoundingClientRect().height / 100
      document.body.removeChild(sonda)
      return px || (96 / 25.4)
    }
    function ajustarPaginas() {
      var ppmm = pxPorMm()
      var margem = 2 * ppmm // folga p/ arredondamento não estourar a página
      var larguraPx = 281 * ppmm - margem
      var alturaPx = 194 * ppmm - margem
      document.querySelectorAll('.pagina').forEach(function (pagina) {
        var conteudo = pagina.querySelector('.pagina-conteudo')
        if (!conteudo) return
        conteudo.style.transform = 'none'
        var altura = conteudo.getBoundingClientRect().height
        var largura = conteudo.getBoundingClientRect().width
        var escala = Math.min(1, alturaPx / altura, larguraPx / largura)
        if (escala < 1) {
          conteudo.style.transform = 'scale(' + escala + ')'
          pagina.style.height = (altura * escala) + 'px'
        }
      })
    }
    window.addEventListener('load', function () {
      ajustarPaginas()
      setTimeout(function () { window.print() }, 50)
    })
    window.onafterprint = function () { window.close() }
  })()
  </script>
</body></html>`
}
