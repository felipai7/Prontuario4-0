// ══════════════════════════════════════════════════════════════════════════
// Camada 4 · segmentação: linhas → blocos tipados, com escopo de espécime e
// de data.
//
// R6 — o espécime é escopo LÉXICO. No clinBoard, o contexto de gasometria era
// uma global de módulo (`_currentGasoContext`) e vazava para o upload seguinte,
// renomeando eletrólitos de OUTRO paciente. A correção D1 o transformou em
// variável local. Aqui ele é campo do segmento: não existe onde vazar.
//
// R7/D6 — cada segmento carrega sua própria data, com a trava do doador: o
// carimbo por seção só entra em ação quando o documento tem DUAS OU MAIS datas
// de coleta distintas. Com zero ou uma, todo mundo recebe a data do documento,
// e o comportamento é idêntico ao de antes — foi o que permitiu ligar a
// funcionalidade sem risco de regressão em massa.
// ══════════════════════════════════════════════════════════════════════════

import type { DocumentText, LabProfile, Segment, SpecimenContext, TemporalRef, TextLine } from '../contratos'
import { diaDe, marcadorDeColeta, SEM_DATA } from '../normalizadores/data'
import { separarColunas } from '../extratores/colunas'

/** Cabeçalhos que provam o espécime da seção que se inicia. */
const CABECALHOS: [RegExp, SpecimenContext | null, Segment['kind']][] = [
  [/GASOMETRIA\s+ARTERIAL/i, 'arterialBlood', 'examSection'],
  [/GASOMETRIA\s+VENOSA/i, 'venousBlood', 'examSection'],
  [/\bGASOMETRIA\b/i, 'arterialBlood', 'examSection'],
  [/ROTINA\s+DE\s+L[IÍ]QUOR|L[IÍ]QUOR|\bLCR\b/i, 'csf', 'examSection'],
  // "URINA PARCIAL" faltava, e a consequência foi a pior encontrada no
  // projeto: sem abrir a seção de urina, o pH URINÁRIO de 6,0 continuava no
  // escopo da gasometria venosa aberta antes e era gravado como pH venoso —
  // que seria acidose grave num paciente com gasometria normal. R6 depende
  // desta lista estar completa.
  [/\bEAS\b|ROTINA\s+DE\s+URINA|URIN[AÁ]LISE|ELEMENTOS\s+ANORMAIS|URINA\s+(PARCIAL|ROTINA|TIPO\s*I)|PARCIAL\s+DE\s+URINA|SUMARIO\s+DE\s+URINA|SEDIMENTOSCOPIA/i, 'urine', 'eas'],
  [/UROCULTURA|HEMOCULTURA|CULTURA\s+DE/i, 'unknown', 'culture'],
  [/ANTIBIOGRAMA|TESTE\s+DE\s+SENSIBILIDADE/i, 'unknown', 'antibiogram'],
  [/HEMOGRAMA|ERITROGRAMA|ERITOGRAMA|LEUCOGRAMA|PLAQUETOGRAMA/i, 'blood', 'examSection'],
  // Tabela de resultados anteriores impressa pelo próprio laudo. Abre um
  // segmento que nenhum matcher alcança — ver Segment['kind'] no contrato.
  [/EVOLU[ÇC][ÃA]O\s+DO\s+PACIENTE|HIST[ÓO]RICO\s+DE\s+RESULTADOS|RESULTADOS\s+ANTERIORES/i, null, 'history'],
  // Subseções NEUTRAS: não provam espécime. O que fazer com elas — voltar a
  // sangue ou manter o material vigente — é decisão do perfil.
  [/COAGULOGRAMA|BIOQU[IÍ]MICA|SOROLOGIA|IMUNOLOGIA|CITOMETRIA|CITOLOGIA|EXAME\s+(MICROSC[ÓO]PICO|QU[IÍ]MICO|F[IÍ]SICO|BIOQU[IÍ]MICO)|CARACTERES\s+F[IÍ]SICOS/i, null, 'examSection'],
]

/** Espécime declarado pelo próprio laudo — a prova que R6 aceita sem ressalva. */
function especimeDeclarado(texto: string): SpecimenContext | null {
  const m = texto.match(/Material(?:\s+biol[óo]gico)?[.\s]*:\s*([^|/]{2,40})/i)
  if (!m) return null
  const alvo = m[1]!.toUpperCase()
  if (/L[IÍ]QUOR|LCR|L[IÍ]QUIDO\s+C[EÉ]FALO/.test(alvo)) return 'csf'
  if (/URINA/.test(alvo)) return 'urine'
  if (/SANGUE\s+ARTERIAL/.test(alvo)) return 'arterialBlood'
  if (/SORO|PLASMA|SANGUE/.test(alvo)) return 'blood'
  if (/FEZES/.test(alvo)) return 'stool'
  return null
}

/** Uma linha é cabeçalho de seção quando casa e não traz valor junto. */
function cabecalhoDe(linha: TextLine): { specimen: SpecimenContext | null; kind: Segment['kind'] } | null {
  const texto = linha.text.trim()
  // Um cabeçalho não tem número de resultado colado nele. "Glicose 92" não é
  // cabeçalho de bioquímica só por conter a palavra.
  if (texto.length > 60) return null
  for (const [re, specimen, kind] of CABECALHOS) {
    if (re.test(texto)) return { specimen, kind }
  }
  return null
}

/**
 * Fecha a boca do segmento `history` — ver nota longa no contrato.
 *
 * `CABECALHOS` não pode listar "DOSAGEM DE AMILASE", "DOSAGEM DE CREATININA"
 * e toda a lista de exames de um laudo: são títulos de EXAME, não de SEÇÃO,
 * e a lista cresceria sem fim. Sem este limite, um segmento `history` que
 * abre em "Evolução do paciente" só fecha no próximo cabeçalho DA LISTA —
 * e no HUGO isso nunca acontece, então o segmento engole o resto do laudo
 * (medido: 328 linhas dentro de um único segmento history no corpus real).
 *
 * A forma de um título de exame não depende de reconhecer o nome, e é medida
 * em DOIS lugares diferentes da mesma linha:
 *
 * 1. Maiúscula pura só na PRIMEIRA COLUNA. No HUGO o título vem colado ao
 *    cabeçalho da coluna vizinha na mesma linha física — "DOSAGEM DE AMILASE
 *    Valores de Referência" — e "Valores de Referência" tem letra minúscula.
 *    A rodada 1 desta correção testou a linha INTEIRA, a segunda coluna
 *    reprovava sempre, e nenhum segmento fechava no corpus real. Usa o mesmo
 *    corte de coluna do matcher tabular (`separarColunas`, vão geométrico)
 *    para não reinventar onde fica a fronteira.
 *
 * 2. Nenhum dígito na LINHA INTEIRA. Título de exame não traz número; linha
 *    de resultado traz. Sem esta parte, uma linha da PRÓPRIA tabela de
 *    evolução cujo analito é sigla maiúscula ("TGO", "PCR", "RNI") fechava o
 *    segmento history no meio da tabela, e todas as linhas seguintes dela
 *    voltavam a virar resultado de agora — exatamente o defeito que esta
 *    tarefa existe para matar. Medido no HUGO2: duas tabelas de evolução
 *    vazando por siglas.
 */
function pareceTituloDeSecao(linha: TextLine): boolean {
  if (/\d/.test(linha.text)) return false
  const primeiraColuna = separarColunas(linha)[0]?.texto ?? ''
  const t = primeiraColuna.trim()
  if (t.length === 0 || t.length > 60) return false
  return /[A-ZÀ-Ú]/.test(t) && !/[a-zà-ú]/.test(t)
}

/**
 * Divide o documento em segmentos tipados.
 *
 * A data do documento é a PRIMEIRA marcada como coleta; quando há duas ou mais
 * datas distintas, cada segmento passa a carregar a sua.
 */
export function segmentar(
  texto: DocumentText,
  perfil: LabProfile | null = null,
): { segments: Segment[]; documentDate: TemporalRef } {
  // Regras de bloco de referência vêm do PERFIL (A3). Sem perfil reconhecido,
  // nenhuma se aplica — que é o comportamento seguro: ler a mais e depois
  // descartar é reversível; deixar de ler não é.
  const blocos = (perfil?.referenceBlocks ?? []).map(r => ({
    abre: new RegExp(r.open, 'i'),
    fecha: new RegExp(r.close, 'i'),
  }))
  const herdam = new Set<SpecimenContext>(perfil?.specimen?.inherit ?? [])
  const usaMaterial = perfil?.specimen?.fromMaterialLine ?? false
  // ── Primeira passada: todas as datas de coleta e onde elas aparecem ──────
  const marcasPorLinha = new Map<number, TemporalRef>()
  const diasDistintos = new Set<string>()
  for (const linha of texto.lines) {
    const marca = marcadorDeColeta(linha.text)
    if (!marca) continue
    marcasPorLinha.set(linha.index, marca)
    const dia = diaDe(marca)
    if (dia) diasDistintos.add(dia)
  }

  const primeira = [...marcasPorLinha.values()][0]
  const dataDocumento: TemporalRef = primeira ?? SEM_DATA
  // A trava do D6: com 0 ou 1 data, o carimbo por seção não entra em ação.
  const carimbarPorSecao = diasDistintos.size >= 2

  // ── Segunda passada: corta em seções e propaga os escopos ────────────────
  const segments: Segment[] = []
  let atual: Segment | null = null
  let especimeCorrente: SpecimenContext = 'blood'
  let dataCorrente: TemporalRef = dataDocumento

  function abrir(titulo: string | null, specimen: SpecimenContext, kind: Segment['kind']): Segment {
    const novo: Segment = {
      kind,
      title: titulo,
      lines: [],
      specimen,
      date: carimbarPorSecao ? dataCorrente : dataDocumento,
    }
    segments.push(novo)
    return novo
  }

  // Local à função, como a correção D1 exige do contexto de gasometria: não
  // existe onde vazar para a próxima extração.
  let emBlocoDeReferencia = false

  for (const linha of texto.lines) {
    if (emBlocoDeReferencia) {
      if (blocos.some(b => b.fecha.test(linha.text))) emBlocoDeReferencia = false
      else continue
    } else if (blocos.some(b => b.abre.test(linha.text))) {
      emBlocoDeReferencia = true
      continue
    }

    if (usaMaterial) {
      const declarado = especimeDeclarado(linha.text)
      if (declarado) {
        especimeCorrente = declarado
        if (atual) atual.specimen = declarado
      }
    }

    // Marcador de data vale a partir daqui — inclusive para a seção ABERTA,
    // porque em vários laudos o "Coleta:" da urina vem DEPOIS do cabeçalho da
    // própria seção. Sem isso o EAS herdava a data da seção anterior e os
    // mesmos parâmetros duplicavam em duas datas.
    const marca = marcasPorLinha.get(linha.index)
    if (marca) {
      dataCorrente = marca
      if (atual && carimbarPorSecao && atual.lines.every(l => !temValor(l))) {
        atual.date = marca
      }
    }

    const cabecalho = cabecalhoDe(linha)
    if (cabecalho) {
      if (cabecalho.specimen !== null) {
        especimeCorrente = cabecalho.specimen
      } else if (!herdam.has(especimeCorrente)) {
        // Subseção neutra num laboratório que não declara herança: volta ao
        // padrão, que é o comportamento conservador.
        especimeCorrente = 'blood'
      }
      atual = abrir(linha.text.trim(), especimeCorrente, cabecalho.kind)
      continue
    }

    // Fronteira do segmento history — ver `pareceTituloDeSecao`. Uma linha
    // com cara de título de exame fecha a tabela de evolução mesmo sem estar
    // em CABECALHOS: sem isto, "DOSAGEM DE AMILASE" (e tudo depois) ficava
    // soterrado dentro do segmento history e era descartado por engano.
    //
    // Sem `continue`: a linha fecha o history E CONTINUA sendo conteúdo do
    // segmento novo. Um cabeçalho de CABECALHOS é consumido como título
    // porque a lista garante que ali não há resultado; aqui a linha é
    // reconhecida pela FORMA, e engoli-la faria duas coisas erradas — some
    // sem descarte (viola R1) e some do alcance dos matchers. Medido: com o
    // `continue`, 12 linhas do corpus real deixavam de ser lidas por esta
    // tarefa, que não é a dona desse assunto.
    if (atual?.kind === 'history' && pareceTituloDeSecao(linha)) {
      if (!herdam.has(especimeCorrente)) especimeCorrente = 'blood'
      atual = abrir(linha.text.trim(), especimeCorrente, 'examSection')
    }

    if (atual === null) atual = abrir(null, especimeCorrente, 'examSection')
    atual.lines.push(linha)
  }

  return { segments, documentDate: dataDocumento }
}

/** Aproximação barata de "esta linha traz resultado", só para o carimbo de data. */
function temValor(linha: TextLine): boolean {
  return /\d/.test(linha.text) && !marcadorDeColeta(linha.text)
}
