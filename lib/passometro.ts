import type { SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { Ala, Unidade } from '@/lib/unidade'
import { compararLeitos } from '@/lib/unidade'
import { calcAge, diaAtualATB, calcDiurese24h, balancoDaUnidade } from '@/lib/utils'
import type {
  Paciente, ATB, DVA, CuidadosHorizontais, Dispositivo, PeriodoBalanco,
  SinalVital, Exame, PendenciaIntensivista, RegistroIntensivista,
} from '@/types'

// Os 15 marcadores do passômetro batem 1:1 com o catálogo de analitos usado
// na extração de exames (lib/exames/extracao/catalogo/analitos.json) — o
// mesmo id que a IA reconhece no laudo é o que buscamos aqui.
const ANALITOS_LABS: { key: string; label: string; id: string }[] = [
  { key: 'hb', label: 'Hb', id: 'hemoglobina.serum' },
  { key: 'ht', label: 'Ht', id: 'hematocrito.serum' },
  { key: 'leuco', label: 'Leuco', id: 'leucocitos.serum' },
  { key: 'plaq', label: 'Plaq', id: 'plaquetas.serum' },
  { key: 'pcr', label: 'PCR', id: 'pcr.serum' },
  { key: 'lactato', label: 'Lactato', id: 'lactato.serum' },
  { key: 'ureia', label: 'Ureia', id: 'ureia.serum' },
  { key: 'creat', label: 'Creat', id: 'creatinina.serum' },
  { key: 'na', label: 'Na', id: 'sodio.serum' },
  { key: 'k', label: 'K', id: 'potassio.serum' },
  { key: 'mg', label: 'Mg', id: 'magnesio.serum' },
  { key: 'ph', label: 'pH', id: 'ph.serum' },
  { key: 'bic', label: 'Bic', id: 'hco3.serum' },
  { key: 'pco2', label: 'pCO2', id: 'pco2.serum' },
  { key: 'po2', label: 'pO2', id: 'po2.serum' },
]
// Gasometria arterial/venosa/sem especificar têm ids distintos no catálogo —
// pro passômetro (visão rápida) qualquer um serve, pega o mais recente dos 3.
const CA_IONICO_IDS = ['calcio.ionico.serum', 'calcio.ionico.art', 'calcio.ionico.ven']

export interface LinhaPassometro {
  paciente: Paciente
  leito: string
  nomeCurto: string
  idade: string
  admissao: string
  hd: string
  peso: string
  diurese: string
  acesso: string
  hgt: string
  temp: string
  /** Classificação rápida da última PA/FC — "↑ hipertenso", "→ normal" etc.,
   *  pedido do Felipe: "resumo visual... pra já saber quem tá taqui ou
   *  bradicárdico, hipo ou hipertenso" — não é o valor bruto, é a leitura. */
  paTendencia: string
  fcTendencia: string
  evac: string
  antimicrobiano: string
  dva: string
  corticoide: string
  /** IBP e anticoagulante ficam em campos separados porque ocupam duas linhas
   *  distintas na mesma célula, exatamente como no papel: "linha de cima me
   *  fala sobre IBP... a de baixo sobre anticoagulantes". */
  ibp: string
  anticoag: string
  labs: Record<string, string>
  pendencias: string
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

/** Exame mais recente primeiro — por data de coleta; sem data, usa o upload. */
function ordenarExamesRecentes(exames: Exame[]): Exame[] {
  return [...exames].sort((a, b) =>
    new Date(b.data_exame ?? b.created_at).getTime() - new Date(a.data_exame ?? a.created_at).getTime())
}

function valorLabsMaisRecente(examesOrdenados: Exame[], ids: string[]): string {
  for (const exame of examesOrdenados) {
    for (const r of exame.resultados ?? []) {
      if (r.analito_id && ids.includes(r.analito_id)) {
        return r.unidade ? `${r.valor} ${r.unidade}` : r.valor
      }
    }
  }
  return ''
}

/** "Graciema Peixoto Rodrigues" -> "Graciema Rodrigues" — nome completo não
 *  cabe na densidade do passômetro; primeiro + último nome já identifica o
 *  leito sem competir por espaço com o resto da linha. */
function primeiroUltimoNome(nomeCompleto: string): string {
  const partes = nomeCompleto.trim().split(/\s+/)
  return partes.length <= 1 ? nomeCompleto : `${partes[0]} ${partes[partes.length - 1]}`
}

/** "2026-08-16" -> "16/08" — ano e hora de internação não importam pro
 *  passômetro do dia, só atrapalham a leitura rápida. */
function admissaoCurta(dataISO: string): string {
  const [, mes, dia] = dataISO.split('-')
  return `${dia}/${mes}`
}

function classificarPA(s: SinalVital | undefined): string {
  if (!s) return ''
  if ((s.pas != null && s.pas < 90) || (s.pam != null && s.pam < 65)) return '↓ hipotenso'
  if ((s.pas != null && s.pas > 140) || (s.pad != null && s.pad > 90)) return '↑ hipertenso'
  if (s.pas == null && s.pam == null) return ''
  return '→ normal'
}

function classificarFC(s: SinalVital | undefined): string {
  if (!s || s.fc == null) return ''
  if (s.fc < 60) return '↓ bradicárdico'
  if (s.fc > 100) return '↑ taquicárdico'
  return '→ normal'
}

/** Formata "Enoxaparina 40mg 12/12h (terapêutico)" só com o que existir —
 *  profilático fica sem sufixo, igual ao "Enoxa 40" dela pra profilaxia. */
function formatarPosologia(droga: string, doseValor: number | null, doseUnidade: string | null,
  objetivo: 'profilatico' | 'terapeutico' | null, frequencia: string | null): string {
  const dose = doseValor != null ? ` ${doseValor}${doseUnidade ?? ''}` : ''
  const terapeutico = objetivo === 'terapeutico' ? ` ${frequencia ?? ''} (terapêutico)`.trimEnd() : ''
  return `${droga}${dose}${terapeutico}`.trim()
}

export async function buscarDadosPassometro(
  supabase: SupabaseClient, unitId: string, alaId?: string,
): Promise<{ paciente: Paciente; linha: LinhaPassometro }[]> {
  let query = supabase.from('pacientes').select('*').eq('unit_id', unitId).eq('ativo', true)
  if (alaId) query = query.eq('ala_id', alaId)
  const { data: pacientesData } = await query
  const pacientes = (pacientesData ?? []) as Paciente[]
  if (pacientes.length === 0) return []
  const ids = pacientes.map(p => p.id)

  const [atbsR, dvasR, cuidadosR, dispR, balancoR, sinaisR, examesR, pendR, regR] = await Promise.all([
    supabase.from('atbs').select('*').in('paciente_id', ids).eq('ativo', true),
    supabase.from('dvas').select('*').in('paciente_id', ids).eq('ativo', true),
    supabase.from('cuidados_horizontais').select('*').in('paciente_id', ids),
    supabase.from('dispositivos').select('*').in('paciente_id', ids).is('data_remocao', null).in('tipo', ['AVP', 'CVC', 'PAI', 'CDL']),
    supabase.from('periodos_balanco').select('*').in('paciente_id', ids).order('inicio', { ascending: false }),
    supabase.from('sinais_vitais').select('*').in('paciente_id', ids).order('horario', { ascending: false }),
    supabase.from('exames').select('*').in('paciente_id', ids),
    supabase.from('pendencias_intensivista').select('*').in('paciente_id', ids).eq('resolvida', false),
    supabase.from('registros_intensivista').select('*').in('paciente_id', ids).order('data', { ascending: false }),
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

  return pacientes.map(paciente => {
    const cuidados      = cuidadosPorPac.get(paciente.id) ?? null
    const dispositivos  = dispPorPac.get(paciente.id) ?? []
    const periodos       = balancoDaUnidade(balancoPorPac.get(paciente.id) ?? [], paciente.unit_id)
    const sinaisRecente  = sinaisPorPac.get(paciente.id) ?? []
    const examesOrd      = ordenarExamesRecentes(examesPorPac.get(paciente.id) ?? [])
    const pendencias     = pendPorPac.get(paciente.id) ?? []
    const orientacao     = (regPorPac.get(paciente.id) ?? [])[0]?.orientacoes_condutas ?? ''

    // Diurno/noturno separados (não só a mais recente geral) porque o Felipe
    // registra as duas aferições do dia lado a lado no papel.
    const tempDiurno  = sinaisRecente.find(s => s.turno === 'diurno' && s.temperatura != null)
    const tempNoturno = sinaisRecente.find(s => s.turno === 'noturno' && s.temperatura != null)
    const hgtDiurno    = sinaisRecente.find(s => s.turno === 'diurno' && s.hgt != null)
    const hgtNoturno   = sinaisRecente.find(s => s.turno === 'noturno' && s.hgt != null)
    const ultimoComPA = sinaisRecente.find(s => s.pas != null || s.pam != null)
    const ultimoComFc = sinaisRecente.find(s => s.fc != null)
    const diurese    = calcDiurese24h(periodos)
    const taxaDiurese = diurese.horas > 0 && paciente.peso_kg
      ? `${(diurese.total / paciente.peso_kg / diurese.horas).toFixed(2).replace('.', ',')}mL/Kg/h` : ''
    const evacDiarreica = periodos.some(p => p.diarreica_medico || p.diarreica_nutricao)

    const labs: Record<string, string> = {}
    for (const a of ANALITOS_LABS) labs[a.key] = valorLabsMaisRecente(examesOrd, [a.id])
    labs.ca = valorLabsMaisRecente(examesOrd, CA_IONICO_IDS)

    const linha: LinhaPassometro = {
      paciente,
      leito: paciente.numero_leito,
      nomeCurto: primeiroUltimoNome(paciente.nome),
      idade: calcAge(paciente.data_nascimento),
      admissao: admissaoCurta(paciente.data_internacao),
      hd: paciente.hipoteses ?? '',
      peso: paciente.peso_kg != null ? `${paciente.peso_kg}Kg` : '',
      diurese: diurese.horas > 0 ? `${diurese.total}mL(${diurese.horas}h)${taxaDiurese ? ' ' + taxaDiurese : ''}` : '',
      acesso: dispositivos.map(d => d.observacao ? `${d.tipo} (${d.observacao})` : d.tipo).join('; '),
      hgt: [hgtDiurno?.hgt, hgtNoturno?.hgt].filter(v => v != null).join(' / '),
      temp: [tempDiurno?.temperatura, tempNoturno?.temperatura].filter(v => v != null).join(' / '),
      paTendencia: classificarPA(ultimoComPA),
      fcTendencia: classificarFC(ultimoComFc),
      evac: evacDiarreica ? 'Diarreica' : '',
      antimicrobiano: (atbsPorPac.get(paciente.id) ?? [])
        .map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''})`).join(' · '),
      dva: (dvasPorPac.get(paciente.id) ?? []).map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(' · '),
      corticoide: cuidados?.corticoide_em_uso ? 'Sim' : '',
      ibp: cuidados?.ibp_em_uso
        ? `IBP${cuidados.ibp_via ? ' ' + cuidados.ibp_via : ''}${cuidados.ibp_objetivo === 'terapeutico' ? ` ${cuidados.ibp_frequencia ?? ''} (terapêutico)`.trimEnd() : ''}`
        : '',
      anticoag: cuidados?.anticoag_em_uso
        ? formatarPosologia(
            cuidados.anticoag_droga === 'Outro' ? (cuidados.anticoag_droga_outro ?? 'Outro') : (cuidados.anticoag_droga ?? ''),
            cuidados.anticoag_dose_valor, cuidados.anticoag_dose_unidade, cuidados.anticoag_objetivo, cuidados.anticoag_frequencia)
        : '',
      labs,
      pendencias: [...pendencias.map(p => p.texto), orientacao].filter(Boolean).join(' · '),
    }
    return { paciente, linha }
  })
}

export function agruparPorAla(
  unidade: Unidade, itens: { paciente: Paciente; linha: LinhaPassometro }[],
): SecaoPassometro[] {
  const porAla = new Map<string, LinhaPassometro[]>()
  for (const { paciente, linha } of itens) {
    const grupo = porAla.get(paciente.ala_id)
    if (grupo) grupo.push(linha); else porAla.set(paciente.ala_id, [linha])
  }
  return unidade.alas
    .filter(ala => porAla.has(ala.id))
    .map(ala => ({
      ala,
      linhas: (porAla.get(ala.id) ?? []).sort((a, b) => compararLeitos(a.leito, b.leito)),
    }))
}

// Cada coluna empilha 2-3 sub-campos em linhas dentro da MESMA célula (\n +
// wrapText) — igual ao modelo em papel do Felipe, que também cabe várias
// informações numa coluna estreita. É o que permite uma ala de ~10 leitos
// caber numa A4: poucas colunas largas, não uma coluna por campo.
interface Coluna { label: string; width: number; texto: (l: LinhaPassometro) => string }

const labs = (l: LinhaPassometro, ...keys: string[]) => keys.map(k => l.labs[k] || '').join('/')

const COLUNAS: Coluna[] = [
  { label: 'Leito', width: 6, texto: l => l.leito },
  { label: 'Nome / Idade\nAdmissão', width: 18, texto: l => `${l.nomeCurto} · ${l.idade}\n${l.admissao}` },
  { label: 'Diagnóstico', width: 16, texto: l => l.hd },
  { label: 'Peso\nDiurese 24h\nVia da diurese', width: 14, texto: l => `${l.peso}\n${l.diurese}\n` },
  { label: 'Tipo de acesso\nHidratação\nInsulina NPH/REG/SOS', width: 16, texto: l => `${l.acesso}\n\n` },
  { label: 'Dieta\nHGT', width: 10, texto: l => `\n${l.hgt}` },
  { label: 'Temp.', width: 10, texto: l => l.temp },
  { label: 'Evac.', width: 8, texto: l => l.evac },
  { label: 'Antimicrobiano', width: 16, texto: l => l.antimicrobiano },
  // Deixado em branco de propósito — nomes de psicotrópico/analgesia e
  // anti-hipertensivo vêm de texto livre (Medicações de Uso Contínuo), que o
  // Felipe pediu pra NÃO importar aqui: "deixe em branco, não importe das MUC".
  { label: 'Psicotrópicos\nAnalgesia', width: 12, texto: () => '' },
  { label: 'DVA\nCorticoide', width: 14, texto: l => `${l.dva}\n${l.corticoide}` },
  { label: 'IBP\nAnticoagulante', width: 16, texto: l => `${l.ibp}\n${l.anticoag}` },
  { label: 'Anti-Hipertensivos\nControle de FC', width: 14, texto: l => `\nPA ${l.paTendencia}\nFC ${l.fcTendencia}` },
  { label: 'Leuco\nHb/Ht\nPlaq\nPCR\nLactato', width: 12, texto: l => `${labs(l, 'leuco')}\n${labs(l, 'hb', 'ht')}\n${labs(l, 'plaq')}\n${labs(l, 'pcr')}\n${labs(l, 'lactato')}` },
  { label: 'Ur\nCreat\nNa\nK\nMg', width: 10, texto: l => `${labs(l, 'ureia')}\n${labs(l, 'creat')}\n${labs(l, 'na')}\n${labs(l, 'k')}\n${labs(l, 'mg')}` },
  { label: 'pH\nHCO3\npCO2\npO2\nCai', width: 10, texto: l => `${labs(l, 'ph')}\n${labs(l, 'bic')}\n${labs(l, 'pco2')}\n${labs(l, 'po2')}\n${labs(l, 'ca')}` },
  { label: 'Programações / Pendências / Condutas / Lembretes', width: 30, texto: l => l.pendencias },
]

const COR_GRUPO = 'FFEEF2FF'
const COR_LABEL = 'FFF1F5F9'
const COR_BORDA = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
const BORDA_FINA = { top: COR_BORDA, left: COR_BORDA, bottom: COR_BORDA, right: COR_BORDA }

export function gerarPlanilhaPassometro(unidade: Unidade, secoes: SecaoPassometro[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ProMed'
  wb.created = new Date()
  const ws = wb.addWorksheet('Passômetro', {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: 'landscape', fitToWidth: 1, fitToHeight: 1,
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
    const cabecalhoAla = ws.addRow([`${ala.nome} (${linhas.length} paciente${linhas.length === 1 ? '' : 's'})`])
    cabecalhoAla.font = { bold: true, size: 11 }
    cabecalhoAla.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_GRUPO } } })
    ws.mergeCells(cabecalhoAla.number, 1, cabecalhoAla.number, COLUNAS.length)

    const linhaLabel = ws.addRow(COLUNAS.map(c => c.label))
    linhaLabel.font = { bold: true, size: 8, color: { argb: 'FF475569' } }
    linhaLabel.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    linhaLabel.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_LABEL } }; c.border = BORDA_FINA })
    linhaLabel.height = 42

    for (const linha of linhas) {
      const row = ws.addRow(COLUNAS.map(c => c.texto(linha)))
      row.font = { size: 8 }
      row.alignment = { wrapText: true, vertical: 'top' }
      row.eachCell(c => { c.border = BORDA_FINA })
      row.height = 58
    }
    ws.addRow([])
  }

  return wb
}
