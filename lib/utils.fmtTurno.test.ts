import { describe, it, expect } from 'vitest'
import { fmtTurno } from './utils'

/**
 * A regra que estes testes travam: o rótulo de um turno vem sempre do seu
 * INÍCIO, nunca do fim.
 *
 * Um turno noturno vai das 19:00 às 07:00 do dia seguinte. Formatar pelo fim
 * faz o turno da noite de 02/08 aparecer como 03/08 — foi exatamente o bug do
 * cartão "Última Evacuação", que montava a data à mão a partir de `fim` em vez
 * de usar esta função.
 */
describe('fmtTurno', () => {
  it('noturno que cruza a meia-noite leva a data em que COMEÇOU', () => {
    // 02/08 19:00 → 03/08 07:00. O rótulo tem que dizer 02/08.
    expect(fmtTurno('noturno', '2026-08-02T19:00:00')).toBe('02/08 🌙 Noturno')
  })

  it('diurno leva a data do próprio dia', () => {
    expect(fmtTurno('diurno', '2026-08-02T07:00:00')).toBe('02/08 ☀️ Diurno')
  })

  it('vira o mês pelo início, não pelo fim', () => {
    // 31/07 19:00 → 01/08 07:00: é o noturno de julho, não de agosto.
    expect(fmtTurno('noturno', '2026-07-31T19:00:00')).toBe('31/07 🌙 Noturno')
  })

  it('mantém dois dígitos em dia e mês', () => {
    expect(fmtTurno('diurno', '2026-01-05T07:00:00')).toBe('05/01 ☀️ Diurno')
  })
})
