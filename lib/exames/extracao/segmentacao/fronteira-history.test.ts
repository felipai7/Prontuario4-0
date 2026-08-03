import { describe, it, expect } from 'vitest'
import { extrairExames } from '../index'
import { pdfTabular } from '../_testes/pdfMinimo'

// ══════════════════════════════════════════════════════════════════════════
// A fronteira do segmento `history` — os três defeitos da revisão final.
//
// O discriminador anterior era "a linha tem dígito?". Ele erra nos DOIS
// sentidos, e cada sentido tem uma consequência clínica própria:
//
//  C2 — título de exame COM dígito ("DOSAGEM DE VITAMINA B12", "T4 LIVRE",
//       "CA 19-9", "HEMOGLOBINA A1C", "ANTI-HBS") nunca fecha a tabela de
//       evolução. O exame inteiro fica soterrado dentro dela e é descartado.
//
//  C3 — linha da PRÓPRIA tabela SEM dígito ("TGO --- ---", analito não
//       medido) fecha a tabela cedo demais, e todas as linhas seguintes dela
//       voltam a virar resultado DE AGORA, com a data de hoje. É o pior modo
//       de falha do projeto: o número é plausível, está datado de hoje e não
//       carrega marcador nenhum.
//
//  C4 — abrir a tabela de evolução zerava o escopo de espécime para sangue.
//       Uma glicose de LÍQUOR de 30 mg/dL — marca registrada de meningite
//       bacteriana — virava glicemia, e o marcador de meningite não chegava
//       ao prontuário.
//
// O discriminador é ESTRUTURAL, não de classe de caractere: uma linha da
// tabela de tendência é um rótulo seguido de CÉLULAS DE VALOR; um título de
// bloco não tem células de valor depois dele. Ver `pareceTituloDeSecao`.
// ══════════════════════════════════════════════════════════════════════════

const nomes = (r: { observations: { canonicalName: string | null }[] }) =>
  r.observations.map(o => o.canonicalName)

// ── C2 · título de exame com dígito fecha a tabela ─────────────────────────
describe('C2 · título de exame com dígito fecha a tabela de evolução', () => {
  const COLUNAS = [50, 240, 320, 400, 470]
  const bytes = pdfTabular([
    ['GASOMETRIA ARTERIAL', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['pH', ':', '7,370', '7,350 - 7,450'],
    ['Evolução do paciente'],
    ['Data', '04/04/2026', '05/04/2026', '06/04/2026', '08/04/2026'],
    ['Creatinina', '1,10', '1,15', '1,20', '1,25'],
    ['DOSAGEM DE VITAMINA B12', 'Valores de Referência'],
    ['Resultado: 135 pg/mL', '180 - 914 pg/mL'],
    ['DOSAGEM DE CREATININA', 'Valores de Referência'],
    ['Resultado: 1,42 mg/dL', '0,60 - 1,30 mg/dL'],
  ], COLUNAS)

  const extrair = () =>
    extrairExames({ document: { bytes, filename: null }, hints: null, options: null })

  it('a B12 depois da tabela é extraída, e não engolida pelo history', async () => {
    const r = await extrair()
    const b12 = r.observations.filter(o => o.canonicalName === 'Vitamina B12')
    expect(b12.some(o => o.value.kind === 'numeric' && o.value.value === 135)).toBe(true)
  })

  it('o exame DEPOIS do título com dígito também sobrevive', async () => {
    // Sem o fechamento na B12, "DOSAGEM DE CREATININA" ainda fecharia — mas o
    // laudo real tem um título com dígito atrás do outro, e basta um deles não
    // fechar para tudo entre os dois sumir.
    const r = await extrair()
    const crea = r.observations.filter(o => o.canonicalName === 'Creatinina')
    expect(crea.some(o => o.value.kind === 'numeric' && o.value.value === 1.42)).toBe(true)
  })

  it('a linha da tabela de evolução continua descartada', async () => {
    const r = await extrair()
    // A creatinina 1,10 da tabela é HISTÓRICA: não pode virar observação.
    const crea = r.observations.filter(o => o.canonicalName === 'Creatinina')
    expect(crea.some(o => o.value.kind === 'numeric' && o.value.value === 1.1)).toBe(false)
    expect(r.discarded.some(d => d.reason === 'historicalResult')).toBe(true)
  })
})

// ── C3 · linha sem dígito DENTRO da tabela não a fecha ─────────────────────
describe('C3 · analito não medido não reabre a extração no meio da tabela', () => {
  const COLUNAS = [50, 240, 320, 400, 470]
  const bytes = pdfTabular([
    ['GASOMETRIA ARTERIAL', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['pH', ':', '7,370', '7,350 - 7,450'],
    ['Evolução do paciente'],
    ['Data', '06/04/2026', '08/04/2026'],
    ['TGO', '---', '---'],
    ['Creatinina', '1,10', '1,20'],
    ['Ureia', '62', '71'],
  ], COLUNAS)

  const extrair = () =>
    extrairExames({ document: { bytes, filename: null }, hints: null, options: null })

  it('"TGO --- ---" NÃO fecha a tabela: a creatinina histórica não vira resultado', async () => {
    const r = await extrair()
    expect(nomes(r)).not.toContain('Creatinina')
  })

  it('a ureia histórica também não vira resultado de agora', async () => {
    const r = await extrair()
    expect(nomes(r)).not.toContain('Ureia')
  })

  it('R1 · as linhas da tabela viram descarte com motivo, não somem', async () => {
    const r = await extrairExames({
      document: { bytes, filename: null },
      hints: null,
      options: { retainRawText: true },
    })
    const historicos = r.discarded.filter(d => d.reason === 'historicalResult')
    expect(historicos.some(d => d.rawLine.includes('Creatinina'))).toBe(true)
    expect(historicos.some(d => d.rawLine.includes('Ureia'))).toBe(true)
  })
})

// ── C4 · a tabela de evolução não mexe no escopo de espécime (R6) ──────────
describe('C4 · o líquor sobrevive à tabela de evolução', () => {
  const COLUNAS = [50, 240, 320, 400, 470]
  const bytes = pdfTabular([
    ['ROTINA DE LÍQUOR', 'Valores de referência'],
    ['Coleta: 08/04/2026'],
    ['Glicose', ':', '30 mg/dL', '40 - 70 mg/dL'],
    ['Evolução do paciente'],
    ['Data', '06/04/2026', '08/04/2026'],
    ['Glicose', '28', '30'],
    ['PROTEINAS TOTAIS', 'Valores de Referência'],
    ['Glicose', ':', '32 mg/dL', '40 - 70 mg/dL'],
  ], COLUNAS)

  // `hugo` NÃO declara herança de espécime (`specimen.inherit: []`) — é
  // justamente o perfil onde o defeito aparecia, e é o laboratório que imprime
  // "Evolução do paciente".
  const extrair = () => extrairExames({
    document: { bytes, filename: null },
    hints: { labProfileId: 'hugo', expectedCollectedAt: null, expectedPatientName: null },
    options: null,
  })

  it('a glicose ANTES da tabela é de líquor', async () => {
    const r = await extrair()
    expect(nomes(r)).toContain('Glicose (LCR)')
  })

  it('a glicose DEPOIS da tabela continua sendo de líquor, nunca glicemia', async () => {
    const r = await extrair()
    const glicoses = r.observations.filter(o => /Glicose/.test(o.canonicalName ?? ''))
    expect(glicoses.length).toBeGreaterThanOrEqual(2)
    expect(glicoses.every(o => o.canonicalName === 'Glicose (LCR)')).toBe(true)
    expect(nomes(r)).not.toContain('Glicose')
  })

  it('nenhuma observação depois da tabela sai com espécime de sangue', async () => {
    const r = await extrair()
    expect(r.observations.every(o => o.specimen === 'csf')).toBe(true)
  })
})
