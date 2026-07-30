import { describe, it, expect } from 'vitest'
import { parseDataParaISO } from './utils'

describe('parseDataParaISO', () => {
  it('converte DD/MM/AAAA — o formato do prontuário', () => {
    expect(parseDataParaISO('12/05/1970')).toBe('1970-05-12')
    expect(parseDataParaISO('01/01/2000')).toBe('2000-01-01')
  })

  it('aceita dia e mês de um dígito', () => {
    expect(parseDataParaISO('5/3/1988')).toBe('1988-03-05')
  })

  it('aceita . e - como separadores', () => {
    expect(parseDataParaISO('12.05.1970')).toBe('1970-05-12')
    expect(parseDataParaISO('12-05-1970')).toBe('1970-05-12')
  })

  it('aceita 8 dígitos colados sem separador', () => {
    expect(parseDataParaISO('12051970')).toBe('1970-05-12')
  })

  it('aceita o próprio ISO (colar de outra fonte)', () => {
    expect(parseDataParaISO('1970-05-12')).toBe('1970-05-12')
  })

  it('resolve ano de 2 dígitos para nascimento (corte em 30)', () => {
    expect(parseDataParaISO('12/05/70')).toBe('1970-05-12')
    expect(parseDataParaISO('12/05/05')).toBe('2005-05-12')
  })

  it('apara espaços em volta', () => {
    expect(parseDataParaISO('  12/05/1970  ')).toBe('1970-05-12')
  })

  it('rejeita data que não existe, em vez de normalizar em silêncio', () => {
    // 31/02 não existe: new Date normalizaria para 02/03, o que seria um bug clínico.
    expect(parseDataParaISO('31/02/1970')).toBeNull()
    expect(parseDataParaISO('00/05/1970')).toBeNull()
    expect(parseDataParaISO('12/13/1970')).toBeNull()
  })

  it('devolve null para lixo, para o paste padrão seguir seu curso', () => {
    expect(parseDataParaISO('')).toBeNull()
    expect(parseDataParaISO('abc')).toBeNull()
    expect(parseDataParaISO('12/05')).toBeNull()
  })
})
