// ══════════════════════════════════════════════════════════════════════════
// Integridade da camada de texto.
//
// Nem todo PDF com camada de texto tem uma camada de texto CONFIÁVEL. Um dos
// laudos do corpus sai assim:
//
//     䌀唀䰀吀唀刀䄀 ⬀ 䄀一吀䤀䈀䤀伀䜀刀䄀䴀䄀
//     匀瘀洀最戀ⴀ吀猀樀渀昀甀瀀爀猀樀渀   䤀
//
// São dois estragos somados: os bytes estão em UTF-16 com a ordem trocada, e a
// fonte usa codificação própria em que as MINÚSCULAS estão deslocadas uma
// posição — "Sulfa-Trimetoprim" vira "Svmgb-Tsjnfuprsjn". As maiúsculas passam
// intactas, o que é o pior dos mundos: "ANTIBIOGRAMA" e as letras S/I/R saem
// certas, e só o NOME do antibiótico vem errado.
//
// Um antibiograma com a interpretação certa no antibiótico errado é o pior
// resultado possível deste módulo — parece certo e gera conduta. R1 manda
// recusar. O documento resolve para `unrecognized`, com aviso, e fica
// disponível para o caminho de OCR/IA da A5.
// ══════════════════════════════════════════════════════════════════════════

import type { DocumentText } from '../contratos'

/**
 * Faixas que um laudo em português NUNCA usa.
 *
 * CJK aparece quando bytes UTF-16 são lidos com a ordem trocada: o par
 * 0x00 0x45 ("E") vira U+4500. Área de uso privado e substitutos indicam fonte
 * sem mapa ToUnicode.
 */
const FORA_DO_ESPERADO =
  /[⺀-鿿ꀀ-꯿가-퟿-￰-￿]/

/** Proporção de caracteres impossíveis a partir da qual o texto é lixo. */
const TOLERANCIA = 0.02

export interface Integridade {
  confiavel: boolean
  /** Proporção de caracteres fora do esperado, 0..1. */
  proporcaoIlegivel: number
  /** Índice da primeira linha problemática, para a procedência. */
  primeiraLinha: number | null
}

/**
 * Avalia se o texto extraído é utilizável.
 *
 * Deliberadamente conservador em uma direção só: prefere marcar como suspeito
 * um documento estranho a deixar passar um documento corrompido.
 */
export function avaliarIntegridade(texto: DocumentText): Integridade {
  let total = 0
  let ilegiveis = 0
  let primeiraLinha: number | null = null

  for (const linha of texto.lines) {
    for (const caractere of linha.text) {
      total++
      if (FORA_DO_ESPERADO.test(caractere)) {
        ilegiveis++
        if (primeiraLinha === null) primeiraLinha = linha.index
      }
    }
  }

  if (total === 0) return { confiavel: true, proporcaoIlegivel: 0, primeiraLinha: null }
  const proporcao = ilegiveis / total
  return {
    confiavel: proporcao <= TOLERANCIA,
    proporcaoIlegivel: proporcao,
    primeiraLinha,
  }
}
