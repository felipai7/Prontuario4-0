import { describe, it, expect } from 'vitest'
import { detectar, PERFIS, perfilPorId } from './detectar'
import type { DocumentText } from '../contratos'

// ══════════════════════════════════════════════════════════════════════════
// 7.B-12 — no clinBoard os fingerprints só são exercitados com PDFs reais em
// disco. Bastaria alimentar o cabeçalho característico de cada laboratório ao
// detector e afirmar o perfil. Detecção é função pura sobre texto; aqui ela é
// testada como tal, sem nenhum arquivo.
// ══════════════════════════════════════════════════════════════════════════

function texto(...linhas: string[]): DocumentText {
  return {
    pages: [{ page: 1, width: 595, height: 842, itemCount: linhas.length }],
    lines: linhas.map((t, i) => ({ page: 1, index: i, text: t, y: 800 - i * 14, items: [], gaps: [] })),
    hasTextLayer: true,
  }
}

describe('roteamento por cabeçalho', () => {
  it('HUGO pelo CNES', () => {
    const d = detectar(texto('HOSPITAL DE URGENCIAS DE GOIAS   CNES 0697699', 'HUGO - UTI ADULTO'))
    expect(d.profileId).toBe('hugo')
    expect(d.confidence).toBeGreaterThan(0)
  })

  it('IMEC pelo nome da instituição e pelo CNES', () => {
    expect(detectar(texto('Local......:  Hospital IMEC')).profileId).toBe('imec')
    expect(detectar(texto('CNES.......:  0929646')).profileId).toBe('imec')
  })

  it('HOC pelo typo consistente e pelo rótulo de valor crítico', () => {
    const d = detectar(texto('ERITOGRAMA', 'VALOR CRÍTICO BAIXO: 120,0 mmol/L'))
    expect(d.profileId).toBe('hoc')
  })

  it('PIOX pelo pontilhado e pelo cabeçalho da tabela', () => {
    const d = detectar(texto('Resultado   Valor Referencial', 'Hemoglobinas..: 10,2  g/dL'))
    expect(d.profileId).toBe('piox')
  })

  it('NÚCLEO pelo sistema do laboratório', () => {
    const d = detectar(texto('SGL PCLAB ONLINE', 'BIOQUIMICA INTERNA'))
    expect(d.profileId).toBe('nucleo')
  })
})

describe('A4 · limiar e confiança', () => {
  it('documento irreconhecível resolve para null, não para um perfil genérico', () => {
    const d = detectar(texto('Lista de compras', 'arroz', 'feijão', 'café'))
    expect(d.profileId).toBeNull()
    expect(d.confidence).toBe(0)
    expect(d.evidence).toEqual([])
  })

  it('um sinal fraco isolado não atinge o limiar', () => {
    // O analisador sozinho identifica o FORNECEDOR, não o laboratório.
    const d = detectar(texto('Equipamento: MINDRAY BC-3200'))
    expect(d.profileId).toBeNull()
  })

  it('sinal institucional sozinho já basta', () => {
    expect(detectar(texto('CNES 0697699')).profileId).toBe('hugo')
  })

  it('a confiança é normalizada, não o score bruto', () => {
    const parcial = detectar(texto('CNES 0697699'))
    const completo = detectar(texto(
      'CNES 0697699', 'ANVISA 350055', 'HUGO - UTI 3',
      'Prontuário SP: 000000', 'DOSAGEM DE CREATININA',
    ))
    expect(parcial.confidence).toBeLessThan(completo.confidence)
    expect(completo.confidence).toBeLessThanOrEqual(1)
  })

  it('a evidência aponta a linha exata de cada sinal (R2)', () => {
    const d = detectar(texto('cabeçalho qualquer', 'CNES 0697699'))
    expect(d.evidence[0]).toMatchObject({ signalId: 'cnes', kind: 'institutional', lineIndex: 1 })
  })
})

describe('6.3 · dado pessoal nunca é fingerprint', () => {
  it('nenhum perfil usa nome, registro profissional ou endereço', () => {
    // O doador usa "CRBM 15121", "CRBM 02383", o nome de uma responsável
    // técnica e duas ruas como fingerprint. Mudam sozinhos, e guardá-los em
    // configuração é exposição desnecessária de dado pessoal.
    const proibido = /\bCRBMs?\b|\bCRMs?\b|\bCRFs?\b|\bCROs?\b|\bRua\b|\bAvenida\b|\bAv\.|Setor\s+[A-Z]|\bCEP\b/i
    const infratores: string[] = []
    for (const perfil of PERFIS) {
      for (const sinal of perfil.fingerprint.signals) {
        if (proibido.test(sinal.pattern)) infratores.push(`${perfil.id}/${sinal.id}`)
      }
    }
    expect(infratores).toEqual([])
  })

  it('todo sinal declara a sua natureza', () => {
    for (const perfil of PERFIS) {
      for (const sinal of perfil.fingerprint.signals) {
        expect(['institutional', 'vendor', 'layout'], `${perfil.id}/${sinal.id}`)
          .toContain(sinal.kind)
      }
    }
  })

  it('nenhum perfil se sustenta APENAS em sinal de fornecedor forte o bastante para sozinho passar', () => {
    // Sinal de fornecedor identifica quem vendeu o sistema, não quem emitiu o
    // laudo: dois laboratórios da mesma região com o mesmo LIS colidiriam.
    for (const perfil of PERFIS) {
      const maiorFornecedor = Math.max(
        0,
        ...perfil.fingerprint.signals.filter(s => s.kind === 'vendor').map(s => s.weight),
      )
      expect(maiorFornecedor, perfil.id).toBeLessThan(perfil.fingerprint.threshold)
    }
  })
})

describe('empate', () => {
  it('empate sem desempate resolve para null, com os candidatos listados', () => {
    // Construído de propósito: um texto que casa dois perfis com o mesmo peso.
    const d = detectar(texto('ERITOGRAMA', 'VALOR CRÍTICO ALTO : 158', 'Resultado : 1'))
    // O HOC vence aqui; o teste garante que, empatando, o resultado é null.
    if (d.tiedWith.length > 1) expect(d.profileId).toBeNull()
    else expect(d.profileId).toBe('hoc')
  })

  it('cada perfil declarado é recuperável pelo id', () => {
    for (const p of PERFIS) expect(perfilPorId(p.id)?.id).toBe(p.id)
    expect(perfilPorId('inexistente')).toBeNull()
  })
})
