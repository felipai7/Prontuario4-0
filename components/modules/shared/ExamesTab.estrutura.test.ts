import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ══════════════════════════════════════════════════════════════════════════
// Testes ESTRUTURAIS da aba de exames — o mesmo mecanismo de
// `lib/exames/extracao/fronteira.test.ts`, pelo mesmo motivo: são regras que
// hoje dependem de disciplina, e disciplina já falhou aqui quatro vezes.
//
// Não há jsdom nem testing-library neste repositório, e adicionar dependência
// de teste no meio de uma correção de defeito não é decisão desta tarefa. Ler
// o fonte e afirmar a propriedade cobre exatamente o que os dois achados
// dizem — e cobre para SEMPRE, não só para o caminho que eu escreveria no
// teste de comportamento.
// ══════════════════════════════════════════════════════════════════════════

/**
 * Remove comentários antes de inspecionar — igual a `fronteira.test.ts`.
 *
 * Sem isto o teste lê o texto EXPLICATIVO como se fosse código: o comentário
 * que explica por que `resetAdding()` não pode vir antes do erro contém a
 * própria string `resetAdding()`, e a asserção de ordem passava a medir a
 * posição do comentário. Aconteceu na primeira rodada desta correção.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}

const FONTE = semComentarios(readFileSync(
  join(process.cwd(), 'components', 'modules', 'shared', 'ExamesTab.tsx'),
  'utf8',
))

describe('I1 · nenhuma gravação em `exames` passa sem conferir o erro', () => {
  // A-05 de novo, no último ponto que sobrou. `handleDeleteExame` e
  // `handleSaveEditExame` conferem desde sempre; `handleManualSave` inseria e
  // jogava fora o retorno, mostrava "Exame salvo!" e chamava `resetAdding()`,
  // que apaga o formulário. É o caminho que a plantonista usa quando os
  // automáticos falham: ela digita os valores à mão e os perde, achando que
  // salvou.
  const OPERACOES = /supabase\s*\n?\s*\.from\('exames'\)\s*\n?\s*\.(insert|update|delete)\(/g

  it('há gravações para inspecionar (o teste não passa por vacuidade)', () => {
    expect(FONTE.match(OPERACOES)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('toda insert/update/delete em `exames` destrutura `error`', () => {
    const semConferencia: string[] = []
    for (const m of FONTE.matchAll(OPERACOES)) {
      // A janela antes da operação tem que trazer a destruturação do erro.
      const antes = FONTE.slice(Math.max(0, m.index! - 120), m.index!)
      if (!/const\s*\{\s*error\s*\}\s*=\s*await\s*$/.test(antes.replace(/\s+$/, ' '))) {
        semConferencia.push(FONTE.slice(m.index! - 60, m.index! + 40).replace(/\n/g, ' '))
      }
    }
    expect(semConferencia).toEqual([])
  })

  it('o salvamento manual não apaga o formulário quando a gravação falha', () => {
    const corpo = FONTE.slice(
      FONTE.indexOf('const handleManualSave'),
      FONTE.indexOf('const resetAdding'),
    )
    // O ramo de erro tem que sair ANTES do reset — senão o que a médica
    // digitou some junto com o erro.
    const iErro = corpo.indexOf('if (error)')
    const iReset = corpo.indexOf('resetAdding()')
    expect(iErro).toBeGreaterThan(-1)
    expect(iReset).toBeGreaterThan(iErro)
    expect(corpo.slice(iErro, iReset)).toMatch(/return/)
  })
})

describe('M3 · os avisos do laudo anterior não sobrevivem ao próximo envio', () => {
  // `pendencias` e `conferenciaPaciente` são do ÚLTIMO envio. Sem limpeza,
  // a lista de "⚠ N resultados pedem conferência" continua na tela depois de
  // um envio que falhou, ou de outro laudo inteiro — atribuída a nada.
  it('resetAdding limpa os dois', () => {
    const corpo = FONTE.slice(
      FONTE.indexOf('const resetAdding'),
      FONTE.indexOf('const updateRow'),
    )
    expect(corpo).toMatch(/limparAvisosDoLaudo\(\)/)
  })

  it('o limpador zera pendências E conferência de paciente', () => {
    const i = FONTE.indexOf('const limparAvisosDoLaudo')
    expect(i).toBeGreaterThan(-1)
    const corpo = FONTE.slice(i, i + 260)
    expect(corpo).toMatch(/setPendencias\(\[\]\)/)
    expect(corpo).toMatch(/setConferenciaPaciente\('naoPerguntado'\)/)
  })

  it('todo ramo de erro de extração limpa os avisos', () => {
    // Eram três ramos (arquivo, print colado, texto colado) até 03/08/2026;
    // com a saída da IA sobrou só o do arquivo. O piso continua sendo "todos
    // os que existem", não "três".
    const ramos = [...FONTE.matchAll(/catch\s*\(e: any\)\s*\{([^}]*)\}/g)]
    expect(ramos.length).toBeGreaterThanOrEqual(1)
    for (const r of ramos) expect(r[1]).toMatch(/limparAvisosDoLaudo\(\)/)
  })

  it('nos handlers de extração, os avisos novos são postos DEPOIS do reset', () => {
    // Armadilha real: `resetAdding()` agora limpa os avisos, então chamá-lo
    // DEPOIS de `setPendencias(...)` apagaria justamente o que acabou de
    // chegar. A ordem é parte do conserto, não estilo.
    const handlers = ['handleExtract']
    for (const h of handlers) {
      const i = FONTE.indexOf(`const ${h} =`)
      expect(i, h).toBeGreaterThan(-1)
      const corpo = FONTE.slice(i, i + 2200)
      const iReset = corpo.indexOf('resetAdding()')
      const iPend = corpo.indexOf('setPendencias(data.pendencias')
      expect(iReset, h).toBeGreaterThan(-1)
      expect(iPend, h).toBeGreaterThan(iReset)
    }
  })
})

describe('R3.1 · a nota discreta ("o laudo não trouxe") é um estado à parte, com o mesmo ciclo de vida de `pendencias`', () => {
  // Mesma armadilha do M3: se `notasLaudo` não morrer com o envio anterior,
  // a nota de um laudo fica na tela atribuída a nada depois de um envio que
  // falhou ou de outro laudo inteiro.
  it('o limpador zera notasLaudo junto com pendências e conferência de paciente', () => {
    const i = FONTE.indexOf('const limparAvisosDoLaudo')
    expect(i).toBeGreaterThan(-1)
    const corpo = FONTE.slice(i, i + 300)
    expect(corpo).toMatch(/setNotasLaudo\(\[\]\)/)
  })

  it('nos handlers de extração, notasLaudo é posto DEPOIS do reset, junto com pendências', () => {
    const handlers = ['handleExtract']
    for (const h of handlers) {
      const i = FONTE.indexOf(`const ${h} =`)
      expect(i, h).toBeGreaterThan(-1)
      const corpo = FONTE.slice(i, i + 2200)
      const iReset = corpo.indexOf('resetAdding()')
      const iNotas = corpo.indexOf('setNotasLaudo(data.notasLaudo')
      expect(iReset, h).toBeGreaterThan(-1)
      expect(iNotas, h).toBeGreaterThan(iReset)
    }
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 03/08/2026 — a IA saiu. Estes testes garantem que ela saiu INTEIRA da tela:
// um estado que ninguém mais alimenta, ou uma aba que posta para um caminho
// que o servidor não atende mais, é como um leitor futuro conclui que o
// recurso continua existindo.
// ══════════════════════════════════════════════════════════════════════════

describe('a tela não guarda restos do caminho da IA', () => {
  it('não sobrou estado nem handler dos modos que só a IA lia', () => {
    for (const morto of ['pastedImgs', 'setPastedImgs', 'rawText', 'setRawText',
                         'handleExtractPasted', 'handleExtractText']) {
      expect(FONTE, morto).not.toMatch(new RegExp(morto))
    }
  })

  it('a aba de upload aceita só PDF', () => {
    const i = FONTE.indexOf('id="exam-file"')
    expect(i).toBeGreaterThan(-1)
    const corpo = FONTE.slice(i, i + 200)
    expect(corpo).toMatch(/accept="[^"]*pdf/i)
    // `image/*` aqui deixaria a médica escolher um print que o servidor
    // recusa — erro depois do envio, em vez de opção que nunca aparece.
    expect(corpo).not.toMatch(/image\/\*/)
  })

  it('o modo de arquivo não se chama mais "ia"', () => {
    expect(FONTE).not.toMatch(/addMode === 'ia'/)
    expect(FONTE).not.toMatch(/addMode === 'texto'/)
    expect(FONTE).toMatch(/addMode === 'pdf'/)
  })

  it('a entrada manual continua inteira — é o destino de tudo que o leitor não lê', () => {
    expect(FONTE).toMatch(/addMode === 'manual'/)
    expect(FONTE).toMatch(/const handleManualSave/)
  })
})

describe('R3.1 · dois canais na tela — só "confira" ganha ⚠ e lista âmbar', () => {
  // O ⚠ da célula não pode voltar a ler `revisar` sozinho: `revisar` é
  // QUALQUER motivo, dos dois canais, e é exatamente essa mistura que
  // marcava metade da tabela (49% no acervo real). O canal "confira" que a
  // tela precisa ler é `confere_valor`.
  it('PivotCell decide o ⚠ por `confere_valor`, não só por `revisar`', () => {
    const i = FONTE.indexOf('function PivotCell')
    expect(i).toBeGreaterThan(-1)
    const corpo = FONTE.slice(i)
    expect(corpo).toMatch(/confere_valor/)
  })

  it('a nota discreta não usa ⚠ nem classe de cor de alerta (âmbar/vermelho)', () => {
    const i = FONTE.indexOf('notasLaudo.length > 0')
    expect(i).toBeGreaterThan(-1)
    // Da abertura do bloco até o próximo `{/*` (comentário do bloco seguinte)
    // ou até 400 caracteres — janela generosa o bastante para o bloco JSX
    // inteiro, curta o bastante para não vazar para o bloco da tabela.
    const corpo = FONTE.slice(i, i + 400)
    expect(corpo).not.toMatch(/⚠/)
    expect(corpo).not.toMatch(/amber|red-/)
  })

  it('a lista âmbar (pendências) continua existindo, separada da nota', () => {
    expect(FONTE).toMatch(/pendencias\.length > 0/)
    expect(FONTE.indexOf('pendencias.length > 0')).toBeLessThan(FONTE.indexOf('notasLaudo.length > 0'))
  })
})
