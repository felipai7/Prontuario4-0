import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// ══════════════════════════════════════════════════════════════════════════
// Testes ESTRUTURAIS do módulo.
//
// Não exercitam comportamento: leem o próprio fonte e afirmam propriedades que
// nenhum teste de caso conseguiria garantir. São a tradução em código das
// regras que, no clinBoard, dependiam de disciplina — e que por isso quebraram
// (D1 global vazando, 7.B-6 três globais sobrevivendo, 7.B-7 parser chamando
// toast, 7.B-15 quatro cópias da heurística de recorte).
// ══════════════════════════════════════════════════════════════════════════

const RAIZ_MODULO = join(process.cwd(), 'lib', 'exames', 'extracao')
const RAIZ_REPO = process.cwd()

function arquivosTs(dir: string): string[] {
  const saida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) {
      saida.push(...arquivosTs(caminho))
    } else if (entrada.endsWith('.ts') && !entrada.endsWith('.test.ts')) {
      saida.push(caminho)
    }
  }
  return saida
}

/** Remove comentários de linha e de bloco, para não acusar o texto explicativo. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const FONTES = arquivosTs(RAIZ_MODULO).map(caminho => ({
  caminho: relative(RAIZ_REPO, caminho),
  codigo: semComentarios(readFileSync(caminho, 'utf8')),
}))

describe('estrutura do módulo', () => {
  it('há fontes para inspecionar (a suíte não pode passar por vacuidade)', () => {
    // 7.B-10: zero caso executado é falha, não sucesso.
    expect(FONTES.length).toBeGreaterThanOrEqual(3)
  })

  it('R10 · nenhum console.* em lugar nenhum do módulo', () => {
    const infratores = FONTES.filter(f => /\bconsole\s*\./.test(f.codigo)).map(f => f.caminho)
    expect(infratores).toEqual([])
  })

  it('A7 · o módulo não fala com o usuário', () => {
    const infratores = FONTES.filter(f =>
      /\b(toast|alert|showToast|notify)\s*\(/.test(f.codigo),
    ).map(f => f.caminho)
    expect(infratores).toEqual([])
  })

  it('R8 · nada de Date.now, new Date() sem argumento ou Math.random', () => {
    const infratores = FONTES.filter(f =>
      /Date\s*\.\s*now\s*\(|Math\s*\.\s*random\s*\(|new\s+Date\s*\(\s*\)/.test(f.codigo),
    ).map(f => f.caminho)
    expect(infratores).toEqual([])
  })

  it('R9/7.B-6 · nenhum estado mutável no topo de módulo', () => {
    const infratores: string[] = []
    for (const f of FONTES) {
      f.codigo.split('\n').forEach((linha, i) => {
        // `let`/`var` na coluna 0 = escopo de módulo. Dentro de função vem indentado.
        if (/^(let|var)\s/.test(linha)) infratores.push(`${f.caminho}:${i + 1}`)
      })
    }
    expect(infratores).toEqual([])
  })

  it('R3 · o extrator não importa nem define interpretação clínica', () => {
    const infratores = FONTES.filter(f =>
      /\b(getStatus|calcularStatus|interpretar|classificarValor)\s*[(<]/.test(f.codigo),
    ).map(f => f.caminho)
    expect(infratores).toEqual([])
  })
})

// ── 7.B-10 · piso de cobertura declarado ───────────────────────────────────
// No clinBoard, apagar um bloco inteiro do arquivo sintético reduzia a suíte
// de 71 para 60 checagens sem falhar nada. Aqui a contagem é afirmada: remover
// testes quebra o build, e aumentar o piso é uma edição consciente.
const CHECAGENS_MINIMAS = 108

function arquivosDeTeste(dir: string): string[] {
  const saida: string[] = []
  for (const entrada of readdirSync(dir)) {
    const caminho = join(dir, entrada)
    if (statSync(caminho).isDirectory()) saida.push(...arquivosDeTeste(caminho))
    else if (entrada.endsWith('.test.ts')) saida.push(caminho)
  }
  return saida
}

describe('piso de cobertura', () => {
  it(`o módulo mantém ao menos ${CHECAGENS_MINIMAS} checagens`, () => {
    const total = arquivosDeTeste(RAIZ_MODULO).reduce((soma, arquivo) => {
      const codigo = semComentarios(readFileSync(arquivo, 'utf8'))
      return soma + (codigo.match(/^\s*it\(/gm) ?? []).length
    }, 0)
    expect(total).toBeGreaterThanOrEqual(CHECAGENS_MINIMAS)
  })
})

describe('fronteira pública', () => {
  it('quem está fora do módulo importa só o índice, nunca um caminho interno', () => {
    const pastas = ['app', 'components', 'lib']
    const infratores: string[] = []
    const visitar = (dir: string) => {
      for (const entrada of readdirSync(dir)) {
        const caminho = join(dir, entrada)
        if (statSync(caminho).isDirectory()) {
          if (entrada === 'node_modules' || caminho.startsWith(RAIZ_MODULO)) continue
          visitar(caminho)
          continue
        }
        if (!/\.tsx?$/.test(entrada)) continue
        const codigo = readFileSync(caminho, 'utf8')
        for (const m of codigo.matchAll(/from\s+'(@\/lib\/exames\/extracao[^']*)'/g)) {
          const alvo = m[1]
          if (alvo !== '@/lib/exames/extracao') {
            infratores.push(`${relative(RAIZ_REPO, caminho)} → ${alvo}`)
          }
        }
      }
    }
    for (const p of pastas) visitar(join(RAIZ_REPO, p))
    expect(infratores).toEqual([])
  })
})
