import { describe, it, expect } from 'vitest'
import { leitosVigentes, nomeDaAla, normalizarCodigo, type Unidade } from './unidade'

const leito = (numero: number, desde = '2000-01-01', ate: string | null = null) =>
  ({ numero, ativo_desde: desde, ativo_ate: ate })

describe('leitosVigentes', () => {
  it('devolve os leitos sem data de encerramento, em ordem numérica', () => {
    // Ordem numérica e não alfabética: com string, o leito 10 viria antes do 2.
    expect(leitosVigentes([leito(10), leito(2), leito(1)], '2026-07-23')).toEqual([1, 2, 10])
  })

  it('exclui leito que ainda não entrou em operação', () => {
    expect(leitosVigentes([leito(1), leito(2, '2026-08-01')], '2026-07-23')).toEqual([1])
  })

  it('inclui o leito no próprio dia em que passa a valer', () => {
    expect(leitosVigentes([leito(1, '2026-07-23')], '2026-07-23')).toEqual([1])
  })

  it('exclui leito desativado antes de hoje', () => {
    expect(leitosVigentes([leito(1), leito(2, '2000-01-01', '2026-06-30')], '2026-07-23')).toEqual([1])
  })

  it('inclui o leito no último dia de vigência — desativar não é retroativo', () => {
    // A borda importa: se o último dia não contasse, a UTI perderia um
    // leito-dia toda vez que um leito fosse desativado.
    expect(leitosVigentes([leito(1, '2000-01-01', '2026-07-23')], '2026-07-23')).toEqual([1])
  })

  it('ala sem leitos não quebra', () => {
    expect(leitosVigentes([], '2026-07-23')).toEqual([])
  })
})

describe('normalizarCodigo', () => {
  it('reproduz o código das alas que já existem', () => {
    // Garantia de continuidade: 'UTI 01' precisa continuar virando 'uti-01',
    // que é o valor gravado em pacientes.ala_id desde o começo do app.
    expect(normalizarCodigo('UTI 01')).toBe('uti-01')
    expect(normalizarCodigo('UTI 02')).toBe('uti-02')
  })

  it('remove acento — o código é chave, não texto de tela', () => {
    expect(normalizarCodigo('UTI Cardiológica')).toBe('uti-cardiologica')
    expect(normalizarCodigo('Unidade Coronariana Não-Invasiva')).toBe('unidade-coronariana-nao-invasiva')
  })

  it('colapsa separadores repetidos e apara as pontas', () => {
    expect(normalizarCodigo('  UTI   ---  03  ')).toBe('uti-03')
  })

  it('nome só de pontuação vira string vazia, e não um hífen solto', () => {
    // A tela usa isso para recusar o cadastro: um código '-' passaria batido.
    expect(normalizarCodigo('---')).toBe('')
    expect(normalizarCodigo('   ')).toBe('')
  })
})

describe('nomeDaAla', () => {
  const unidade: Unidade = {
    unitId: 'u1', nome: 'UTI Adulto', leitosAtivos: 3, outrasUnidades: 0,
    alas: [{ id: 'uti-01', nome: 'UTI 01', leitos: [1, 2, 3] }],
  }

  it('traduz o código da ala para o nome de exibição', () => {
    expect(nomeDaAla(unidade, 'uti-01')).toBe('UTI 01')
  })

  it('cai no próprio código quando a ala não existe mais', () => {
    // Acontece com paciente antigo de uma ala já removida: mostrar o código cru
    // é feio, mas some menos informação do que mostrar vazio.
    expect(nomeDaAla(unidade, 'uti-99')).toBe('uti-99')
  })

  it('sem unidade carregada, devolve o código', () => {
    expect(nomeDaAla(null, 'uti-01')).toBe('uti-01')
  })
})
