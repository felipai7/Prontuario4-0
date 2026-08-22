import type { SupabaseClient } from '@supabase/supabase-js'
import ExcelJS from 'exceljs'
import type { Ala, Unidade } from '@/lib/unidade'
import { compararLeitos } from '@/lib/unidade'
import { calcAge, diaAtualATB, calcDiurese24h, balancoDaUnidade, hojeISO, ultimoPorTurno } from '@/lib/utils'
import { porPacienteId, dataCurta, formatarRespiracao } from '@/lib/passometro'
import type {
  Paciente, ATB, Dispositivo, PeriodoBalanco, PendenciaIntensivista,
  RegistroIntensivista, SuporteVentilatorio, LppEvento, NutricaoDia,
} from '@/types'

/**
 * Passômetro de Enfermagem — mesma ideia do passômetro do Médico
 * (lib/passometro.ts), mas com colunas e agrupamento por linha física
 * bem diferentes (a pedido do Felipe): em vez de 2 linhas físicas por
 * paciente, aqui são 4 (Ventilatório/Dispositivos/Dieta/Diurese, um item
 * por linha). Por isso vive num arquivo próprio, com seu próprio tipo de
 * linha/coluna — só reaproveita o que é genérico o bastante pra servir os
 * dois (porPacienteId, dataCurta, formatarRespiracao).
 */
export interface LinhaPassometroEnfermagem {
  alaId: string
  vazio: boolean
  leito: string
  nome: string
  idade: string
  admissao: string
  ventilatorio: string
  dispositivos: string
  dieta: string
  diurese: string
  /** LPP (estágio/local) + lista de dispositivos invasivos — o resto da
   *  célula (ela é alta, 4 linhas físicas) fica em branco de propósito
   *  pra anotar o curativo à mão. */
  curativos: string
  antimicrobiano: string
  /** Pendências deixadas pelo médico intensivista (mesma fonte usada no
   *  passômetro do médico: pendências em aberto + última orientação). */
  pendenciasVisita: string
}

export interface SecaoPassometroEnfermagem {
  ala: Ala
  linhas: LinhaPassometroEnfermagem[]
}

function linhaVaziaEnfermagem(alaId: string, leito: string): LinhaPassometroEnfermagem {
  return {
    alaId, vazio: true, leito, nome: '', idade: '', admissao: '',
    ventilatorio: '', dispositivos: '', dieta: '', diurese: '', curativos: '',
    antimicrobiano: '', pendenciasVisita: '',
  }
}

/** Igual ao resumoVias() de NutricaoTab.tsx — só entra o registro do dia de
 *  HOJE; sem lançamento hoje, fica em branco (a nutrição preenche à mão,
 *  mesmo padrão de campo não capturado que o passômetro do médico já usa
 *  noutros lugares). */
export function formatarDieta(dia: NutricaoDia | null): string {
  if (!dia) return ''
  const partes: string[] = []
  if (dia.np_pct_meta != null) partes.push(`NP ${dia.np_pct_meta}%`)
  if (dia.ne_pct_meta != null) partes.push(`NE ${dia.ne_pct_meta}%`)
  if (dia.vo_pct_aceitacao != null) partes.push(`VO ${dia.vo_pct_aceitacao}%`)
  if (dia.jejum) partes.push('Jejum')
  return partes.join(' · ')
}

/** LPP mais recente (estágio + local, quando houver) + lista compacta dos
 *  dispositivos invasivos ativos — o "destacar" pedido pela Enfermagem
 *  antes do espaço em branco pra escrever o curativo à mão. Sem campo de
 *  "resolvida" em lpp_eventos (é um log de evento, não um status), a mais
 *  recente é o melhor proxy de "situação atual". */
export function formatarCurativos(lpps: LppEvento[], dispositivos: Dispositivo[]): string {
  const partes: string[] = []
  if (lpps.length > 0) {
    const maisRecente = [...lpps].sort((a, b) => b.data.localeCompare(a.data))[0]
    partes.push(`⚠️ LPP grau ${maisRecente.estagio}${maisRecente.local ? ` (${maisRecente.local})` : ''}`)
  }
  if (dispositivos.length > 0) {
    partes.push(`⚠️ ${dispositivos.map(d => d.tipo).join(', ')}`)
  }
  return partes.join('\n')
}

export async function buscarDadosPassometroEnfermagem(
  supabase: SupabaseClient, unitId: string, alaId?: string,
): Promise<LinhaPassometroEnfermagem[]> {
  let query = supabase.from('pacientes').select('*').eq('unit_id', unitId).eq('ativo', true)
  if (alaId) query = query.eq('ala_id', alaId)
  const { data: pacientesData } = await query
  const pacientes = (pacientesData ?? []) as Paciente[]
  if (pacientes.length === 0) return []
  const ids = pacientes.map(p => p.id)

  const hoje = hojeISO()
  const [atbsR, dispR, balancoR, pendR, regR, ventR, lppR, nutriR] = await Promise.all([
    supabase.from('atbs').select('*').in('paciente_id', ids).eq('ativo', true),
    // Diferente do passômetro do médico (que só traz acessos vasculares),
    // aqui entra QUALQUER dispositivo ativo — é a Enfermagem quem cuida de
    // todos eles, não só os vasculares.
    supabase.from('dispositivos').select('*').in('paciente_id', ids).is('data_remocao', null),
    supabase.from('periodos_balanco').select('*').in('paciente_id', ids).order('inicio', { ascending: false }),
    supabase.from('pendencias_intensivista').select('*').in('paciente_id', ids).eq('resolvida', false),
    supabase.from('registros_intensivista').select('*').in('paciente_id', ids).order('data', { ascending: false }),
    supabase.from('suportes_ventilatorios').select('*').in('paciente_id', ids),
    supabase.from('lpp_eventos').select('*').in('paciente_id', ids),
    supabase.from('nutricao_dia').select('*').in('paciente_id', ids).eq('data', hoje),
  ])

  const atbsPorPac    = porPacienteId((atbsR.data ?? []) as ATB[])
  const dispPorPac    = porPacienteId((dispR.data ?? []) as Dispositivo[])
  const balancoPorPac = porPacienteId((balancoR.data ?? []) as PeriodoBalanco[])
  const pendPorPac    = porPacienteId((pendR.data ?? []) as PendenciaIntensivista[])
  const regPorPac     = porPacienteId((regR.data ?? []) as RegistroIntensivista[])
  const ventPorPac    = porPacienteId((ventR.data ?? []) as SuporteVentilatorio[])
  const lppPorPac     = porPacienteId((lppR.data ?? []) as LppEvento[])
  const nutriPorPac   = new Map(((nutriR.data ?? []) as NutricaoDia[]).map(n => [n.paciente_id, n]))

  return pacientes.map(paciente => {
    const dispositivos = dispPorPac.get(paciente.id) ?? []
    const periodos      = balancoDaUnidade(balancoPorPac.get(paciente.id) ?? [], paciente.unit_id)
    const pendencias    = pendPorPac.get(paciente.id) ?? []
    const orientacao    = (regPorPac.get(paciente.id) ?? [])[0]?.orientacoes_condutas ?? ''
    const ventAtual     = ultimoPorTurno(ventPorPac.get(paciente.id) ?? [])

    const diurese = calcDiurese24h(periodos)
    const taxaDiurese = diurese.horas > 0 && paciente.peso_kg
      ? `${(diurese.total / paciente.peso_kg / diurese.horas).toFixed(2).replace('.', ',')}mL/Kg/h` : ''
    const svd      = dispositivos.find(d => d.tipo === 'SVD')
    const temCisto = dispositivos.some(d => d.tipo === 'CISTO')
    const viaDiurese = svd ? `SVD ${dataCurta(svd.data_insercao)}` : temCisto ? 'Cistostomia' : 'Espontânea'

    const linha: LinhaPassometroEnfermagem = {
      alaId: paciente.ala_id,
      vazio: false,
      leito: paciente.numero_leito,
      nome: paciente.nome.trim(),
      idade: calcAge(paciente.data_nascimento),
      admissao: dataCurta(paciente.data_internacao),
      ventilatorio: formatarRespiracao(ventAtual),
      dispositivos: dispositivos.map(d => `${d.tipo} (${dataCurta(d.data_insercao)})`).join(', '),
      dieta: formatarDieta(nutriPorPac.get(paciente.id) ?? null),
      diurese: diurese.horas > 0
        ? `${diurese.total}mL(${diurese.horas}h)${taxaDiurese ? ' ' + taxaDiurese : ''} · ${viaDiurese}`
        : viaDiurese,
      curativos: formatarCurativos(lppPorPac.get(paciente.id) ?? [], dispositivos),
      antimicrobiano: (atbsPorPac.get(paciente.id) ?? [])
        .map(a => `${a.droga} (D${diaAtualATB(a)}${a.dias_previstos != null ? `/${a.dias_previstos}` : ''})`).join(' · '),
      pendenciasVisita: [...pendencias.map(p => p.texto), orientacao].filter(Boolean).join(' · '),
    }
    return linha
  })
}

/** Mesmo critério do passômetro do médico: 1 linha por LEITO (ocupado ou
 *  vazio), ala rotativo só aparece com paciente dentro. */
export function agruparPorAlaEnfermagem(alas: Ala[], linhasPacientes: LinhaPassometroEnfermagem[]): SecaoPassometroEnfermagem[] {
  const porLeito = new Map<string, LinhaPassometroEnfermagem>()
  for (const l of linhasPacientes) porLeito.set(`${l.alaId}|${l.leito}`, l)
  return alas
    .filter(ala => !ala.rotativo || ala.leitos.some(cod => porLeito.has(`${ala.id}|${cod}`)))
    .map(ala => ({
      ala,
      linhas: ala.leitos
        .map(cod => porLeito.get(`${ala.id}|${cod}`) ?? linhaVaziaEnfermagem(ala.id, cod))
        .sort((a, b) => compararLeitos(a.leito, b.leito)),
    }))
}

// ── Grade de 4 linhas físicas por paciente ─────────────────────────────────
//
// Cada coluna divide as 4 linhas em "blocos": Leito/Nome/Curativos/
// Pendências ocupam as 4 juntas (1 bloco de 4); a 3ª coluna tem 4 blocos de
// 1 linha cada (Ventilatório/Dispositivos/Dieta/Diurese, rotulados inline
// já que o cabeçalho da coluna não repete por item — mesmo espírito dos
// "Leuco:"/"Hb/Ht:" do passômetro do médico); ATB/BIC é 2 blocos de 2.
// `blocos(l).length` soma sempre 4 linhas (invariante checado pelos testes).
interface BlocoColuna {
  linhas: number
  rotulo?: string
  texto: (l: LinhaPassometroEnfermagem) => string
}
interface ColunaEnf {
  label: string
  width: number
  blocos: (l: LinhaPassometroEnfermagem) => BlocoColuna[]
}

const COLUNAS_ENF: ColunaEnf[] = [
  {
    label: 'Leito', width: 7,
    blocos: l => [{ linhas: 4, texto: () => l.leito }],
  },
  {
    label: 'Nome / Idade / Internação', width: 16,
    blocos: l => [{ linhas: 4, texto: () => `${l.nome}\n${l.idade}\n${l.admissao}` }],
  },
  {
    label: 'Ventilatório / Dispositivos / Dieta / Diurese', width: 30,
    blocos: l => [
      { linhas: 1, rotulo: 'Ventilatório', texto: () => l.ventilatorio },
      { linhas: 1, rotulo: 'Dispositivos', texto: () => l.dispositivos },
      { linhas: 1, rotulo: 'Dieta', texto: () => l.dieta },
      { linhas: 1, rotulo: 'Diurese', texto: () => l.diurese },
    ],
  },
  {
    label: 'Curativos', width: 20,
    blocos: l => [{ linhas: 4, texto: () => l.curativos }],
  },
  {
    label: 'ATB / BIC', width: 16,
    blocos: l => [
      { linhas: 2, rotulo: 'ATB', texto: () => l.antimicrobiano },
      { linhas: 2, rotulo: 'BIC', texto: () => '' },
    ],
  },
  {
    label: 'Pendências da Visita', width: 20,
    blocos: l => [{ linhas: 4, texto: () => l.pendenciasVisita }],
  },
  {
    label: 'Pendências e Programações', width: 20,
    blocos: () => [{ linhas: 4, texto: () => '' }],
  },
]

/** Texto de uma célula (com o rótulo do item na frente, quando houver). */
function textoBloco(b: BlocoColuna, l: LinhaPassometroEnfermagem): string {
  const valor = b.texto(l)
  return b.rotulo ? `${b.rotulo}: ${valor}` : valor
}

/** Pra cada uma das 4 linhas físicas, qual bloco (e se é a linha em que o
 *  texto entra, ou uma linha coberta por mesclagem de um bloco anterior). */
function expandirBlocos(blocos: BlocoColuna[]): { bloco: BlocoColuna; inicio: boolean }[] {
  const linhas: { bloco: BlocoColuna; inicio: boolean }[] = []
  for (const bloco of blocos) {
    for (let i = 0; i < bloco.linhas; i++) linhas.push({ bloco, inicio: i === 0 })
  }
  return linhas
}

const COR_GRUPO = 'FFEEF2FF'
const COR_LABEL = 'FFF1F5F9'
const COR_BORDA = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } }
const BORDA_FINA = { top: COR_BORDA, left: COR_BORDA, bottom: COR_BORDA, right: COR_BORDA }
const COR_BORDA_GROSSA = { style: 'medium' as const, color: { argb: 'FF64748B' } }
const BORDA_ENTRE_PACIENTES = { ...BORDA_FINA, bottom: COR_BORDA_GROSSA }
const ALTURA_LINHA = 20

export function gerarPlanilhaPassometroEnfermagem(unidade: Unidade, secoes: SecaoPassometroEnfermagem[]): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'ProMed'
  wb.created = new Date()
  const ws = wb.addWorksheet('Passômetro Enfermagem', {
    views: [{ showGridLines: false }],
    pageSetup: {
      orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.4, bottom: 0.3, header: 0, footer: 0 },
    },
  })
  ws.columns = COLUNAS_ENF.map(c => ({ width: c.width }))

  const titulo = ws.addRow([`🗒️ Passômetro de Enfermagem — ${unidade.nome}`])
  titulo.getCell(1).font = { bold: true, size: 13 }
  ws.mergeCells(titulo.number, 1, titulo.number, COLUNAS_ENF.length)
  const subtitulo = ws.addRow([`Gerado em ${new Date().toLocaleString('pt-BR')}`])
  subtitulo.getCell(1).font = { italic: true, size: 8, color: { argb: 'FF64748B' } }
  ws.mergeCells(subtitulo.number, 1, subtitulo.number, COLUNAS_ENF.length)

  for (const { ala, linhas } of secoes) {
    const ocupados = linhas.filter(l => !l.vazio).length
    const cabecalhoAla = ws.addRow([`${ala.nome} (${ocupados}/${linhas.length} leitos ocupados)`])
    cabecalhoAla.font = { bold: true, size: 11 }
    cabecalhoAla.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_GRUPO } } })
    ws.mergeCells(cabecalhoAla.number, 1, cabecalhoAla.number, COLUNAS_ENF.length)

    const header = ws.addRow(COLUNAS_ENF.map(c => c.label))
    header.font = { bold: true, size: 8, color: { argb: 'FF475569' } }
    header.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    header.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_LABEL } }; c.border = BORDA_FINA })
    header.height = 26

    for (const linha of linhas) {
      const rows = [1, 2, 3, 4].map(() => ws.addRow(COLUNAS_ENF.map(() => '')))
      for (const r of rows) { r.font = { size: 8 }; r.alignment = { wrapText: true, vertical: 'top' }; r.height = ALTURA_LINHA }

      COLUNAS_ENF.forEach((coluna, colIdx) => {
        const col = colIdx + 1
        const expandido = expandirBlocos(coluna.blocos(linha))
        let i = 0
        while (i < 4) {
          const { bloco, inicio } = expandido[i]
          if (inicio) {
            rows[i].getCell(col).value = textoBloco(bloco, linha)
            if (bloco.linhas > 1) ws.mergeCells(rows[i].number, col, rows[i + bloco.linhas - 1].number, col)
          }
          i++
        }
      })

      for (let i = 0; i < 4; i++) {
        COLUNAS_ENF.forEach((_, colIdx) => {
          rows[i].getCell(colIdx + 1).border = i === 3 ? BORDA_ENTRE_PACIENTES : BORDA_FINA
        })
      }
    }
    ws.addRow([])
  }

  return wb
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const LEITOS_POR_PAGINA = 10

function agruparEmPaginas<T>(itens: T[], tamanho: number): T[][] {
  const paginas: T[][] = []
  for (let i = 0; i < itens.length; i += tamanho) paginas.push(itens.slice(i, i + tamanho))
  return paginas
}

/**
 * Versão HTML pronta pra imprimir na hora, mesma ideia do
 * gerarHtmlPassometro (médico) — inclusive o mesmo CSS/script de
 * ajuste-à-página (ver lib/passometro.ts pro histórico de por que existe
 * cada pedaço dele: título dentro de cada .pagina, largura NATURAL da
 * tabela em vez de já nascer no tamanho da folha, altura mínima nas linhas
 * físicas). Duplicado aqui (não importado) de propósito — muda a estrutura
 * de colunas/blocos por baixo, então mexer nesse CSS/script não deveria
 * arriscar quebrar o passômetro do médico, e vice-versa.
 */
export function gerarHtmlPassometroEnfermagem(unidade: Unidade, secoes: SecaoPassometroEnfermagem[]): string {
  const totalWidth = COLUNAS_ENF.reduce((s, c) => s + c.width, 0)
  const colgroup = COLUNAS_ENF.map(c => `<col style="width:${(c.width / totalWidth * 100).toFixed(2)}%">`).join('')
  const larguraNaturalMm = COLUNAS_ENF.reduce((s, c) => s + (c.width * 7 + 5) * 25.4 / 96, 0)

  const linhaCabecalho = `<tr>${COLUNAS_ENF.map(c => `<th>${escapeHtml(c.label)}</th>`).join('')}</tr>`

  // Cada paciente vira um <tbody> com 4 <tr> — uma por linha física. Uma
  // coluna cujo bloco cobre N linhas ganha rowspan=N só na <tr> em que
  // começa; nas <tr> seguintes cobertas pelo mesmo bloco, a coluna nem
  // aparece (é o que rowspan exige em HTML).
  const linhasParaHtml = (linhas: LinhaPassometroEnfermagem[]) => linhas.map(linha => {
    const porLinhaFisica: string[][] = [[], [], [], []]
    COLUNAS_ENF.forEach(coluna => {
      const expandido = expandirBlocos(coluna.blocos(linha))
      for (let i = 0; i < 4; i++) {
        const { bloco, inicio } = expandido[i]
        if (!inicio) continue
        const attrRowspan = bloco.linhas > 1 ? ` rowspan="${bloco.linhas}"` : ''
        porLinhaFisica[i].push(`<td${attrRowspan}>${escapeHtml(textoBloco(bloco, linha)).replace(/\n/g, '<br>')}</td>`)
      }
    })
    const trs = porLinhaFisica.map((cels, i) => {
      const classe = i === 3 ? ' class="ultima-linha"' : ''
      return `<tr${classe}>${cels.join('')}</tr>`
    }).join('')
    return `<tbody>${trs}</tbody>`
  }).join('')

  const paginasHtml = secoes.flatMap(({ ala, linhas }) => {
    const ocupados = linhas.filter(l => !l.vazio).length
    const blocos = agruparEmPaginas(linhas, LEITOS_POR_PAGINA)
    return blocos.map((bloco, i) => {
      const sufixoPagina = blocos.length > 1 ? ` — página ${i + 1}/${blocos.length}` : ''
      const cabecalhoAla = `<tr><td class="ala" colspan="${COLUNAS_ENF.length}">${escapeHtml(ala.nome)} (${ocupados}/${linhas.length} leitos ocupados)${sufixoPagina}</td></tr>`
      return `<div class="pagina"><div class="pagina-conteudo">
        <h1>🗒️ Passômetro de Enfermagem — ${escapeHtml(unidade.nome)}</h1>
        <p class="subtitulo">Gerado em ${new Date().toLocaleString('pt-BR')}</p>
        <table><colgroup>${colgroup}</colgroup><thead>${cabecalhoAla}${linhaCabecalho}</thead>${linhasParaHtml(bloco)}</table>
      </div></div>`
    })
  }).join('')

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<title>Passômetro de Enfermagem — ${escapeHtml(unidade.nome)}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  * { box-sizing: border-box; }
  html, body { background: #ffffff; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 8pt; margin: 0; color: #0f172a; }
  h1 { font-size: 13pt; margin: 0 0 2px; }
  .subtitulo { font-size: 8pt; color: #64748b; font-style: italic; margin: 0 0 6px; }
  table { border-collapse: collapse; width: ${larguraNaturalMm.toFixed(1)}mm; table-layout: fixed; }
  td, th { border: 1px solid #94a3b8; padding: 2px 3px; vertical-align: top; word-wrap: break-word; }
  th { background: #f1f5f9; font-size: 7.5pt; text-align: center; font-weight: bold; }
  td.ala { background: #eef2ff; font-weight: bold; font-size: 11pt; padding: 4px; }
  .pagina { page-break-after: always; break-after: page; overflow: hidden; }
  .pagina:last-child { page-break-after: auto; break-after: auto; }
  .pagina-conteudo { width: ${larguraNaturalMm.toFixed(1)}mm; transform-origin: top left; }
  .pagina tbody { page-break-inside: avoid; break-inside: avoid; }
  /* Altura mínima nas 4 linhas físicas — mesmo motivo do passômetro do
     médico: sem isso, um leito vazio (quase tudo em branco) fica com
     células colapsadas de tamanhos desiguais. */
  .pagina tbody tr { height: 20pt; }
  .pagina tbody tr.ultima-linha td { border-bottom: 2px solid #475569; }
</style>
</head><body>
  ${paginasHtml}
  <script>
  (function () {
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
      var margem = 2 * ppmm
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
