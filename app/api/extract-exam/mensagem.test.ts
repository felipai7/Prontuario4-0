import { describe, it, expect } from 'vitest'
import { mensagemNaoReconhecido } from './processar'

/**
 * O que estes testes protegem: quatro causas distintas de "não extraiu nada"
 * precisam se anunciar de forma diferente na tela.
 *
 * Nasceram de um caso real (04/08/2026): um laudo do IMEC — laboratório
 * reconhecido, com texto, que extrai 54 resultados fora de produção — falhou
 * na UTI exibindo "o laboratório não está entre os que o programa lê, ou o PDF
 * é uma imagem sem texto". As duas afirmações eram falsas para aquele arquivo,
 * e a mensagem mandou digitar 54 resultados à mão sem dizer o que houve.
 */
describe('mensagemNaoReconhecido', () => {
  it('falha ao ABRIR o arquivo não culpa o laboratório, e pede aviso', () => {
    // É a causa que pode ser problema NOSSO (ambiente, dependência), e não do
    // documento — por isso é a única que convida a reportar.
    const m = mensagemNaoReconhecido(['malformedDocument'])
    expect(m).toMatch(/não consegui abrir/i)
    expect(m).toMatch(/falha nossa/i)
    expect(m).not.toMatch(/laboratório não está/i)
  })

  it('PDF digitalizado diz que é imagem, sem falar em laboratório', () => {
    const m = mensagemNaoReconhecido(['noTextLayer'])
    expect(m).toMatch(/imagem digitalizada/i)
    expect(m).not.toMatch(/laboratório não está/i)
  })

  it('texto embaralhado explica por que recusamos ler', () => {
    // Recusar é deliberado: a fonte devolve "Sulfa-Trimetoprim" como
    // "Svmgb-Tsjnfuprsjn", e ler assim trocaria valores no prontuário.
    const m = mensagemNaoReconhecido(['corruptedTextLayer'])
    expect(m).toMatch(/embaralhado/i)
    expect(m).toMatch(/trocar valores/i)
  })

  it('sem aviso específico, aí sim é laboratório/formato', () => {
    const m = mensagemNaoReconhecido([])
    expect(m).toMatch(/laboratório não está/i)
  })

  it('a falha de abrir o arquivo tem precedência sobre as demais', () => {
    // Um arquivo que nem abriu também não tem camada de texto: reportar
    // "é uma imagem digitalizada" mandaria investigar o lado errado.
    const m = mensagemNaoReconhecido(['noTextLayer', 'malformedDocument'])
    expect(m).toMatch(/não consegui abrir/i)
  })

  it('toda mensagem diz o que fazer agora', () => {
    const casos: Parameters<typeof mensagemNaoReconhecido>[0][] = [
      ['malformedDocument'], ['noTextLayer'], ['corruptedTextLayer'], [],
    ]
    for (const avisos of casos) {
      expect(mensagemNaoReconhecido(avisos)).toMatch(/aba Manual/)
    }
  })
})
