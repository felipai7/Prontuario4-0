// ══════════════════════════════════════════════════════════════════════════
// Grupos clínicos dos exames — o dado que a TELA consulta.
//
// A que grupo cada exame pertence, e em que ordem os grupos aparecem, é
// decisão clínica: revisada exame por exame pela Juliana em 03/08/2026, sobre
// os 285 analitos do catálogo. Vive em `extracao/catalogo/grupos.json`.
//
// Antes disso o agrupamento era doze expressões regulares dentro do
// componente da tela, testadas contra o nome exibido. Bastava o extrator mudar
// um nome para o exame trocar de grupo sem aviso — e foi assim que o sedimento
// urinário passou a aparecer dentro do hemograma, e o pH urinário dentro da
// gasometria.
//
// Este módulo existe separado de `extracao/catalogo/index.ts` porque quem mais
// o consome é componente de cliente: importar o catálogo inteiro mandaria
// 145 KB de JSON para o navegador, e o índice de grupos tem 10 KB.
//
// NÃO é o extrator que usa isto. Agrupar é apresentação, e R3 mantém o
// extrator sem opinião sobre apresentação.
// ══════════════════════════════════════════════════════════════════════════

import gruposJson from './extracao/catalogo/grupos.json'

/** Mesma normalização do catálogo: NFC, maiúsculo, espaços colapsados. */
function chave(nome: string): string {
  return nome.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim()
}

const POR_NOME = gruposJson.byName as Record<string, string>

/** Os grupos na ordem de exibição decidida clinicamente. */
export function gruposEmOrdem(): readonly string[] {
  return gruposJson.order
}

/**
 * Grupo de um exame pelo nome exibido, ou `null` se ele não estiver no
 * catálogo.
 *
 * O null é esperado e não é falha: acontece com registros antigos gravados
 * pela IA e com os antimicrobianos do antibiograma, que não são analitos.
 * Quem chama decide o que fazer com ele — aqui não se chuta um grupo.
 */
export function grupoDoNome(nome: string): string | null {
  return POR_NOME[chave(nome)] ?? null
}

const NOME_POR_CHAVE = gruposJson.nameByKey as Record<string, string>

/**
 * A grafia canônica de um exame, ou `null` se ele não estiver no catálogo.
 *
 * Serve para a tela não tratar "Pesquisa De Fungos (LCR)" e
 * "Pesquisa de Fungos (LCR)" como dois exames. A busca ignora caixa e acento
 * de espaçamento; o que volta é sempre a grafia do catálogo.
 */
export function nomeCanonico(nome: string): string | null {
  return NOME_POR_CHAVE[chave(nome)] ?? null
}
