// ══════════════════════════════════════════════════════════════════════════
// Matcher de bloco — o layout do HOC e de outros laudos por exame.
//
//     SÓDIO                              ← o nome, sozinho na linha
//     Método: POTENCIOMETRIA  Material biológico: SORO
//     Resultado   :  154,1   mmol/L      ← o valor, noutra linha
//     VALOR DE REFERÊNCIA: 135,0 A 148,0 mmol/L
//
// D9 é exatamente este caso: no doador, "uma linha de resultado sem exame
// corrente era consumida e sumia". Lá a correção foi registrar em `_discarded`;
// aqui a linha é ligada ao exame a que pertence.
//
// O vínculo é feito olhando as linhas do PRÓPRIO segmento, para trás e para a
// frente — não guardando "exame corrente" numa variável. É a diferença entre
// escopo léxico e estado mutável (R6/R9): dois blocos processados em paralelo
// não têm como se confundir, porque nenhum dos dois escreve em lugar nenhum.
// ══════════════════════════════════════════════════════════════════════════

import type { Matcher, MatchOutcome, ParseContext, Segment, SpecimenContext, TextLine } from '../contratos'
import { separarColunas, separarValorUnidade, pareceReferencia } from './colunas'
import { resolverAnalito } from '../catalogo'
import { ehNaoUsadoClinicamente } from '../normalizadores/valor'
import { ehRotuloDeMetadado } from './metadados'

/** A linha que carrega o valor dentro de um bloco. */
const RE_LINHA_RESULTADO = /^\s*resultados?\s*[:.]/i

/** A linha que carrega a faixa de referência do bloco. */
const RE_LINHA_REFERENCIA = /^\s*valor(?:es)?\s+de\s+refer[êe]ncia\s*[:.]?/i

/** Quantas linhas para trás procurar o nome do exame. */
const ALCANCE = 6

/**
 * Formas sob as quais um título de bloco pode estar no catálogo.
 *
 * Os laudos escrevem o exame por extenso com a sigla entre parênteses —
 * "TEMPO DE TROMBOPLASTINA PARCIAL ATIVADO (TTPA)". O catálogo conhece a
 * sigla, não a frase. Testar só o texto inteiro perdia o bloco todo.
 */
function variantesDeNome(texto: string): string[] {
  let t = texto.trim()
  // O Núcleo escreve o NOME do exame como valor de um rótulo:
  // "Exame: CREATININA". Sem desembrulhar, o candidato a título é "Exame:",
  // que é metadado — e o bloco inteiro ficava órfão.
  const rotulado = t.match(/^Exames?\s*[.:]+\s*(.+)$/i)
  if (rotulado) t = rotulado[1]!.trim()
  const variantes = [t]
  const sigla = t.match(/\(([^)]{2,12})\)\s*$/)
  if (sigla) {
    variantes.push(sigla[1]!.trim())
    variantes.push(t.replace(/\s*\([^)]*\)\s*$/, '').trim())
  }
  // "DOSAGEM DE X" é o exame escrito por extenso, e a maioria já tem sinônimo
  // próprio no catálogo — mas nem todos ("DOSAGEM DE GAMA GT" não tem,
  // só "GAMA GT" tem). Não é para o catálogo GANHAR uma entrada por causa
  // disso: precisaria de uma entrada "DOSAGEM DE X" por exame, para sempre.
  // Mais barato ensinar aqui, no mesmo lugar que já desembrulha "(SIGLA)" e
  // "Exame: X" — é a mesma ideia, "o mesmo exame escrito de outro jeito".
  const semPrefixo = t.match(/^Dosagem\s+de\s+(.+)$/i)
  if (semPrefixo) variantes.push(semPrefixo[1]!.trim())
  return variantes.filter(Boolean)
}

/**
 * Um nome de exame candidato: sem dígito, sem dois-pontos.
 *
 * O limite de comprimento da guarda de metadado (42 caracteres, feito para
 * separar rótulo de prosa) reprova títulos legítimos como o do TTPA, que tem
 * 46. Por isso a guarda é dispensada quando ALGUMA variante do nome resolve no
 * catálogo: constar do vocabulário clínico é evidência mais forte do que o
 * comprimento da linha.
 */
function pareceNomeDeExame(texto: string, especime: SpecimenContext): boolean {
  const t = texto.trim()
  if (t.length < 2 || /\d/.test(t)) return false
  // Dois-pontos desqualifica, EXCETO no rótulo "Exame: <NOME>", que é como o
  // Núcleo apresenta o título do bloco.
  if (t.includes(':') && !/^Exames?\s*[.:]/i.test(t)) return false
  if (variantesDeNome(t).some(v => resolverAnalito(v, especime))) return true
  return !ehRotuloDeMetadado(t)
}

export const matcherBloco: Matcher = {
  id: 'bloco',

  applicability(segment: Segment): boolean {
    // `culture` entra: o que o extrator de culturas consumiu já foi retirado
    // antes de chegar aqui, e o que sobra é resultado comum que por acaso caiu
    // depois de um cabeçalho de cultura.
    return segment.kind === 'examSection' || segment.kind === 'eas' || segment.kind === 'culture'
  },

  match(linha: TextLine, segment: Segment, ctx: ParseContext): MatchOutcome {
    if (!RE_LINHA_RESULTADO.test(linha.text)) return { kind: 'noMatch' }

    const posicao = segment.lines.indexOf(linha)
    if (posicao < 0) return { kind: 'noMatch' }

    // ── O nome do exame: a linha-título mais próxima acima ────────────────
    //
    // A candidata é sempre a PRIMEIRA COLUNA da linha, nunca a linha inteira
    // colada. No HUGO o título do bloco divide a linha física com o
    // cabeçalho da coluna de referência — "DOSAGEM DE AMILASE   Valores de
    // Referência" — e testar a linha inteira nunca resolve no catálogo (a
    // comparação é exata, sem aparar sufixo). `segmentar.ts` já precisou
    // cortar a mesma linha pelo mesmo motivo para fechar o segmento history
    // (`pareceTituloDeSecao`); aqui é o mesmo corte GEOMÉTRICO de
    // `separarColunas` — não uma terceira variante da mesma ideia.
    let nome: string | null = null
    for (let i = posicao - 1; i >= 0 && i >= posicao - ALCANCE; i--) {
      const candidato = (separarColunas(segment.lines[i]!)[0]?.texto ?? '').trim()
      if (!pareceNomeDeExame(candidato, segment.specimen)) continue
      const reconhecida = variantesDeNome(candidato)
        .find(v => resolverAnalito(v, segment.specimen))
      if (reconhecida) { nome = reconhecida; break }
      // Um título que o catálogo não conhece ainda vale como nome: quem decide
      // se o exame é reconhecido é a etapa seguinte, com registro.
      if (nome === null) nome = candidato
    }

    if (nome === null) {
      // R1/D9 — linha de resultado órfã. No doador ela sumia.
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'noValueFound',
          detail: 'linha de resultado sem exame identificável acima',
        }],
      }
    }

    // ── O valor: o que vem depois do rótulo "Resultado:" ──────────────────
    //
    // Dois formatos, conforme o vão que o laudo usa:
    //   HOC    "Resultado   :   154,1   mmol/L"  → valor em coluna própria
    //   PIOX   "Resultado: 35  mg/dL"            → rótulo e valor COLADOS
    //
    // Descartar a primeira coluna sempre — que era o que eu fazia — jogava
    // fora o valor no segundo caso, e a ureia de 35 mg/dL virava "mg/dL".
    const colunas = separarColunas(linha).map(c => c.texto)
    // Os dois-pontos podem já ter virado coluna própria e sido filtrados, de
    // modo que a coluna 0 fica só "Resultado". Por isso o rótulo é removido com
    // a pontuação OPCIONAL — senão o próprio rótulo virava o valor.
    const restoDoRotulo = (colunas[0] ?? '')
      .replace(/^\s*resultados?\s*[:.]*\s*/i, '')
      .trim()
    const depoisDoRotulo = [
      ...(restoDoRotulo ? [restoDoRotulo] : []),
      ...colunas.slice(1).map(c => c.replace(/^[:.\s]+/, '').trim()),
    ].filter(Boolean)
    if (depoisDoRotulo.length === 0) return { kind: 'noMatch' }

    const { valor: valorBruto, unidade: unidadeColada } = separarValorUnidade(depoisDoRotulo[0]!)
    let unidadeBruta = unidadeColada || depoisDoRotulo[1] || ''

    // ── A referência: MESMA linha primeiro, "VALOR DE REFERÊNCIA:" abaixo depois ──
    //
    // O HUGO traz a faixa como MAIS UMA coluna da própria linha de resultado —
    // "Resultado: 135 U/L   0 - 110 U/L", duas colunas geométricas — sem
    // nenhuma linha "VALOR DE REFERÊNCIA:" separada. O que sobra de
    // `depoisDoRotulo` depois de tirar valor e (se coladas) unidade é onde essa
    // faixa mora; sem isto ela ficava lida e depois jogada fora sem uso.
    const restante = unidadeColada ? depoisDoRotulo.slice(1) : depoisDoRotulo.slice(2)
    let referenciaBruta = restante.find(pareceReferencia) ?? ''

    // O HOC, ao contrário, traz a faixa numa linha PRÓPRIA logo abaixo.
    if (!referenciaBruta) {
      for (let i = posicao + 1; i < segment.lines.length && i <= posicao + ALCANCE; i++) {
        const abaixo = segment.lines[i]!.text
        // Outra linha de resultado significa que o bloco acabou.
        if (RE_LINHA_RESULTADO.test(abaixo)) break
        if (RE_LINHA_REFERENCIA.test(abaixo)) {
          referenciaBruta = abaixo.replace(RE_LINHA_REFERENCIA, '').trim()
          break
        }
      }
    }
    // A faixa costuma trazer a unidade colada ("135,0 A 148,0 mmol/L"); ela
    // serve de unidade quando a linha de resultado não trouxe nenhuma.
    if (!unidadeBruta && referenciaBruta) {
      const cauda = referenciaBruta.match(/[\d,.]\s*([A-Za-zµ%/³²]+(?:\/[A-Za-zµ³²]+)?)\s*$/)
      if (cauda) unidadeBruta = cauda[1]!
    }

    if (ehNaoUsadoClinicamente(valorBruto)) {
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'notUsedClinically',
          detail: `${nome}: resultado de imunidade não é importado`,
        }],
      }
    }

    const analito = resolverAnalito(nome, segment.specimen)
    if (!analito) {
      return {
        kind: 'discarded',
        items: [{
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          reason: 'unrecognizedAnalyte',
          detail: nome,
        }],
      }
    }

    return {
      kind: 'observations',
      observations: [{
        rawName: nome,
        rawValue: valorBruto,
        rawUnit: unidadeBruta,
        rawReference: pareceReferencia(referenciaBruta) ? referenciaBruta : '',
        specimen: analito.defaultSpecimen,
        date: segment.date,
        provenance: {
          page: linha.page,
          lineIndex: linha.index,
          rawLine: ctx.options.retainRawText ? linha.text : '',
          matcherId: matcherBloco.id,
          profileId: ctx.profile.id,
          fallbackUsed: false,
        },
      }],
    }
  },
}
