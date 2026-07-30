import { describe, it, expect } from 'vitest'
import { agruparExamesPorHorario, parseExameTimestamp } from './agrupamento'
import type { Exame } from '@/types'

// Fábrica enxuta: só os campos que o agrupamento usa.
let seq = 0
function ex(data_exame: string | null, opts: Partial<Exame> = {}): Exame {
  seq += 1
  return {
    id: opts.id ?? `ex-${seq}`,
    paciente_id: 'p1',
    tipo_exame: opts.tipo_exame ?? 'Exame',
    data_exame,
    resultados: opts.resultados ?? [],
    observacoes: null,
    raw_text: null,
    nome_arquivo: null,
    // created_at cresce com seq, salvo se dado explicitamente.
    created_at: opts.created_at ?? `2026-01-01T00:00:${String(seq).padStart(2, '0')}.000Z`,
  } as Exame
}

describe('parseExameTimestamp', () => {
  it('entende data com hora', () => {
    expect(parseExameTimestamp(ex('12/05/2026 14:30'))).toBe(new Date('2026-05-12T14:30:00').getTime())
  })
  it('data sem hora cai à meia-noite', () => {
    expect(parseExameTimestamp(ex('12/05/2026'))).toBe(new Date('2026-05-12T00:00:00').getTime())
  })
  it('sem data usa o created_at', () => {
    const e = ex(null, { created_at: '2026-05-12T10:00:00.000Z' })
    expect(parseExameTimestamp(e)).toBe(new Date('2026-05-12T10:00:00.000Z').getTime())
  })
})

describe('agruparExamesPorHorario', () => {
  it('mais novo primeiro (esquerda), mais antigo por último (direita)', () => {
    const antigo = ex('10/05/2026 08:00')
    const novo   = ex('12/05/2026 08:00')
    const grupos = agruparExamesPorHorario([antigo, novo])
    expect(grupos.map(g => g.key)).toEqual([novo.id, antigo.id])
  })

  it('junta exames do mesmo horário numa coluna só', () => {
    const a = ex('12/05/2026 12:00', { tipo_exame: 'Hemograma' })
    const b = ex('12/05/2026 12:00', { tipo_exame: 'Bioquímica' })
    const grupos = agruparExamesPorHorario([a, b])
    expect(grupos).toHaveLength(1)
    expect(grupos[0].exames).toHaveLength(2)
  })

  it('junta dentro da tolerância (poucos minutos) — mesma coleta', () => {
    const a = ex('12/05/2026 12:00')
    const b = ex('12/05/2026 12:07')
    expect(agruparExamesPorHorario([a, b], 10)).toHaveLength(1)
  })

  it('separa horários realmente distintos', () => {
    const manha = ex('12/05/2026 08:00')
    const tarde = ex('12/05/2026 17:00')
    expect(agruparExamesPorHorario([manha, tarde])).toHaveLength(2)
  })

  it('não encadeia: 12:00, 12:08, 12:16 não viram um grupo só', () => {
    // Âncora no primeiro (12:00): 12:16 está a 16min → grupo novo.
    const a = ex('12/05/2026 12:00')
    const b = ex('12/05/2026 12:08')
    const c = ex('12/05/2026 12:16')
    const grupos = agruparExamesPorHorario([a, b, c], 10)
    expect(grupos).toHaveLength(2)
  })

  it('reagrupa quando o horário muda (o caso do Mg às 12:00 que era 17:00)', () => {
    // Antes: Mg às 12:00, separado dos exames das 17:00.
    const mgAntes = ex('12/05/2026 12:00', { id: 'mg', tipo_exame: 'Mg' })
    const das17   = ex('12/05/2026 17:00', { id: 'k',  tipo_exame: 'K' })
    expect(agruparExamesPorHorario([mgAntes, das17])).toHaveLength(2)
    // Depois de editar o Mg para 17:00, o mesmo dado agrupa com o das 17:00.
    const mgDepois = ex('12/05/2026 17:00', { id: 'mg', tipo_exame: 'Mg' })
    const grupos = agruparExamesPorHorario([mgDepois, das17])
    expect(grupos).toHaveLength(1)
    expect(grupos[0].exames.map(e => e.id).sort()).toEqual(['k', 'mg'])
  })

  it('expõe rótulos de data e hora para o cabeçalho', () => {
    const [g] = agruparExamesPorHorario([ex('12/05/2026 14:30')])
    expect(g.dataLabel).toBe('12/05/2026')
    expect(g.horaLabel).toBe('14:30')
  })

  it('exame sem hora não ganha rótulo de hora', () => {
    const [g] = agruparExamesPorHorario([ex('12/05/2026')])
    expect(g.dataLabel).toBe('12/05/2026')
    expect(g.horaLabel).toBeNull()
  })

  it('lista vazia devolve vazio', () => {
    expect(agruparExamesPorHorario([])).toEqual([])
  })
})
