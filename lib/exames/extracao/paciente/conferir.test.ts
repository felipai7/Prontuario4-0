import { describe, it, expect } from 'vitest'
import { conferirPaciente } from './conferir'
import { extrairExames } from '../index'
import { pdfDeLinhas } from '../_testes/pdfMinimo'
import type { TextLine } from '../contratos'

const linhas = (...textos: string[]): TextLine[] =>
  textos.map((text, i) => ({ text, page: 1, index: i, x: 50, y: 700 - i * 12, gaps: [] } as unknown as TextLine))

describe('conferência de paciente · pergunta e veredito', () => {
  it('nome igual confere', () => {
    expect(conferirPaciente(linhas('Paciente: MARIA DAS DORES SILVA'), 'Maria das Dores Silva'))
      .toBe('confere')
  })

  it('tolera acento perdido e ordem de maiúsculas', () => {
    expect(conferirPaciente(linhas('Nome: JOAO PEREIRA DE SOUSA'), 'João Pereira de Sousa'))
      .toBe('confere')
  })

  it('tolera nome abreviado pelo laboratório', () => {
    expect(conferirPaciente(linhas('Paciente: MARIA D. D. SILVA'), 'Maria das Dores Silva'))
      .toBe('confere')
  })

  it('paciente diferente NÃO confere', () => {
    expect(conferirPaciente(linhas('Paciente: ANTONIO CARLOS FERREIRA'), 'Maria das Dores Silva'))
      .toBe('naoConfere')
  })

  it('laudo sem nome devolve nomeAusente, não naoConfere', () => {
    expect(conferirPaciente(linhas('HEMOGRAMA', 'Hemoglobina 12,0'), 'Maria das Dores Silva'))
      .toBe('nomeAusente')
  })

  it('sem pergunta, sem veredito', () => {
    expect(conferirPaciente(linhas('Paciente: MARIA DAS DORES SILVA'), null))
      .toBe('naoPerguntado')
  })
})

describe('R10 · o nome do laudo não sai do módulo', () => {
  it('nenhum campo do resultado carrega o nome que estava no laudo', async () => {
    const r = await extrairExames({
      document: { bytes: pdfDeLinhas([
        'Paciente: ANTONIO CARLOS FERREIRA',
        'BIOQUIMICA', 'Coleta: 12/05/2026',
        'Glicose              92    mg/dL      70 - 99',
      ]), filename: null },
      hints: { labProfileId: null, expectedCollectedAt: null, expectedPatientName: 'Maria das Dores Silva' },
      options: null,
    })
    expect(r.patientCheck).toBe('naoConfere')
    // O veredito existe; o nome, não.
    expect(JSON.stringify(r)).not.toMatch(/ANTONIO|FERREIRA/i)
  })
})
