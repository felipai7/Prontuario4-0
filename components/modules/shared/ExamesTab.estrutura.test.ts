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
    const ramos = [...FONTE.matchAll(/catch\s*\(e: any\)\s*\{([^}]*)\}/g)]
    expect(ramos.length).toBeGreaterThanOrEqual(3)
    for (const r of ramos) expect(r[1]).toMatch(/limparAvisosDoLaudo\(\)/)
  })

  it('nos handlers de extração, os avisos novos são postos DEPOIS do reset', () => {
    // Armadilha real: `resetAdding()` agora limpa os avisos, então chamá-lo
    // DEPOIS de `setPendencias(...)` apagaria justamente o que acabou de
    // chegar. A ordem é parte do conserto, não estilo.
    const handlers = ['handleExtractPasted', 'handleExtractText', 'handleExtract']
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
