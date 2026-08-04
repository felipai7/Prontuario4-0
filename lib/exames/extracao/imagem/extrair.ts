// ══════════════════════════════════════════════════════════════════════════
// Camada 5d · laudos de imagem.
//
// Escopo menor e independente do laboratorial, com uma exigência própria:
// NENHUM TEXTO SE PERDE. Um laudo cuja conclusão não foi reconhecida e sumiu é
// pior do que um laudo sem seção nenhuma — o médico que lê o resumo acha que
// leu tudo. Tudo que não couber em seção reconhecida vai para `unsectionedText`.
//
// Duas armadilhas do formato, ambas observadas no corpus:
//
//   • A ORDEM de detecção de modalidade importa. "TOMOGRAFIA POR EMISSÃO" é
//     PET, não tomografia; "ECODOPPLERCARDIOGRAMA" contém DOPPLER mas é
//     ecocardiograma. PET e eco são testados antes de TC e US.
//
//   • O rodapé (assinatura, CRM, endereço do portal) se repete e aparece NO
//     MEIO do documento em laudos multipágina. A conclusão costuma vir DEPOIS
//     do primeiro rodapé — truncar ali perderia justamente a conclusão. Por
//     isso o ruído é filtrado linha a linha, nunca por corte.
// ══════════════════════════════════════════════════════════════════════════

import type {
  DiscardedItem, DocumentText, ExtractionOptions, ImagingReport, Modality, TemporalRef, TextLine,
} from '../contratos'
import imagem from '../catalogo/imagem.json'
import { marcadorDeColeta, dataSolta } from '../normalizadores/data'

const MODALIDADES = imagem.modalities.map(m => ({
  code: m.code as Modality,
  re: new RegExp(m.pattern, m.flags),
}))

/**
 * Palavras que identificam a linha-título do exame.
 *
 * `\bPET\b` com fronteira de palavra NÃO é decoração: sem ela, "PET" casa
 * dentro de "re-PET-ido", e a linha "Nota: EXAME REPETIDO E CONFIRMADO." de um
 * laudo LABORATORIAL virava um laudo de imagem inteiro, com o documento
 * classificado como `mixed`. Mesma família do D2: padrão não ancorado
 * capturando texto que só se parece com o alvo.
 *
 * Apareceu ao rodar o extrator contra um laudo de cada laboratório, não na
 * suíte — nenhuma fixture sintética tinha a palavra "repetido".
 */
const RE_TITULO =
  /TOMOGRAFIA|ANGIOTOMOGRAFIA|RESS?ON|ANGIORR?ESS?ON|ULTRASSON|ULTRA[-\s]?SOM|RADIOGRAFIA|RAIO[-\s]?X|ECOCARDIOGRA|ECODOPPLER|D[ÚU]PLEX|MAPEAMENTO|DOPPLER|ENDOSCOPIA|COLONOSCOPIA|CINTILOGRAFIA|ESCANOMETRIA|\bPET\b|COLANGIORR/i

/** Metadados que nunca são título, ainda que contenham a palavra. */
const RE_NAO_TITULO =
  /INDICA|HIST[ÓO]RICO|T[ÉE]CNICA|M[ÉE]TODO|^\s*NOME\b|DATA\s+DO\s+EXAME|SOLICITA|\bM[ÉE]D\b|\bCRM\b|NASCIMENTO|^\s*(?:Nota|Obs|Observa)/i

/**
 * Ruído repetido por página: cabeçalho do paciente, assinatura do radiologista,
 * rodapé do portal. Filtrado LINHA A LINHA.
 */
const RE_RUIDO =
  /^\s*(?:Nome|Data\s+do\s+exame|M[ée]d\.?\s*Solicitante|ID|Idade|Conv[êe]nio|Paciente|RG|CPF|Sexo|DRA?\.\s|DR\(A\)|MEMBRO\s+TITULAR|COL[ÉE]GIO\s+BRASILEIRO|SOCIEDADE\s+BRASILEIRA|CRM[\s:/]|RQE[\s:/]|Acesse\s+seu\s+exame|Documento\s+assinad|Assinad[oa]\s+eletronic|P[áa]gina\s+\d|https?:|www\.)/i

// Cabeçalhos de seção, ancorados no início da linha.
//
// O `(?::|$)` no fim NÃO é decoração. Sem ele, a frase "Achados compatíveis com
// processo infeccioso." — prosa que começa com a palavra "Achados" — abria a
// seção de achados e ainda engolia a primeira palavra da frase. É a mesma
// família do D2: expressão não ancorada capturando texto que só se PARECE com
// o rótulo. Um cabeçalho vem seguido de dois-pontos ou sozinho na linha; uma
// frase, não.
function secao(palavras: string): RegExp {
  return new RegExp(`^\\s*(?:${palavras})\\s*(?::|$)`, 'i')
}

const SECOES: [keyof ImagingReport['sections'], RegExp][] = [
  ['indication', secao('INDICA[ÇC][ÃA]O|HIST[ÓO]RICO(?:\\s+CL[ÍI]NICO)?|INFORMA[ÇC][ÕO]ES?\\s+CL[ÍI]NICAS?|DADOS\\s+CL[ÍI]NICOS|QUADRO\\s+CL[ÍI]NICO')],
  ['technique', secao('T[ÉE]CNICA(?:\\s+D[OE]\\s+EXAME)?|M[ÉE]TODO|PROTOCOLO')],
  // Os primeiros são cabeçalhos; os últimos são frases de abertura que os
  // laudos em prosa usam no lugar de um cabeçalho. Todos foram observados no
  // corpus — nenhum é suposição.
  ['findings', secao('ACHADOS|AN[ÁA]LISE|DESCRI[ÇC][ÃA]O|RELAT[ÓO]RIO|INTERPRETA[ÇC][ÃA]O|EXAME\\s+COMPARATIVO|Os\\s+seguintes\\s+aspectos\\s+foram\\s+observados|Ao\\s+exame|[ÀA]\\s+an[áa]lise|Observamos')],
  ['conclusion', secao('CONCLUS[ÃA]O|IMPRESS[ÃA]O(?:\\s+DIAGN[ÓO]STICA)?|OPINI[ÃA]O|HIP[ÓO]TESE\\s+DIAGN[ÓO]STICA|PARECER|S[ÍI]NTESE')],
]

/** Data de realização do exame, com marcador próprio de imagem. */
const RE_DATA_EXAME =
  /(?:Data\s+(?:do\s+)?(?:exame|estudo|realiza[çc][ãa]o)|Realizad[oa]\s+em|Data\s+do\s+laudo|Emiss[ãa]o)\s*:?\s*(\d{2}\/\d{2}\/\d{4})(?:\s+(\d{2}:\d{2}))?/i

export function detectarModalidade(texto: string): Modality {
  for (const { code, re } of MODALIDADES) if (re.test(texto)) return code
  return 'other'
}

function tituloDe(linhas: TextLine[]): string {
  for (const linha of linhas) {
    const t = linha.text.trim()
    if (t.length < 6 || t.length > 100) continue
    if (!RE_TITULO.test(t) || RE_NAO_TITULO.test(t)) continue
    return t.replace(/\s*:\s*$/, '').replace(/\s{2,}/g, ' ').trim()
  }
  return ''
}

/** Região anatômica: o que vem depois de "DE/DO/DA" no título. */
function regiaoDe(titulo: string): string | null {
  const m = titulo.match(/\b(?:DE|DO|DA|DOS|DAS)\s+(.{3,40})$/i)
  return m ? m[1]!.trim() : null
}

function dataDe(linhas: TextLine[]): TemporalRef {
  for (const linha of linhas) {
    const m = linha.text.match(RE_DATA_EXAME)
    if (m) {
      const [, d, h] = m
      const [dia, mes, ano] = d!.split('/')
      return {
        iso: h ? `${ano}-${mes}-${dia}T${h}` : `${ano}-${mes}-${dia}`,
        hasTime: Boolean(h),
        source: 'collectionMarker',
        raw: m[0],
      }
    }
  }
  // Sem marcador próprio, tenta o vocabulário de coleta; depois, proximidade.
  for (const linha of linhas) {
    const marca = marcadorDeColeta(linha.text)
    if (marca) return marca
  }
  for (const linha of linhas) {
    const solta = dataSolta(linha.text, 'proximity')
    if (solta) return solta
  }
  return { iso: null, hasTime: false, source: 'absent', raw: '' }
}

function limpar(partes: string[]): string | null {
  const texto = partes.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  return texto.length > 0 ? texto : null
}

/**
 * Extrai o laudo de imagem, se o documento for um.
 *
 * Devolve lista vazia quando não há título de imagem reconhecível — este
 * extrator não opina sobre laudo laboratorial.
 */
export function extrairImagem(
  texto: DocumentText,
  opcoes: Readonly<ExtractionOptions>,
  profileId: string,
): { imaging: ImagingReport[]; discarded: DiscardedItem[] } {
  const titulo = tituloDe(texto.lines)
  if (!titulo) return { imaging: [], discarded: [] }

  const secoes: Record<keyof ImagingReport['sections'], string[]> = {
    indication: [], technique: [], findings: [], conclusion: [],
  }
  const soltas: string[] = []
  const descartadas: DiscardedItem[] = []
  let atual: keyof ImagingReport['sections'] | null = null

  for (const linha of texto.lines) {
    const t = linha.text.trim()
    if (!t) continue

    // Ruído: registrado como descarte, para o total continuar auditável, mas
    // fora do corpo do laudo.
    if (RE_RUIDO.test(t)) {
      descartadas.push({
        page: linha.page,
        lineIndex: linha.index,
        rawLine: opcoes.retainRawText ? t : '',
        reason: 'headerOrFooter',
        detail: 'cabeçalho, assinatura ou rodapé do laudo de imagem',
      })
      continue
    }

    // A própria linha do título não entra no corpo.
    if (t === titulo) { atual = null; continue }

    let abriuSecao = false
    for (const [chave, re] of SECOES) {
      if (!re.test(t)) continue
      atual = chave
      const resto = t.replace(re, '').trim()
      if (resto) secoes[chave].push(resto)
      abriuSecao = true
      break
    }
    if (abriuSecao) continue

    if (atual) secoes[atual].push(t)
    // R1 — o que não coube em seção NÃO some. Vai para unsectionedText, que é
    // onde vive a conclusão de um laudo que não usa cabeçalho de conclusão.
    else soltas.push(t)
  }

  const laudo: ImagingReport = {
    modality: detectarModalidade(titulo),
    title: titulo,
    bodyRegion: regiaoDe(titulo),
    performedAt: dataDe(texto.lines),
    sections: {
      indication: limpar(secoes.indication),
      technique: limpar(secoes.technique),
      findings: limpar(secoes.findings),
      conclusion: limpar(secoes.conclusion),
    },
    unsectionedText: limpar(soltas),
    provenance: {
      page: texto.lines[0]?.page ?? 1,
      lineIndex: texto.lines[0]?.index ?? 0,
      rawLine: opcoes.retainRawText ? titulo : '',
      matcherId: 'imagem',
      profileId,
      fallbackUsed: false,
    },
  }

  return { imaging: [laudo], discarded: descartadas }
}
