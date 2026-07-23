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
  /** Números dos leitos vigentes hoje, em ordem. */
  leitos: number[]
}

export interface Unidade {
  unitId: string
  nome: string
  alas: Ala[]
  /** Total de leitos vigentes hoje — denominador da taxa de ocupação. */
  leitosAtivos: number
}

/** Formato cru vindo do PostgREST (alas com leitos embutidos). */
interface AlaRow {
  codigo: string
  nome: string
  ordem: number
  leitos: LeitoRow[]
}

export interface LeitoRow {
  numero: number
  ativo_desde: string
  /** Null = ainda ativo. */
  ativo_ate: string | null
}

/**
 * Números dos leitos vigentes numa data, em ordem.
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
export function leitosVigentes(leitos: LeitoRow[], hoje: string): number[] {
  return (leitos ?? [])
    .filter(l => l.ativo_desde <= hoje && (l.ativo_ate === null || l.ativo_ate >= hoje))
    .map(l => l.numero)
    .sort((x, y) => x - y)
}

/**
 * Carrega a unidade do usuário logado e a planta dela.
 *
 * Devolve `null` quando a pessoa não tem vínculo ativo em `staff` — depois do
 * RLS por unidade, esse usuário não enxergaria paciente nenhum de qualquer
 * forma, e é melhor a tela dizer isso do que mostrar um mapa vazio como se a
 * UTI estivesse sem ninguém.
 *
 * Recebe o client por parâmetro para servir tanto ao servidor quanto ao
 * navegador — o módulo não importa nada de server-only.
 */
export async function carregarUnidade(
  supabase: SupabaseClient,
  userId: string,
): Promise<Unidade | null> {
  const { data: staffRows } = await supabase
    .from('staff')
    .select('unit_id, units(name)')
    .eq('user_id', userId)
    .eq('active', true)
    .limit(1)

  const vinculo = (staffRows ?? [])[0] as
    | { unit_id: string; units: { name: string } | { name: string }[] | null }
    | undefined
  if (!vinculo) return null

  // O PostgREST devolve o relacionamento como objeto ou array conforme a
  // cardinalidade que ele infere do schema; normalizar evita um bug bobo.
  const u = vinculo.units
  const nome = (Array.isArray(u) ? u[0]?.name : u?.name) ?? 'Unidade'

  const { data: alasRows } = await supabase
    .from('alas')
    .select('codigo, nome, ordem, leitos(numero, ativo_desde, ativo_ate)')
    .eq('unit_id', vinculo.unit_id)
    .eq('ativa', true)
    .order('ordem')

  const hoje = new Date().toISOString().slice(0, 10)

  const alas: Ala[] = ((alasRows as AlaRow[]) ?? []).map(a => ({
    id: a.codigo,
    nome: a.nome,
    leitos: leitosVigentes(a.leitos, hoje),
  }))

  return {
    unitId: vinculo.unit_id,
    nome,
    alas,
    leitosAtivos: alas.reduce((n, a) => n + a.leitos.length, 0),
  }
}

/** Nome de exibição de uma ala pelo código. Cai no próprio código se não achar. */
export function nomeDaAla(unidade: Unidade | null, alaId: string): string {
  return unidade?.alas.find(a => a.id === alaId)?.nome ?? alaId
}
