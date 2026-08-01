import { describe, it, expect } from 'vitest'
import { carregarCatalogo, chaveSinonimo, resolverAnalito } from './index'
import analitos from './analitos.json'
import sinonimos from './sinonimos.json'
import especimes from './especimes.json'
import culturas from './culturas.json'
import qualitativos from './qualitativos.json'

const catalogo = carregarCatalogo()

// ══════════════════════════════════════════════════════════════════════════
// E2 · todo nome que uma REGRA pode produzir tem que existir no catálogo.
//
// No clinBoard, sete nomes de líquor eram gerados de propósito pelo parser e
// não estavam na whitelist: chegavam à revisão desmarcados por padrão e se
// perdiam se o usuário salvasse sem conferir item a item. A correção de lá
// alimentou a whitelist a partir das duas fontes que a regra usa. Aqui a
// garantia é este teste — e ele lê os nomes DO CATÁLOGO, não de uma lista
// repetida aqui, senão provaria apenas que copiei certo.
// ══════════════════════════════════════════════════════════════════════════

/** Reconstrói tudo que as regras de renomeação podem emitir. */
function nomesGeraveisPorRegra(): string[] {
  const nomes: string[] = []

  // Gasometria: canônico + sufixo de contexto, mais os nomes especiais.
  const params = especimes.gasometry.params as Record<string, string | null>
  const especiais = especimes.gasometry.specialNames as Record<string, Record<string, string>>
  for (const contexto of Object.keys(especiais)) {
    for (const canonico of Object.values(params)) {
      if (canonico) nomes.push(`${canonico} (${contexto})`)
    }
    for (const nome of Object.values(especiais[contexto]!)) nomes.push(nome)
  }

  // Líquor: tabela de renomeação, nomes já canônicos e saídas do fallback.
  nomes.push(...Object.values(especimes.csf.rename as Record<string, string>))
  nomes.push(...especimes.csf.keep)
  nomes.push(...especimes.csf.ruleOutputs)

  // Culturas: o material canônico vira nome de resultado.
  nomes.push(...Object.values(culturas.materials as Record<string, string>))

  return [...new Set(nomes)]
}

describe('E2 · nomes produzidos por regra', () => {
  it('há regras produzindo nomes (o teste não pode passar por vacuidade)', () => {
    expect(nomesGeraveisPorRegra().length).toBeGreaterThanOrEqual(60)
  })

  it('todo nome gerável por regra resolve para um analito do catálogo', () => {
    const orfaos = nomesGeraveisPorRegra().filter(nome => resolverAnalito(nome) === null)
    expect(orfaos).toEqual([])
  })

  it('os sete nomes de líquor do E2 continuam no catálogo', () => {
    // A lista literal do defeito original. Se alguém remover um deles do
    // catálogo, isto quebra — que é exatamente o ponto.
    const doE2 = [
      'Aspecto (LCR)', 'Cor (LCR)', 'Coágulo (LCR)',
      'Bacterioscopia Gram (LCR)', 'Bacterioscopia Ziehl (LCR)',
      'Pesquisa De Fungos (LCR)', 'Bactéria Isolada (LCR)',
    ]
    for (const nome of doE2) expect(resolverAnalito(nome), nome).not.toBeNull()
  })
})

describe('integridade do catálogo', () => {
  it('todo sinônimo aponta para um analito existente', () => {
    const quebrados = Object.entries(sinonimos.synonyms)
      .filter(([, id]) => !(id in analitos.analytes))
      .map(([nome, id]) => `${nome} → ${id}`)
    expect(quebrados).toEqual([])
  })

  it('o id declarado dentro de cada analito bate com a chave', () => {
    const divergentes = Object.entries(analitos.analytes)
      .filter(([chave, a]) => (a as { id: string }).id !== chave)
      .map(([chave]) => chave)
    expect(divergentes).toEqual([])
  })

  it('nenhum nome canônico difere de outro só por acento, caixa ou espaço', () => {
    const frouxa = (s: string) =>
      s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    const porChave = new Map<string, string[]>()
    for (const a of Object.values(analitos.analytes) as { canonicalName: string }[]) {
      const k = frouxa(a.canonicalName)
      porChave.set(k, [...(porChave.get(k) ?? []), a.canonicalName])
    }
    const colisoes = [...porChave.values()].filter(nomes => new Set(nomes).size > 1)
    expect(colisoes).toEqual([])
  })

  it('nenhum código LOINC foi inventado', () => {
    // O doador não tem LOINC. Qualquer valor aqui teria vindo de adivinhação —
    // e um LOINC errado é pior que um LOINC ausente, porque viaja para fora.
    const comLoinc = Object.values(analitos.analytes)
      .filter(a => (a as { loinc: string | null }).loinc !== null)
    expect(comLoinc).toEqual([])
  })

  it('a chave de busca normaliza caixa, acento composto e espaço', () => {
    expect(chaveSinonimo('  creatinina  ')).toBe('CREATININA')
    expect(chaveSinonimo('Ureia ')).toContain('UREIA')
    expect(resolverAnalito('creatinina')?.canonicalName).toBe('Creatinina')
    expect(resolverAnalito('CREATININA')?.canonicalName).toBe('Creatinina')
  })

  it('nome desconhecido resolve para null, não para um palpite', () => {
    expect(resolverAnalito('Xisantopina Refratada')).toBeNull()
  })

  it('o catálogo é imutável em tempo de execução (R9)', () => {
    expect(Object.isFrozen(catalogo)).toBe(true)
    expect(Object.isFrozen(catalogo.analytes)).toBe(true)
    expect(() => {
      // @ts-expect-error — a tentativa de escrita é o objeto do teste.
      catalogo.synonyms['NOVO'] = 'qualquer.coisa'
    }).toThrow()
  })
})

describe('R3 · o catálogo carrega vocabulário, não interpretação', () => {
  it('os códigos qualitativos não trazem status clínico', () => {
    const valores = new Set(Object.values(qualitativos.codes))
    expect([...valores]).not.toContain('normal')
    expect([...valores]).not.toContain('high')
    expect([...valores]).not.toContain('low')
  })

  it('crescimento de cultura é vocabulário próprio, não um qualitativo', () => {
    expect(Object.values(qualitativos.growth)).toContain('noGrowth')
    expect(qualitativos.codes).not.toHaveProperty('NÃO HOUVE CRESCIMENTO')
  })

  it('descrição física do líquor não virou código qualitativo', () => {
    for (const termo of qualitativos.physicalDescription) {
      expect(qualitativos.codes, termo).not.toHaveProperty(termo)
    }
  })
})
