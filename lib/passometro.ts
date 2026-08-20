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
  alaId: string
  /** Leito sem paciente ativo — mostra só o código do leito, o resto em
   *  branco (pedido do Felipe: "gere as linhas dos leitos vazios também"). */
  vazio: boolean
  leito: string
  nomeCurto: string
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
  temp: string
  /** Classificação rápida da última PA/FC — "↑ hipertenso", "→ normal" etc.,
   *  pedido do Felipe: "resumo visual... pra já saber quem tá taqui ou
   *  bradicárdico, hipo ou hipertenso" — não é o valor bruto, é a leitura. */
  paTendencia: string
  fcTendencia: string
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
  labs: Record<string, string>
  pendencias: string
  previsaoAlta: string
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

// Só o valor, sem unidade (mmol, mg/dL...) — a coluna já deixa claro o que é
// cada marcador (rótulo impresso), a unidade só ocupava espaço à toa.
function valorLabsMaisRecente(examesOrdenados: Exame[], ids: string[]): string {
  for (const exame of examesOrdenados) {
    for (const r of exame.resultados ?? []) {
      if (r.analito_id && ids.includes(r.analito_id)) return r.valor
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

/** "2026-08-16" -> "16/08" — ano e hora não importam pro passômetro do dia,
 *  só atrapalham a leitura rápida (vale pra admissão e previsão de alta). */
function dataCurta(dataISO: string): string {
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

const DIAS_CONSTIPACAO = 3

/**
 * Quantas vezes e em que dia o paciente evacuou pela última vez — soma por
 * DIA (um período diurno + um noturno do mesmo dia contam juntos), marca
 * diarreica se algum período daquele dia foi flagado, e sinaliza
 * constipação (>= 3 dias sem evacuar, contando da admissão se nunca
 * evacuou) pro destaque visual na planilha.
 */
function ultimaEvacuacao(periodos: PeriodoBalanco[], dataInternacao: string): { texto: string; constipado: boolean } {
  const porDia = new Map<string, { qtd: number; diarreica: boolean; data: Date }>()
  for (const p of periodos) {
    const data = new Date(p.inicio)
    const chave = data.toDateString()
    const atual = porDia.get(chave) ?? { qtd: 0, diarreica: false, data }
    atual.qtd += p.evacuacao
    if (p.diarreica_medico || p.diarreica_nutricao) atual.diarreica = true
    porDia.set(chave, atual)
  }
  const diasComEvac = [...porDia.values()].filter(d => d.qtd > 0).sort((a, b) => b.data.getTime() - a.data.getTime())
  const diasDesde = (data: Date) => Math.floor((Date.now() - data.getTime()) / 86400000)

  if (diasComEvac.length === 0) {
    const desde = diasDesde(new Date(dataInternacao + 'T00:00:00'))
    return { texto: 'Não desde admissão', constipado: desde >= DIAS_CONSTIPACAO }
  }
  const ultimo = diasComEvac[0]
  // Formata pela data LOCAL do Date (não toISOString, que é UTC e pode
  // virar o dia perto da meia-noite num fuso atrás de UTC como o nosso).
  const dataLocal = `${String(ultimo.data.getDate()).padStart(2, '0')}/${String(ultimo.data.getMonth() + 1).padStart(2, '0')}`
  const texto = `${ultimo.qtd}x ${dataLocal}${ultimo.diarreica ? ' - diarreica' : ''}`
  return { texto, constipado: diasDesde(ultimo.data) >= DIAS_CONSTIPACAO }
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
): Promise<LinhaPassometro[]> {
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
    supabase.from('dispositivos').select('*').in('paciente_id', ids).is('data_remocao', null).in('tipo', ['AVP', 'CVC', 'PAI', 'CDL', 'SVD', 'CISTO']),
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

    // Temp.: diurno/noturno separados (2 aferições por turno, não só a mais
    // recente geral). HGT é diferente — ela anota TODAS as aferições
    // disponíveis no dia, não uma por turno (pode ser 2, pode ser mais).
    const tempDiurno  = sinaisRecente.find(s => s.turno === 'diurno' && s.temperatura != null)
    const tempNoturno = sinaisRecente.find(s => s.turno === 'noturno' && s.temperatura != null)
    const hoje = new Date().toDateString()
    const hgtHoje = sinaisRecente
      .filter(s => s.hgt != null && new Date(s.horario).toDateString() === hoje)
      .sort((a, b) => new Date(a.horario).getTime() - new Date(b.horario).getTime())
      .map(s => s.hgt)
    const ultimoComPA = sinaisRecente.find(s => s.pas != null || s.pam != null)
    const ultimoComFc = sinaisRecente.find(s => s.fc != null)
    const diurese    = calcDiurese24h(periodos)
    const taxaDiurese = diurese.horas > 0 && paciente.peso_kg
      ? `${(diurese.total / paciente.peso_kg / diurese.horas).toFixed(2).replace('.', ',')}mL/Kg/h` : ''
    const { texto: evacTexto, constipado: evacConstipado } = ultimaEvacuacao(periodos, paciente.data_internacao)
    const temSVD   = dispositivos.some(d => d.tipo === 'SVD')
    const temCisto = dispositivos.some(d => d.tipo === 'CISTO')
    const viaDiurese = temSVD ? 'SVD' : temCisto ? 'Cistostomia' : 'Espontânea'
    const acessoVascular = dispositivos.filter(d => d.tipo === 'AVP' || d.tipo === 'CVC' || d.tipo === 'PAI' || d.tipo === 'CDL')

    const labs: Record<string, string> = {}
    for (const a of ANALITOS_LABS) labs[a.key] = valorLabsMaisRecente(examesOrd, [a.id])
    labs.ca = valorLabsMaisRecente(examesOrd, CA_IONICO_IDS)

    const linha: LinhaPassometro = {
      alaId: paciente.ala_id,
      vazio: false,
      leito: paciente.numero_leito,
      nomeCurto: primeiroUltimoNome(paciente.nome),
      idade: calcAge(paciente.data_nascimento),
      admissao: dataCurta(paciente.data_internacao),
      hd: paciente.hipoteses ?? '',
      peso: paciente.peso_kg != null ? `${paciente.peso_kg}Kg` : '',
      diurese: diurese.horas > 0 ? `${diurese.total}mL(${diurese.horas}h)${taxaDiurese ? ' ' + taxaDiurese : ''}` : '',
      viaDiurese,
      acesso: acessoVascular.map(d => d.observacao ? `${d.tipo} (${d.observacao})` : d.tipo).join('; '),
      hgt: hgtHoje.join('/'),
      temp: [tempDiurno?.temperatura, tempNoturno?.temperatura].filter(v => v != null).join(' / '),
      paTendencia: classificarPA(ultimoComPA),
      fcTendencia: classificarFC(ultimoComFc),
      evac: evacTexto,
      evacConstipado,
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
      previsaoAlta: cuidados?.previsao_alta ? dataCurta(cuidados.previsao_alta) : '',
    }
    return linha
  })
}

function linhaVazia(alaId: string, leito: string): LinhaPassometro {
  return {
    alaId, vazio: true, leito, nomeCurto: '', idade: '', admissao: '', hd: '', peso: '', diurese: '',
    viaDiurese: '', acesso: '', hgt: '', temp: '', paTendencia: '', fcTendencia: '', evac: '',
    evacConstipado: false, antimicrobiano: '', dva: '', corticoide: '', ibp: '', anticoag: '',
    labs: {}, pendencias: '', previsaoAlta: '',
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
// várias linhas de texto dentro da célula mesclada); as 4 colunas que
// sempre têm 2 itens distintos por paciente (psicotrópico/analgesia,
// DVA/corticoide, IBP/anticoagulante, anti-HAS/controle de FC) NÃO mesclam:
// `texto` cai na 1ª linha física, `texto2` na 2ª — cada item na própria
// linha, sem espremer os dois num \n só.
interface Coluna {
  label: string
  width: number
  texto: (l: LinhaPassometro) => string
  texto2?: (l: LinhaPassometro) => string
  /** Sobrepõe a fonte padrão da célula — pra destacar algo condicionalmente
   *  (Evac. em constipação) ou dar mais espaço a um campo central (Nome).
   *  `null` = mantém a fonte padrão daquela linha. */
  fonte?: (l: LinhaPassometro) => Partial<ExcelJS.Font> | null
  /** Colunas com o mesmo `grupoCabecalho` mesclam o CABEÇALHO num título só
   *  (as células de dado continuam separadas) — usado nos 3 blocos de
   *  exames, que sozinhos cortavam o nome de cada marcador. */
  grupoCabecalho?: string
}

const labs = (l: LinhaPassometro, ...keys: string[]) => keys.map(k => l.labs[k] || '').join('/')

const COLUNAS: Coluna[] = [
  { label: 'Leito', width: 5, texto: l => l.leito },
  {
    label: 'Nome/Idade\nAdmissão', width: 15, texto: l => `${l.nomeCurto}\n${l.idade}\n${l.admissao}`,
    fonte: () => ({ size: 9 }),
  },
  { label: 'Diagnóstico', width: 13, texto: l => l.hd },
  { label: 'Peso\nDiurese\nVia', width: 12, texto: l => `${l.peso}\n${l.diurese}\n${l.viaDiurese}` },
  // 2 linhas físicas: de cima fica em branco (acesso venoso + hidratação são
  // preenchidos à mão), de baixo já vem o roteiro de insulina pré-impresso —
  // igual à planilha em branco que o Felipe mandou como modelo.
  { label: 'Acesso/Hidrat./Insulina', width: 15, texto: () => '', texto2: () => 'NPH:      REG:      SOS:' },
  { label: 'Dieta\nHGT', width: 9, texto: l => `\n${l.hgt}` },
  { label: 'Temp.', width: 8, texto: l => l.temp },
  {
    label: 'Evac.', width: 10, texto: l => l.evac,
    fonte: l => l.evacConstipado ? { bold: true, color: { argb: 'FFDC2626' } } : null,
  },
  { label: 'Antimicrob.', width: 13, texto: l => l.antimicrobiano },
  // Em branco de propósito nas duas linhas — psicotrópico/analgesia e o nome
  // do anti-hipertensivo vêm de texto livre (Medicações de Uso Contínuo),
  // que o Felipe pediu pra NÃO importar: "deixe em branco, não importe das MUC".
  { label: 'Psicotróp./Analgesia', width: 10, texto: () => '', texto2: () => '' },
  { label: 'DVA/Corticoide', width: 11, texto: l => l.dva, texto2: l => l.corticoide },
  { label: 'IBP/Anticoag.', width: 12, texto: l => l.ibp, texto2: l => l.anticoag },
  { label: 'Anti-HAS/FC', width: 11, texto: l => `PA ${l.paTendencia}`, texto2: l => `FC ${l.fcTendencia}` },
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
  { label: 'Previsão de Alta', width: 8, texto: l => l.previsaoAlta },
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

    const linhaLabel = ws.addRow(COLUNAS.map(c => c.label))
    linhaLabel.font = { bold: true, size: 8, color: { argb: 'FF475569' } }
    linhaLabel.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }
    linhaLabel.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR_LABEL } }; c.border = BORDA_FINA })
    linhaLabel.height = 42

    // Colunas consecutivas com o mesmo `grupoCabecalho` mesclam o cabeçalho
    // num título só (as células de dado abaixo continuam separadas).
    for (let col = 1; col <= COLUNAS.length;) {
      const grupo = COLUNAS[col - 1].grupoCabecalho
      if (!grupo) { col++; continue }
      let fim = col
      while (fim < COLUNAS.length && COLUNAS[fim].grupoCabecalho === grupo) fim++
      ws.mergeCells(linhaLabel.number, col, linhaLabel.number, fim)
      linhaLabel.getCell(col).value = grupo
      col = fim + 1
    }

    for (const linha of linhas) {
      // 2 linhas físicas por paciente: colunas sem `texto2` mesclam as duas
      // (1 valor, possivelmente multi-linha via \n); as com `texto2` ficam
      // sem mesclar — 1 item em cada linha física. Leito vazio usa a MESMA
      // altura de um ocupado — é onde o Felipe anota à mão uma admissão
      // nova antes de passar pro app, precisa de espaço de verdade.
      const rowA = ws.addRow(COLUNAS.map(c => c.texto(linha)))
      const rowB = ws.addRow(COLUNAS.map(c => c.texto2?.(linha) ?? ''))
      for (const r of [rowA, rowB]) {
        r.font = { size: 8, color: linha.vazio ? { argb: 'FFCBD5E1' } : undefined }
        r.alignment = { wrapText: true, vertical: 'top' }
        r.height = 27
        if (linha.vazio) r.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } } })
      }
      COLUNAS.forEach((c, i) => {
        const col = i + 1
        if (!c.texto2) ws.mergeCells(rowA.number, col, rowB.number, col)
        rowA.getCell(col).border = BORDA_FINA
        rowB.getCell(col).border = BORDA_FINA
        const fonte = c.fonte?.(linha)
        if (fonte) {
          rowA.getCell(col).font = { ...rowA.font, ...fonte }
          rowB.getCell(col).font = { ...rowB.font, ...fonte }
        }
      })
    }
    ws.addRow([])
  }

  return wb
}
