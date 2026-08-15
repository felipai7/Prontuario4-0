import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * A planta da unidade, lida do banco.
 *
 * Substitui a constante ALAS que vivia em lib/config.ts. Enquanto a planta
 * estava no código, cadastrar uma segunda UTI exigia editar arquivo, buildar e
 * publicar — e as duas unidades nunca poderiam coexistir na mesma instalação.
 * Agora é INSERT nas tabelas `alas` e `leitos` (supabase/multiunidade_1_estrutura.sql).
 */
export interface Ala {
  /** Código curto, o mesmo gravado em pacientes.ala_id (ex.: 'uti-01'). */
  id: string
  nome: string
  /** Códigos dos leitos vigentes hoje, em ordem. Texto: "3" num leito simples, "01A" num código de porta. */
  leitos: string[]
  /** Ala de trânsito (leito suspenso): só recebe por transferência, some do
   *  dashboard quando vazia e fora dos indicadores enquanto o paciente está
   *  nela — ver supabase/registro_unico_transferencia.sql. */
  rotativo: boolean
}

export interface Unidade {
  unitId: string
  nome: string
  alas: Ala[]
  /** Total de leitos vigentes hoje — denominador da taxa de ocupação. */
  leitosAtivos: number
  /** Quantas OUTRAS unidades a pessoa atende. >0 faz o seletor aparecer. */
  outrasUnidades: number
  /** Se falso, a alta nesta unidade não exige SAPS-3 pontuado (ex.: Hospital). */
  requerSaps3: boolean
  /** Decide módulos/rótulos (lib/modules.tsx): 'uti' = 5 módulos de sempre,
   *  'enfermaria' = só Médico + Internos. */
  tipoUnidade: 'uti' | 'enfermaria'
}

/** Formato cru vindo do PostgREST (alas com leitos embutidos). */
interface AlaRow {
  codigo: string
  nome: string
  ordem: number
  rotativo: boolean
  leitos: LeitoRow[]
}

export interface LeitoRow {
  numero: string
  ativo_desde: string
  /** Null = ainda ativo. */
  ativo_ate: string | null
}

/**
 * Compara códigos de leito em ordem "natural": números puros ficam em ordem
 * numérica (não "10" antes de "2"), e o resto cai para comparação de texto —
 * necessário desde que numero_leito virou texto (código de porta, ex. "01A").
 */
export function compararLeitos(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR', { numeric: true, sensitivity: 'base' })
}

/**
 * Códigos dos leitos vigentes numa data, em ordem.
 *
 * Leito com vigência encerrada (reforma, interdição, desativação) some do mapa
 * de hoje — mas continua contando nos leitos-dia dos meses em que existiu.
 * Quem faz essa outra conta é leitos_dia_mes(), no banco: são perguntas
 * diferentes e não podem compartilhar resposta.
 *
 * Datas em ISO (AAAA-MM-DD) comparadas como texto de propósito: nesse formato a
 * ordem lexicográfica é a cronológica, e assim não há fuso horário no meio do
 * caminho para deslocar um leito em um dia.
 */
export function leitosVigentes(leitos: LeitoRow[], hoje: string): string[] {
  return (leitos ?? [])
    .filter(l => l.ativo_desde <= hoje && (l.ativo_ate === null || l.ativo_ate >= hoje))
    .map(l => l.numero)
    .sort(compararLeitos)
}

/** Nome do cookie que guarda a unidade escolhida por quem trabalha em mais de uma. */
export const COOKIE_UNIDADE = 'unidade_ativa'

/**
 * Carrega a unidade do usuário logado e a planta dela.
 *
 * Devolve `null` quando a pessoa não tem vínculo ativo em `staff` — depois do
 * RLS por unidade, esse usuário não enxergaria paciente nenhum de qualquer
 * forma, e é melhor a tela dizer isso do que mostrar um mapa vazio como se a
 * UTI estivesse sem ninguém.
 *
 * `preferida` é a unidade escolhida no seletor (cookie). Se a pessoa não tem
 * vínculo com ela — deixou de ter, ou o cookie veio adulterado —, cai na
 * primeira unidade dela. Nunca confia no cookie para dar acesso: a lista de
 * vínculos vem do banco e o RLS decide o resto.
 *
 * Recebe o client por parâmetro para servir tanto ao servidor quanto ao
 * navegador — o módulo não importa nada de server-only.
 */
export async function carregarUnidade(
  supabase: SupabaseClient,
  userId: string,
  preferida?: string,
): Promise<Unidade | null> {
  const { data: staffRows } = await supabase
    .from('staff')
    .select('unit_id, created_at, units(name, requer_saps3, tipo_unidade)')
    .eq('user_id', userId)
    .eq('active', true)
    // Ordem estável: sem isso, quem trabalha em duas unidades cairia numa ou
    // noutra a cada carregamento, sem explicação.
    .order('created_at')

  type UnitCols = { name: string; requer_saps3: boolean; tipo_unidade: 'uti' | 'enfermaria' }
  type Vinculo = { unit_id: string; units: UnitCols | UnitCols[] | null }
  const vinculos = (staffRows ?? []) as Vinculo[]

  const vinculo = (preferida && vinculos.find(v => v.unit_id === preferida)) || vinculos[0]
  if (!vinculo) return null

  // O PostgREST devolve o relacionamento como objeto ou array conforme a
  // cardinalidade que ele infere do schema; normalizar evita um bug bobo.
  const u = vinculo.units
  const uObj = Array.isArray(u) ? u[0] : u
  const nome = uObj?.name ?? 'Unidade'
  const requerSaps3 = uObj?.requer_saps3 ?? true
  const tipoUnidade = uObj?.tipo_unidade ?? 'uti'

  const { data: alasRows } = await supabase
    .from('alas')
    .select('codigo, nome, ordem, rotativo, leitos(numero, ativo_desde, ativo_ate)')
    .eq('unit_id', vinculo.unit_id)
    .eq('ativa', true)
    .order('ordem')

  const hoje = new Date().toISOString().slice(0, 10)

  const alas: Ala[] = ((alasRows as AlaRow[]) ?? []).map(a => ({
    id: a.codigo,
    nome: a.nome,
    leitos: leitosVigentes(a.leitos, hoje),
    rotativo: a.rotativo,
  }))

  return {
    unitId: vinculo.unit_id,
    nome,
    alas,
    // Ala de trânsito fica fora — mesmo critério de leitos_dia_mes/leitos_ativos
    // no banco (registro_unico_transferencia.sql): sem isso o header mostraria
    // uma ocupação que nunca bate com o indicador oficial.
    leitosAtivos: alas.filter(a => !a.rotativo).reduce((n, a) => n + a.leitos.length, 0),
    outrasUnidades: vinculos.length - 1,
    requerSaps3,
    tipoUnidade,
  }
}

/**
 * Deriva o código da ala a partir do nome digitado: minúsculas, sem acento,
 * separadores viram hífen.
 *
 * Este código é gravado em `pacientes.ala_id` e NUNCA muda depois — renomear a
 * ala troca só o rótulo. Por isso ele precisa ser estável e sem acento: é uma
 * chave, não um texto de tela.
 */
export function normalizarCodigo(texto: string): string {
  return texto.trim().toLowerCase()
    .normalize('NFD').replace(new RegExp('[\\u0300-\\u036f]', 'g'), '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Nome de exibição de uma ala pelo código. Cai no próprio código se não achar. */
export function nomeDaAla(unidade: Unidade | null, alaId: string): string {
  return unidade?.alas.find(a => a.id === alaId)?.nome ?? alaId
}
