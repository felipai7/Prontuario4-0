import { describe, it, expect } from 'vitest'
import { extrairExames } from '../index'
import { construirPdf, pdfDeLinhas } from '../_testes/pdfMinimo'
import { detectarModalidade } from './extrair'

async function extrair(linhas: string[]) {
  return extrairExames({
    document: { bytes: pdfDeLinhas(linhas), filename: null },
    hints: null,
    options: null,
  })
}

describe('ordem de detecção de modalidade', () => {
  it('PET vem antes de tomografia — "TOMOGRAFIA POR EMISSÃO" é PET', () => {
    expect(detectarModalidade('TOMOGRAFIA POR EMISSÃO DE PÓSITRONS')).toBe('PET')
    expect(detectarModalidade('PET-CT DE CORPO INTEIRO')).toBe('PET')
  })

  it('ecocardiograma vem antes de ultrassom — contém DOPPLER mas não é US', () => {
    expect(detectarModalidade('ECODOPPLERCARDIOGRAMA TRANSTORÁCICO')).toBe('ECHO')
    expect(detectarModalidade('ECOCARDIOGRAMA COM DOPPLER')).toBe('ECHO')
  })

  it('as modalidades comuns caem no código certo', () => {
    expect(detectarModalidade('TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO')).toBe('CT')
    expect(detectarModalidade('RESSONÂNCIA MAGNÉTICA DO ABDOME')).toBe('MR')
    expect(detectarModalidade('ULTRASSONOGRAFIA DE ABDOME TOTAL')).toBe('US')
    expect(detectarModalidade('RAIO-X DE TÓRAX')).toBe('XR')
    expect(detectarModalidade('CINTILOGRAFIA MIOCÁRDICA')).toBe('NM')
    expect(detectarModalidade('COLONOSCOPIA')).toBe('ENDO')
  })

  it('o erro ortográfico comum continua sendo reconhecido', () => {
    // "angioresonância" com um S só aparece em laudo de verdade.
    expect(detectarModalidade('ANGIORESONÂNCIA ARTERIAL DO CRÂNIO')).toBe('MR')
  })

  it('sem palavra de modalidade, resolve para "other" e não chuta', () => {
    expect(detectarModalidade('EXAME DE ROTINA')).toBe('other')
  })
})

describe('extração de um laudo de imagem', () => {
  const LAUDO = [
    'Nome: PACIENTE DE TESTE   Data do exame: 29/06/2026',
    'Méd. Solicitante: FULANO DE TAL   ID: 000000',
    'TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO',
    'INDICAÇÃO: Cefaleia súbita.',
    'TÉCNICA: Cortes axiais sem contraste.',
    'ACHADOS:',
    'Não há evidência de hemorragia intracraniana.',
    'Sistema ventricular de dimensões normais.',
    'CONCLUSÃO:',
    'Exame dentro dos limites da normalidade.',
    'DRA. FULANA DE TAL',
    'CRM 00000 / RQE 00000',
  ]

  it('identifica modalidade, título, região e data', async () => {
    const r = await extrair(LAUDO)
    expect(r.documentKind).toBe('imaging')
    const l = r.imaging[0]!
    expect(l.modality).toBe('CT')
    expect(l.title).toBe('TOMOGRAFIA COMPUTADORIZADA DO CRÂNIO')
    expect(l.bodyRegion).toBe('CRÂNIO')
    expect(l.performedAt.iso).toBe('2026-06-29')
  })

  it('separa as quatro seções', async () => {
    const r = await extrair(LAUDO)
    const s = r.imaging[0]!.sections
    expect(s.indication).toBe('Cefaleia súbita.')
    expect(s.technique).toBe('Cortes axiais sem contraste.')
    expect(s.findings).toMatch(/hemorragia intracraniana/)
    expect(s.conclusion).toBe('Exame dentro dos limites da normalidade.')
  })

  it('assinatura e cabeçalho saem do corpo, mas viram descarte com motivo', async () => {
    const r = await extrair(LAUDO)
    const corpo = JSON.stringify(r.imaging[0]!.sections)
    expect(corpo).not.toMatch(/CRM|DRA\.|Méd\. Solicitante/)
    expect(r.discarded.some(d => d.reason === 'headerOrFooter')).toBe(true)
  })
})

describe('nenhum texto se perde', () => {
  it('laudo sem cabeçalho de seção nenhum vai inteiro para unsectionedText', async () => {
    const r = await extrair([
      'RADIOGRAFIA DOS SEIOS DA FACE',
      'Velamento do seio maxilar direito.',
      'Demais seios paranasais transparentes.',
    ])
    const l = r.imaging[0]!
    expect(l.sections.findings).toBeNull()
    expect(l.unsectionedText).toMatch(/Velamento do seio maxilar direito/)
    expect(l.unsectionedText).toMatch(/Demais seios paranasais/)
  })

  it('A7 · sem cabeçalho de achados, o consumidor é AVISADO', async () => {
    // Não dá para saber onde a técnica acaba e o achado começa. Chutar
    // arquivaria achado clínico como técnica; o texto fica onde está e o aviso
    // diz que a separação não é confiável.
    const r = await extrair([
      'ULTRASSONOGRAFIA DE ABDOME TOTAL',
      'MÉTODO: Transdutor convexo.',
      'Fígado de dimensões normais.',
      'CONCLUSÃO:',
      'Exame normal.',
    ])
    expect(r.warnings.map(w => w.code)).toContain('imagingSectionsIncomplete')
  })

  it('frase de abertura em prosa abre os achados, quando existe', async () => {
    const r = await extrair([
      'ANGIORRESSONÂNCIA ARTERIAL DO CRÂNIO',
      'Técnica do exame: Sequência 3D TOF.',
      'Os seguintes aspectos foram observados:',
      'Fenestração da artéria comunicante anterior.',
      'Conclusão:',
      'Sem aneurismas detectáveis.',
    ])
    const s = r.imaging[0]!.sections
    expect(s.technique).toBe('Sequência 3D TOF.')
    expect(s.findings).toMatch(/Fenestração/)
    expect(s.conclusion).toMatch(/Sem aneurismas/)
  })
})

describe('multipágina', () => {
  it('a conclusão vem depois do primeiro rodapé e não pode ser truncada', async () => {
    // O rodapé se repete a cada página. Truncar no primeiro perderia justamente
    // a conclusão, que costuma estar na página seguinte.
    const bytes = construirPdf([
      {
        linhas: [
          { texto: 'TOMOGRAFIA COMPUTADORIZADA DE TÓRAX', x: 50, y: 780, tamanho: 11 },
          { texto: 'ACHADOS:', x: 50, y: 760, tamanho: 11 },
          { texto: 'Opacidades em vidro fosco bilaterais.', x: 50, y: 740, tamanho: 11 },
          { texto: 'CRM 00000 / RQE 00000', x: 50, y: 60, tamanho: 11 },
        ],
      },
      {
        linhas: [
          { texto: 'Nome: PACIENTE DE TESTE', x: 50, y: 780, tamanho: 11 },
          { texto: 'CONCLUSÃO:', x: 50, y: 740, tamanho: 11 },
          { texto: 'Achados compatíveis com processo infeccioso.', x: 50, y: 720, tamanho: 11 },
          { texto: 'CRM 00000 / RQE 00000', x: 50, y: 60, tamanho: 11 },
        ],
      },
    ])
    const r = await extrairExames({
      document: { bytes, filename: null }, hints: null, options: null,
    })
    const s = r.imaging[0]!.sections
    expect(s.findings).toMatch(/vidro fosco/)
    expect(s.conclusion).toMatch(/processo infeccioso/)
  })
})

describe('seção 9 · sem OCR nesta fase', () => {
  it('PDF sem camada de texto resolve para unrecognized, com aviso', async () => {
    const r = await extrairExames({
      document: { bytes: construirPdf([{ linhas: [] }]), filename: null },
      hints: null,
      options: null,
    })
    expect(r.documentKind).toBe('unrecognized')
    expect(r.imaging).toEqual([])
    expect(r.warnings.map(w => w.code)).toContain('noTextLayer')
  })

  it('laudo laboratorial não é confundido com laudo de imagem', async () => {
    const r = await extrair([
      'BIOQUIMICA',
      'Coleta: 12/05/2026',
      'Creatinina          1,42     mg/dL      0,60 - 1,30',
    ])
    expect(r.imaging).toEqual([])
    expect(r.documentKind).toBe('laboratory')
  })
})
