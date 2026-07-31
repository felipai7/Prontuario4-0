// ══════════════════════════════════════════════════════════════════════════
// Gerador de PDF mínimo para os testes.
//
// Existe porque 7.B-11 é um dos resíduos que este módulo não pode herdar: no
// clinBoard, a suíte sintética alimenta TEXTO direto ao parser, então a camada
// de extração geométrica nunca é exercitada. Aqui as fixtures sintéticas são
// PDFs de verdade, com bytes válidos, geometria real e xref correto.
//
// Nenhum dado de paciente. Todo conteúdo é fictício e escrito à mão.
//
// Na F2 este arquivo vira a base de `scripts/fixtures-sinteticas.mjs`, que
// gera os PDFs versionáveis a partir de layouts declarados.
// ══════════════════════════════════════════════════════════════════════════

export interface LinhaPdf {
  texto: string
  /** Coordenadas em pontos, origem no canto inferior esquerdo (padrão PDF). */
  x: number
  y: number
  tamanho: number
}

export interface PaginaPdf {
  linhas: LinhaPdf[]
}

const LARGURA = 595
const ALTURA = 842

/** Escapa os três caracteres com significado dentro de uma string literal PDF. */
function escapar(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function fluxoDaPagina(pagina: PaginaPdf): string {
  const partes = pagina.linhas.map(
    l => `BT /F1 ${l.tamanho} Tf ${l.x} ${l.y} Td (${escapar(l.texto)}) Tj ET`,
  )
  return partes.join('\n')
}

/**
 * Monta um PDF válido de N páginas com as linhas dadas.
 *
 * Determinístico: nenhuma data de criação, nenhum id aleatório. Duas chamadas
 * com a mesma entrada devolvem bytes idênticos — é o que permite usar o hash
 * do documento como chave estável nos testes (R8).
 */
export function construirPdf(paginas: PaginaPdf[]): Uint8Array {
  if (paginas.length === 0) throw new Error('construirPdf exige ao menos uma página')

  const objetos: string[] = []
  // 1 = Catalog, 2 = Pages, 3 = Font; páginas e fluxos vêm depois.
  const primeiraPagina = 4
  const idsPaginas = paginas.map((_, i) => primeiraPagina + i * 2)
  const idsFluxos = paginas.map((_, i) => primeiraPagina + i * 2 + 1)

  objetos[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  objetos[2] = `<< /Type /Pages /Kids [${idsPaginas.map(id => `${id} 0 R`).join(' ')}] /Count ${paginas.length} >>`
  objetos[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'

  paginas.forEach((pagina, i) => {
    const fluxo = fluxoDaPagina(pagina)
    objetos[idsPaginas[i]] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${idsFluxos[i]} 0 R >>`
    objetos[idsFluxos[i]] =
      `<< /Length ${Buffer.byteLength(fluxo, 'latin1')} >>\nstream\n${fluxo}\nendstream`
  })

  let pdf = '%PDF-1.4\n'
  const deslocamentos: number[] = []
  for (let id = 1; id < objetos.length; id++) {
    deslocamentos[id] = Buffer.byteLength(pdf, 'latin1')
    pdf += `${id} 0 obj\n${objetos[id]}\nendobj\n`
  }

  const inicioXref = Buffer.byteLength(pdf, 'latin1')
  const total = objetos.length // objetos.length - 1 objetos + a entrada livre 0
  pdf += `xref\n0 ${total}\n0000000000 65535 f \n`
  for (let id = 1; id < objetos.length; id++) {
    pdf += `${String(deslocamentos[id]).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`

  return new Uint8Array(Buffer.from(pdf, 'latin1'))
}

/** Atalho: uma página, linhas empilhadas de cima para baixo. */
export function pdfDeLinhas(linhas: string[], tamanho = 11): Uint8Array {
  return construirPdf([
    {
      linhas: linhas.map((texto, i) => ({
        texto,
        x: 50,
        y: ALTURA - 60 - i * (tamanho + 4),
        tamanho,
      })),
    },
  ])
}
