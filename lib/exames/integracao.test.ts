import { describe, it, expect } from 'vitest'
import { featureFlags } from '@/lib/featureFlags'

// ══════════════════════════════════════════════════════════════════════════
// A integração é reversível por construção: com a flag desligada, o caminho
// é exatamente o de hoje. É a mesma disciplina do PR anterior deste
// repositório — produção idêntica enquanto a flag estiver off.
// ══════════════════════════════════════════════════════════════════════════

describe('a extração local nasce desligada', () => {
  it('sem a variável de ambiente, a flag é falsa', () => {
    expect(process.env.NEXT_PUBLIC_FF_EXTRACAO_LOCAL).toBeUndefined()
    expect(featureFlags.extracaoLocal).toBe(false)
  })

  it('a flag existente não foi afetada', () => {
    expect(featureFlags.novaEstrutura).toBe(false)
  })
})
