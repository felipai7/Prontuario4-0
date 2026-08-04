import { describe, it, expect } from 'vitest'
import { featureFlags } from '@/lib/featureFlags'

// ══════════════════════════════════════════════════════════════════════════
// Havia aqui a trava de reversibilidade da flag `extracaoLocal`: desligada,
// produção seguia idêntica (todo PDF ia para a IA). Em 03/08/2026 a IA saiu
// da rota de exames e a flag saiu com ela — desligada, ela agora deixaria a
// rota sem caminho de leitura nenhum. Ver `lib/featureFlags.ts`.
//
// O que sobra é a trava da OUTRA flag, que continua valendo.
// ══════════════════════════════════════════════════════════════════════════

describe('as flags do projeto nascem desligadas', () => {
  it('a flag da nova estrutura não foi afetada', () => {
    expect(featureFlags.novaEstrutura).toBe(false)
  })

  it('não sobrou flag de extração para alguém religar', () => {
    // Uma flag morta que ninguém lê é como um leitor futuro conclui que o
    // caminho da IA ainda existe em algum lugar.
    expect('extracaoLocal' in featureFlags).toBe(false)
  })
})
