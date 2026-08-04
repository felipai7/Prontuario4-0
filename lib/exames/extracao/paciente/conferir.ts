// ══════════════════════════════════════════════════════════════════════════
// Conferência de paciente — pergunta e veredito, nunca leitura e devolução.
//
// A rota MANDA o nome do paciente da tela. Este módulo DEVOLVE só um veredito.
// O nome que está no laudo não aparece em nenhum campo de saída, não é
// retornado, não é logado: ele não existe fora desta função.
//
// Isso é mais forte que "temos o cuidado de não guardar". É a mesma regra que
// já vale para o texto do laudo (R10): impossível por construção.
//
// AVISA, não bloqueia. Nome de casada, nome abreviado pelo laboratório e
// acento perdido gerariam alarme falso demais para justificar uma trava.
// ══════════════════════════════════════════════════════════════════════════

import type { TextLine, VeredictoPaciente } from '../contratos'

/**
 * Rótulos que introduzem o nome do paciente nos laudos do acervo.
 *
 * "Sr(a):" entra por medição, não por suposição: os quatro laudos HUGO do
 * corpus (o laboratório com mais documentos no acervo) nunca usam "Paciente:"
 * nem "Nome:" — todos usam "Sr(a):". Sem essa variante, `conferirPaciente`
 * devolvia `nomeAusente` em todo laudo HUGO, sempre, não importa o paciente —
 * a fronteira de A-02 ficava fechada só no papel para o laboratório que mais
 * importa.
 */
const ROTULO_NOME = /^\s*(?:paciente|nome(?:\s+do\s+paciente)?|pac\.?|sr\(a\))\s*[.:]\s*(.{3,60})$/i

/** NFD sem acento, maiúsculo, só letras e espaço. */
function normalizar(nome: string): string {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Partículas que não identificam ninguém e atrapalham a comparação. */
const PARTICULAS = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E'])

function partes(nome: string): string[] {
  return normalizar(nome).split(' ').filter(p => p.length > 0 && !PARTICULAS.has(p))
}

/**
 * Duas partes casam quando são iguais, ou quando uma é a inicial da outra —
 * "MARIA D SILVA" no laudo e "Maria das Dores Silva" na tela são a mesma
 * pessoa, e o laboratório abrevia por conta própria.
 */
function casam(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length === 1) return b.startsWith(a)
  if (b.length === 1) return a.startsWith(b)
  return false
}

export function conferirPaciente(
  linhas: readonly TextLine[],
  nomeEsperado: string | null,
): VeredictoPaciente {
  if (!nomeEsperado || partes(nomeEsperado).length === 0) return 'naoPerguntado'

  let doLaudo: string[] | null = null
  for (const linha of linhas) {
    const m = linha.text.match(ROTULO_NOME)
    if (!m) continue
    const p = partes(m[1]!)
    if (p.length >= 2) { doLaudo = p; break }
  }
  if (!doLaudo) return 'nomeAusente'

  const esperado = partes(nomeEsperado)

  // Primeiro e último nome são os que o laboratório nunca omite. Exigir os
  // dois evita casar "Maria Silva" com "Maria Souza", e não exige que o meio
  // esteja completo.
  const primeiroCasa = casam(doLaudo[0]!, esperado[0]!)
  const ultimoCasa = casam(doLaudo[doLaudo.length - 1]!, esperado[esperado.length - 1]!)

  return primeiroCasa && ultimoCasa ? 'confere' : 'naoConfere'
}
