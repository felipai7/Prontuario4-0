import type { SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { Ala, Unidade } from '@/lib/unidade'
import { compararLeitos } from '@/lib/unidade'
import { calcAge, fmtData, diaAtualATB, calcDiurese24h, balancoDaUnidade } from '@/lib/utils'
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
  idade: string
  admissao: string
  hd: string
  peso: string
  diurese: string
  acesso: string
  hgt: string
  temp: string
  fc: string
  evac: string
  antimicrobiano: string
  psicotropicos: string
  dva: string
  corticoide: string
  lamgTev: string
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
    supabase.from('dispositivos').select('*').in('paciente_id', ids).is('data_remocao', null).in('tipo', ['CVC', 'PAI', 'CDL']),
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

    const ultimaTemp = sinaisRecente.find(s => s.temperatura != null)
    const ultimoHgt  = sinaisRecente.find(s => s.hgt != null)
    const ultimoFc   = sinaisRecente.find(s => s.fc != null)
    const diurese    = calcDiurese24h(periodos)
    const evacDiarreica = periodos.some(p => p.diarreica_medico || p.diarreica_nutricao)

    const labs: Record<string, string> = {}
    for (const a of ANALITOS_LABS) labs[a.key] = valorLabsMaisRecente(examesOrd, [a.id])
    labs.ca = valorLabsMaisRecente(examesOrd, CA_IONICO_IDS)

    const linha: LinhaPassometro = {
      paciente,
      leito: paciente.numero_leito,
      idade: calcAge(paciente.data_nascimento),
      admissao: `${fmtData(paciente.data_internacao)} ${paciente.hora_internacao ?? ''}`.trim(),
      hd: paciente.hipoteses ?? '',
      peso: paciente.peso_kg != null ? `${paciente.peso_kg} kg` : '',
      diurese: diurese.horas > 0 ? `${diurese.total} mL / ${diurese.horas}h` : '',
      acesso: dispositivos.map(d => d.observacao ? `${d.tipo} (${d.observacao})` : d.tipo).join('; '),
      hgt: ultimoHgt ? `${ultimoHgt.hgt} mg/dL` : '',
      temp: ultimaTemp ? `${ultimaTemp.temperatura}°C` : '',
      fc: ultimoFc ? `${ultimoFc.fc} bpm` : '',
      evac: evacDiarreica ? 'Diarreica' : '',
      antimicrobiano: (atbsPorPac.get(paciente.id) ?? [])
        .map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''})`).join(' · '),
      psicotropicos: cuidados?.opioide_em_uso ? 'Opioide em uso' : '',
      dva: (dvasPorPac.get(paciente.id) ?? []).map(d => `${d.droga} ${d.fluxo_ml_h} mL/h`).join(' · '),
      corticoide: cuidados?.corticoide_em_uso ? 'Sim' : '',
      lamgTev: cuidados?.anticoag_em_uso
        ? `${cuidados.anticoag_droga === 'Outro' ? cuidados.anticoag_droga_outro : cuidados.anticoag_droga} (${cuidados.anticoag_objetivo === 'profilatico' ? 'profilático' : 'terapêutico'})`
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

interface Coluna { grupo: string; label: string; key: string; width: number }

const COLUNAS: Coluna[] = [
  { grupo: 'Leito', label: 'Leito', key: 'leito', width: 8 },
  { grupo: 'Nome / Idade / Admissão', label: 'Nome / Idade', key: 'nomeIdade', width: 22 },
  { grupo: 'Nome / Idade / Admissão', label: 'Admissão', key: 'admissao', width: 14 },
  { grupo: 'HD', label: 'HD', key: 'hd', width: 20 },
  { grupo: 'Peso / Diurese', label: 'Peso', key: 'peso', width: 9 },
  { grupo: 'Peso / Diurese', label: 'Diurese 24h', key: 'diurese', width: 13 },
  { grupo: 'Peso / Diurese', label: 'Via da diurese', key: 'viaDiurese', width: 12 },
  { grupo: 'Acesso / Suporte', label: 'Tipo de acesso', key: 'acesso', width: 18 },
  { grupo: 'Acesso / Suporte', label: 'Hidratação', key: 'hidratacao', width: 12 },
  { grupo: 'Acesso / Suporte', label: 'Insulina\nNPH / REG / SOS', key: 'insulina', width: 12 },
  { grupo: 'Dieta / HGT', label: 'Dieta', key: 'dieta', width: 10 },
  { grupo: 'Dieta / HGT', label: 'HGT', key: 'hgt', width: 10 },
  { grupo: 'Temp.', label: 'Temp.', key: 'temp', width: 8 },
  { grupo: 'Evac.', label: 'Evac.', key: 'evac', width: 10 },
  { grupo: 'Antimicrobiano', label: 'Antimicrobiano', key: 'antimicrobiano', width: 20 },
  { grupo: 'Psicotrópicos / Analgesia', label: 'Psicotrópicos / Analgesia', key: 'psicotropicos', width: 16 },
  { grupo: 'DVA / Corticoide', label: 'DVA', key: 'dva', width: 16 },
  { grupo: 'DVA / Corticoide', label: 'Corticoide', key: 'corticoide', width: 10 },
  { grupo: 'LAMG / TEV', label: 'LAMG / TEV', key: 'lamgTev', width: 16 },
  { grupo: 'Anti-HAS / Controle de FC', label: 'Anti-HAS', key: 'antiHas', width: 10 },
  { grupo: 'Anti-HAS / Controle de FC', label: 'FC', key: 'fc', width: 8 },
  ...ANALITOS_LABS.map(a => ({ grupo: 'Últimos exames laboratoriais relevantes', label: a.label, key: `lab_${a.key}`, width: 9 })),
  { grupo: 'Últimos exames laboratoriais relevantes', label: 'Ca Iônico', key: 'lab_ca', width: 9 },
  { grupo: 'Programações / Solicitações / Pendências', label: 'Programações / Solicitações / Pendências', key: 'pendencias', width: 30 },
]

const COR_GRUPO = 'FFEEF2FF'
const COR_LABEL = 'FFF1F5F9'
const COR_BORDA = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
const BORDA_FINA = { top: COR_BORDA, left: COR_BORDA, bottom: COR_BORDA, right: COR_BORDA }

function celulaLinha(linha: LinhaPassometro, key: string): string {
  switch (key) {
    case 'nomeIdade': return `${linha.paciente.nome} · ${linha.idade}`
    case 'hidratacao': case 'insulina': case 'dieta': case 'antiHas': case 'viaDiurese': return ''
    case 'leito': return linha.leito
    case 'admissao': return linha.admissao
    case 'hd': return linha.hd
    case 'peso': return linha.peso
    case 'diurese': return linha.diurese
    case 'acesso': return linha.acesso
    case 'hgt': return linha.hgt
    case 'temp': return linha.temp
    case 'fc': return linha.fc
    case 'evac': return linha.evac
    case 'antimicrobiano': return linha.antimicrobiano
    case 'psicotropicos': return linha.psicotropicos
    case 'dva': return linha.dva
    case 'corticoide': return linha.corticoide
    case 'lamgTev': return linha.lamgTev
    case 'pendencias': return linha.pendencias
    default:
      if (key.startsWith('lab_')) return linha.labs[key.slice(4)] ?? ''
      return ''
  }
}

export function gerarPlanilhaPassometro(unidade: Unidade, secoes: SecaoPassometro[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ProMed'
  wb.created = new Date()
  const ws = wb.addWorksheet('Passômetro', {
    views: [{ showGridLines: false, state: 'frozen', ySplit: 2 }],
    pageSetup: { orientation: 'landscape', fitToWidth: 1, fitToHeight: 0 },
  })
  ws.columns = COLUNAS.map(c => ({ width: c.width }))

  const titulo = ws.addRow([`🗒️ Passômetro — ${unidade.nome}`])
  titulo.getCell(1).font = { bold: true, size: 14 }
  ws.mergeCells(titulo.number, 1, titulo.number, COLUNAS.length)
  const subtitulo = ws.addRow([`Gerado em ${new Date().toLocaleString('pt-BR')}`])
  subtitulo.getCell(1).font = { italic: true, size: 9, color: { argb: 'FF64748B' } }
  ws.mergeCells(subtitulo.number, 1, subtitulo.number, COLUNAS.length)

  for (const { ala, linhas } of secoes) {
    const cabecalhoAla = ws.addRow([`${ala.nome} (${linhas.length} paciente${linhas.length === 1 ? '' : 's'})`])
    cabecalhoAla.font = { bold: true, size: 12 }
    cabecalhoAla.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_GRUPO } } })
    ws.mergeCells(cabecalhoAla.number, 1, cabecalhoAla.number, COLUNAS.length)

    const linhaGrupo = ws.addRow([])
    const linhaLabel = ws.addRow([])
    let col = 1
    while (col <= COLUNAS.length) {
      const grupo = COLUNAS[col - 1].grupo
      let fim = col
      while (fim < COLUNAS.length && COLUNAS[fim].grupo === grupo) fim++
      if (fim > col) {
        ws.mergeCells(linhaGrupo.number, col, linhaGrupo.number, fim)
        linhaGrupo.getCell(col).value = grupo
        for (let c = col; c <= fim; c++) linhaLabel.getCell(c).value = COLUNAS[c - 1].label
      } else {
        ws.mergeCells(linhaGrupo.number, col, linhaLabel.number, col)
        linhaGrupo.getCell(col).value = COLUNAS[col - 1].label
      }
      col = fim
    }
    for (const r of [linhaGrupo, linhaLabel]) {
      r.font = { bold: true, size: 9, color: { argb: 'FF475569' } }
      r.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
      r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_LABEL } }; c.border = BORDA_FINA })
    }

    for (const linha of linhas) {
      const row = ws.addRow(COLUNAS.map(c => celulaLinha(linha, c.key)))
      row.font = { size: 9 }
      row.alignment = { wrapText: true, vertical: 'top' }
      row.eachCell(c => { c.border = BORDA_FINA })
      row.height = 30
    }
    ws.addRow([])
  }

  return wb
}
