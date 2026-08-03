import { describe, it, expect } from 'vitest'
import { carregarCatalogo, chaveSinonimo, resolverAnalito, grupoDoNome, gruposEmOrdem } from './index'
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

describe('R6 · vocabulário por espécime não vaza', () => {
  it('"Glicose" sem contexto é a glicemia do sangue', () => {
    expect(resolverAnalito('Glicose')?.id).toBe('glicose.serum')
  })

  it('"Glicose" dentro de urina e de líquor são analitos DIFERENTES', () => {
    expect(resolverAnalito('Glicose', 'urine')?.id).toBe('glicose.urine')
    expect(resolverAnalito('Glicose', 'csf')?.id).toBe('glicose.csf')
    expect(resolverAnalito('Glicose', 'urine')?.id).not.toBe(resolverAnalito('Glicose')?.id)
  })

  it('o mesmo vale para hemoglobina e leucócitos', () => {
    expect(resolverAnalito('Hemoglobina')?.id).toBe('hemoglobina.serum')
    expect(resolverAnalito('Hemoglobina', 'urine')?.id).toBe('hemoglobina.urine')
    expect(resolverAnalito('Leucócitos')?.id).toBe('leucocitos.serum')
    expect(resolverAnalito('Leucócitos', 'urine')?.id).toBe('leucocitos.urine')
  })

  it('gasometria: o mesmo parâmetro nu muda de analito conforme a via', () => {
    expect(resolverAnalito('SODIO', 'arterialBlood')?.id).toBe('sodio.art')
    expect(resolverAnalito('SODIO', 'venousBlood')?.id).toBe('sodio.ven')
    expect(resolverAnalito('SODIO')?.id).toBe('sodio.serum')
  })

  it('o escopo não vaza para fora: um espécime não enxerga o vocabulário do outro', () => {
    // "Densidade" é urinária por natureza e existe no global; "Cor" só existe
    // com sufixo, então fora do escopo não deve resolver para a versão de urina.
    expect(resolverAnalito('Densidade')?.id).toBe('densidade.urine')
    expect(resolverAnalito('Cor', 'urine')?.id).toBe('cor.urine')
    expect(resolverAnalito('Cor', 'csf')?.id).toBe('cor.csf')
  })
})

describe('faixas de plausibilidade', () => {
  it('toda faixa declara a unidade em que vale', () => {
    const semUnidade = Object.values(analitos.analytes)
      .filter(a => {
        const f = (a as { plausibleRange: { unit?: string } | null }).plausibleRange
        return f !== null && typeof f.unit !== 'string'
      })
    expect(semUnidade).toEqual([])
  })

  it('faixa é fisicamente possível, não faixa de normalidade', () => {
    // Um potássio de 7,2 é gravíssimo e TEM que caber: a faixa serve para pegar
    // erro de escala (0,72), não para julgar o paciente.
    const k = resolverAnalito('Potássio')
    expect(k?.plausibleRange).not.toBeNull()
    expect(k!.plausibleRange!.min).toBeLessThan(2.5)
    expect(k!.plausibleRange!.max).toBeGreaterThan(7.2)
    expect(k!.plausibleRange!.unit).toBe('mmol/L')
  })

  it('quem tem faixa não fica pendente de revisão; quem não tem, fica', () => {
    for (const a of Object.values(analitos.analytes) as { plausibleRange: unknown; needsClinicalReview: boolean }[]) {
      expect(a.needsClinicalReview).toBe(a.plausibleRange === null)
    }
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

// ══════════════════════════════════════════════════════════════════════════
// GRUPOS CLÍNICOS — revisão da Juliana, 03/08/2026.
//
// Até esta data o campo `category` era null nos 285 analitos e o agrupamento
// vivia em doze expressões regulares dentro de `ExamesTab.tsx`, testadas
// contra o NOME EXIBIDO. Os testes abaixo travam os defeitos que essa escolha
// produzia, e que só apareceram quando alguém foi medir.
// ══════════════════════════════════════════════════════════════════════════

describe('grupos são dado clínico, não regex de tela', () => {
  const todos = Object.values(catalogo.analytes)

  it('todo analito tem grupo — nenhum fica para trás', () => {
    const sem = todos.filter(a => !a.category).map(a => a.canonicalName)
    expect(sem).toEqual([])
  })

  it('todo grupo usado existe na ordem de exibição', () => {
    const ordem = new Set(gruposEmOrdem())
    const forasteiros = [...new Set(todos.map(a => a.category))].filter(g => !ordem.has(g))
    expect(forasteiros).toEqual([])
  })

  it('grupos.json e analitos.json não divergem', () => {
    // grupos.json existe para a tela não carregar os 145 KB do catálogo. Ter
    // duas cópias do mesmo dado só é aceitável com esta trava.
    for (const a of todos) {
      expect(grupoDoNome(a.canonicalName), a.canonicalName).toBe(a.category)
    }
  })

  it('a ordem dos grupos não tem repetição nem buraco', () => {
    const ordem = gruposEmOrdem()
    expect(new Set(ordem).size).toBe(ordem.length)
    expect(ordem.length).toBeGreaterThan(0)
  })
})

describe('cada material no seu grupo', () => {
  // O defeito que motivou tudo: agrupar por regex sobre o nome exibido jogava
  // exame de um material dentro do grupo de outro. "Leucócitos (U)" casava com
  // /leucócit/ e aparecia entre as células do sangue; "pH (U)" casava com
  // /\bph\b/ e aparecia na gasometria.
  it('sedimento urinário NUNCA cai no hemograma', () => {
    for (const n of ['Leucócitos (U)', 'Hemácias (U)', 'Hemoglobina (U)']) {
      expect(grupoDoNome(n), n).toBe('🔬 EAS/Urina')
    }
  })

  it('pH urinário NUNCA cai na gasometria', () => {
    expect(grupoDoNome('pH (U)')).toBe('🔬 EAS/Urina')
  })

  it('citologia do líquor NUNCA cai no hemograma', () => {
    for (const n of ['Neutrófilos (LCR)', 'Linfócitos (LCR)', 'Hemácias (LCR)',
                     'Leucócitos (LCR)', 'Monócitos (LCR)', 'Eosinófilos (LCR)']) {
      expect(grupoDoNome(n), n).toBe('🧠 Líquor')
    }
  })

  it('pH e glicose do líquor ficam no líquor', () => {
    expect(grupoDoNome('pH (LCR)')).toBe('🧠 Líquor')
    expect(grupoDoNome('Glicose (LCR)')).toBe('🧠 Líquor')
  })

  it('o que caía em "Outros" por descuido do padrão agora tem grupo', () => {
    // Índices plaquetários: o padrão procurava "mpv", em inglês.
    for (const n of ['VPM', 'PDW', 'PCT']) expect(grupoDoNome(n), n).toBe('🩸 Hemograma')
    // Coagulação: o padrão tinha "tap\b", que não casa com "TP".
    for (const n of ['TP - Atividade', 'TP (segundos)', 'Tempo de Coagulação',
                     'Tempo de Sangramento', 'Prova do Laço']) {
      expect(grupoDoNome(n), n).toBe('🩻 Coagulação')
    }
    // Marcador cardíaco: o padrão exigia fronteira de palavra antes de "bnp".
    expect(grupoDoNome('NT-proBNP')).toBe('🫀 Cardíaco')
    // Eletrólitos da gasometria: o padrão aceitava "(gaso.)", não "(Venosa)".
    for (const n of ['Sódio (Venosa)', 'Potássio (Arterial)', 'Glicose (Venosa)']) {
      expect(grupoDoNome(n), n).toBe('💨 Gasometria')
    }
    // Não existia grupo de lipídios nem de sorologias.
    for (const n of ['Colesterol Total', 'HDL', 'LDL', 'Triglicérides']) {
      expect(grupoDoNome(n), n).toBe('🫀 Lipídios')
    }
    for (const n of ['Influenza A', 'Influenza B', 'COVID-19 Ag']) {
      expect(grupoDoNome(n), n).toBe('🦠 Sorologias')
    }
  })
})
