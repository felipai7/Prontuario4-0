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

import type { Matcher, MatchOutcome, ParseContext, Segment, TextLine } from '../contratos'
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

/** Um nome de exame candidato: sem dígito, sem dois-pontos, curto. */
function pareceNomeDeExame(texto: string): boolean {
  const t = texto.trim()
  return t.length >= 2 && !/\d/.test(t) && !t.includes(':') && !ehRotuloDeMetadado(t)
}

export const matcherBloco: Matcher = {
  id: 'bloco',

  applicability(segment: Segment): boolean {
    return segment.kind === 'examSection' || segment.kind === 'eas'
  },

  match(linha: TextLine, segment: Segment, ctx: ParseContext): MatchOutcome {
    if (!RE_LINHA_RESULTADO.test(linha.text)) return { kind: 'noMatch' }

    const posicao = segment.lines.indexOf(linha)
    if (posicao < 0) return { kind: 'noMatch' }

    // ── O nome do exame: a linha-título mais próxima acima ────────────────
    let nome: string | null = null
    for (let i = posicao - 1; i >= 0 && i >= posicao - ALCANCE; i--) {
      const candidato = segment.lines[i]!.text.trim()
      if (!pareceNomeDeExame(candidato)) continue
      if (resolverAnalito(candidato, segment.specimen)) { nome = candidato; break }
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

    // ── A referência: a linha "VALOR DE REFERÊNCIA:" logo abaixo ──────────
    let referenciaBruta = ''
    for (let i = posicao + 1; i < segment.lines.length && i <= posicao + ALCANCE; i++) {
      const abaixo = segment.lines[i]!.text
      // Outra linha de resultado significa que o bloco acabou.
      if (RE_LINHA_RESULTADO.test(abaixo)) break
      if (RE_LINHA_REFERENCIA.test(abaixo)) {
        referenciaBruta = abaixo.replace(RE_LINHA_REFERENCIA, '').trim()
        break
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
