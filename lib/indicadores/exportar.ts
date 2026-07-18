// Exporta as contagens do mês no formato da aba "Dados Mensais" da planilha do
// Dr. Flaubert — mesma ordem de colunas, mesmos rótulos. A ideia é que ele cole
// a linha na planilha dele e a aba "Indicadores" recalcule sozinha: enquanto o
// app não faz tudo, ele confere um contra o outro em vez de escolher um dos dois.

import type { ContagensMes, ContagensFisioMes, ContagensEnfermagemMes } from '@/types'

/** Contagens do mês + os campos que vêm de lib/config.ts, não do banco. */
export interface LinhaExport extends ContagensMes {
  leitos_dia: number
  leitos_ativos: number
  /** Null = mês sem registro de fisioterapia; as colunas dela saem vazias. */
  fisio?: ContagensFisioMes | null
  /** Null = mês sem registro de enfermagem; as colunas dela saem vazias. */
  enfermagem?: ContagensEnfermagemMes | null
}

/**
 * Uma coluna da aba "Dados Mensais", na ordem original (A..BY).
 *
 * `campo` ausente = o app ainda não calcula esse número. A célula sai VAZIA, e
 * não zero, de propósito: vazio é "não sei", zero é uma afirmação. Zerar o que
 * não sabemos apagaria o lançamento manual dele.
 */
interface Coluna {
  label: string
  /** Campo das contagens gerais (ou dos leitos, que vêm de lib/config.ts). */
  campo?: keyof ContagensMes | 'leitos_dia' | 'leitos_ativos'
  /** Campo das contagens de fisioterapia — vazio se o mês não tiver registro. */
  fisio?: keyof ContagensFisioMes
  /** Campo das contagens de enfermagem — vazio se o mês não tiver registro. */
  enf?: keyof ContagensEnfermagemMes
}

const COLUNAS: Coluna[] = [
  { label: 'mes' },                                                          // A (preenchido à parte)
  { label: '' },                                                             // B (rótulo livre na planilha dele)
  { label: 'Leitos-dia disponiveis no mes (soma)',                    campo: 'leitos_dia' },
  { label: 'Numero de leitos ativos (config. vigente no fim do mes)', campo: 'leitos_ativos' },
  { label: 'Pacientes-dia (soma do mes)',                             campo: 'pacientes_dia' },
  { label: 'Numero de admissoes no mes',                              campo: 'admissoes' },
  { label: 'Numero de saidas (altas + obitos)',                       campo: 'saidas' },
  { label: 'Soma dos dias de permanencia das saidas do mes',          campo: 'dias_permanencia_saidas' },
  { label: 'Obitos totais (todas as causas)',                         campo: 'saidas_obitos' },
  { label: 'Obitos em ate 24h da admissao',                           campo: 'obitos_ate_24h' },
  { label: 'Obitos apos 24h da admissao',                             campo: 'obitos_apos_24h' },
  { label: 'Obitos em pacientes paliativos',                          campo: 'obitos_paliativos' },
  { label: 'Total de pacientes paliativos (saidas)',                  campo: 'saidas_paliativos' },
  { label: 'Obitos em pacientes oncologicos',                         campo: 'obitos_oncologicos' },
  { label: 'Total de pacientes oncologicos (saidas)',                 campo: 'saidas_oncologicos' },
  { label: 'Soma da mortalidade esperada (SAPS 3) das saidas',        campo: 'soma_mortalidade_esperada' },
  { label: 'Reinternacoes em ate 48h da alta',                        campo: 'reinternacoes_48h' },
  { label: 'Reinternacoes em ate 30 dias da alta',                    campo: 'reinternacoes_30d' },
  { label: 'Total de IRAS (eventos) no mes' },
  { label: 'Pacientes com pelo menos uma IRAS' },
  { label: 'Total de pacientes internados no mes',                    campo: 'pacientes_internados_mes' },
  // A planilha nunca separou LPP adquirida de LPP de admissão, então esta
  // coluna leva o TOTAL — é o que mantém a série histórica dele comparável.
  { label: 'Total de LPP (eventos) no mes',                            enf: 'lpp_total' },
  { label: 'Pneumonia nosocomial (mes)' },
  { label: 'Traqueite nosocomial (mes)' },
  { label: 'IPCS laboratorial (hemocultura +)' },
  { label: 'IPCS clinica (sem confirmacao laboratorial)' },
  { label: 'ITU associada a SVD' },
  { label: 'PAV (mes)' },
  { label: 'CVC-dia (soma do mes)',                                   enf: 'cvc_dia' },
  { label: 'SVD-dia (soma do mes)',                                   enf: 'svd_dia' },
  { label: 'Ventilador-dia (soma do mes)',                            campo: 'ventilador_dia' },
  { label: 'Pacientes que realizaram hemodialise/TRS',                campo: 'pacientes_hemodialise' },
  { label: 'NP >70% da meta (n)' },
  { label: 'Total recebendo NP (d)' },
  { label: 'NE >70% da meta (n)' },
  { label: 'Total recebendo NE (d)' },
  { label: 'VO com aceitacao >60% (n)' },
  { label: 'Total recebendo VO (d)' },
  { label: 'Deficit/risco nutricional (n)' },
  { label: 'Avaliados pela nutricao (d)' },
  { label: 'Avaliacao nutricional em ate 24h (n)' },
  { label: 'Admissoes elegiveis para avaliacao 24h (d)' },
  { label: 'Jejum >24h antes da TN (n)' },
  { label: 'Elegiveis/candidatos para terapia nutricional (d)' },
  { label: 'Diarreia em pacientes com NE (n)' },
  { label: 'Diarreia em pacientes com VO (n)' },
  { label: 'Pacientes constipados (n)' },
  { label: 'Total avaliados para constipacao (d)' },
  { label: 'Constipacao em uso de opioide (n)' },
  { label: 'Total em uso de opioide (d)' },
  { label: 'Pacientes com hipoglicemia, glicemia <70 (n)',            campo: 'pacientes_hipoglicemia' },
  { label: 'Pacientes com hiperglicemia, glicemia >180 (n)',          campo: 'pacientes_hiperglicemia' },
  { label: 'Pacientes monitorados (d)',                               campo: 'pacientes_monitorados_glicemia' },
  { label: 'Pacientes c/ qualquer disfuncao, dedup. (n)',             campo: 'pacientes_disfuncao_glicemica' },
  { label: 'Disfuncao glicemica em uso de corticoide (n)',            campo: 'pacientes_disfuncao_glicemica_corticoide' },
  { label: 'Extubados com sucesso (n)',                     fisio: 'extubados_com_sucesso' },
  { label: 'Tentativas de extubacao (d)',                   fisio: 'tentativas_extubacao' },
  { label: 'Reintubacoes em ate 48h (n)',                   fisio: 'reintubacoes_48h' },
  { label: 'Extubacoes planejadas (d)',                     fisio: 'extubacoes_planejadas' },
  { label: 'Desmame dificil com sucesso (n)',               fisio: 'desmame_dificil_sucesso' },
  { label: 'Pacientes com desmame dificil (d)',             fisio: 'pacientes_desmame_dificil' },
  { label: 'VNI que evitou IOT (n)',                        fisio: 'vni_evitou_iot' },
  { label: 'VNI com objetivo de evitar IOT (d)',            fisio: 'vni_objetivo_evitar_iot' },
  { label: 'Decanulados na UTI (n)',                        fisio: 'decanulados_na_uti' },
  { label: 'Traqueostomizados elegiveis a decanulacao (d)', fisio: 'traqueo_elegiveis' },
  { label: 'Dias em VM protetora (n)',                      fisio: 'dias_vm_protetora' },
  { label: 'Hipoglicemia relacionada a TN (n)' },
  { label: 'Adequacao nutricional em VM (n)' },
  { label: 'Pacientes em VM recebendo nutricao (d)' },
  { label: 'Elegiveis para NE (n)' },
  { label: 'NE iniciada em ate 48h (n)' },
  { label: 'Pacientes com sepse/choque (n)' },
  { label: 'Adequacao proteica (n)' },
  { label: 'Interrupcao nao justificada de TN (n)' },
  { label: 'Intolerancia GI grave (n)' },
  { label: 'Constipacao >72h em VM (n)' },
  { label: 'Discussao nutricional em round (n)' },
]

export const COLUNAS_TOTAIS = COLUNAS.length - 2 // fora `mes` e o rótulo livre

/**
 * Quantas colunas saem preenchidas PARA ESTE MÊS.
 *
 * Não é constante: um mês sem registro de fisioterapia ou enfermagem preenche
 * menos colunas. Mostrar um número fixo faria o Flaubert esperar dados que o
 * arquivo não traz.
 */
export function contarPreenchidos(linha: LinhaExport): number {
  return COLUNAS.filter(c =>
    (c.campo != null) ||
    (c.fisio != null && linha.fisio != null) ||
    (c.enf   != null && linha.enfermagem != null)
  ).length
}

/**
 * Número no padrão brasileiro: vírgula decimal. Inteiro sai sem casas — só a
 * mortalidade esperada do SAPS 3 é fracionária, e arredondá-la estragaria o SMR.
 */
function numeroBR(v: number): string {
  return Number.isInteger(v) ? String(v) : String(v).replace('.', ',')
}

function celula(v: string): string {
  // Aspas quando houver o separador, aspas ou quebra de linha.
  return /[";\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/**
 * CSV da linha do mês.
 *
 * Separador `;` e vírgula decimal porque é o que o Excel em pt-BR espera: com
 * vírgula como separador ele jogaria os decimais para a coluna seguinte.
 */
export function gerarCsvDadosMensais(mes: Date, linha: LinhaExport): string {
  const rotuloMes = `${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}`

  const valores = COLUNAS.map((c, i) => {
    if (i === 0) return rotuloMes
    if (i === 1) return ''
    // `?.` proposital: mês sem fisio/enfermagem deixa a célula VAZIA, não zero —
    // zerar apagaria o lançamento manual dele ao colar na planilha.
    const v = c.campo ? linha[c.campo]
            : c.fisio ? linha.fisio?.[c.fisio]
            : c.enf   ? linha.enfermagem?.[c.enf]
            : undefined
    return typeof v === 'number' ? numeroBR(v) : ''
  })

  return [
    COLUNAS.map(c => celula(c.label)).join(';'),
    valores.map(celula).join(';'),
  ].join('\r\n')
}

export function nomeArquivoCsv(mes: Date): string {
  return `dados-mensais-${mes.getFullYear()}-${String(mes.getMonth() + 1).padStart(2, '0')}.csv`
}

// BOM: sem ele o Excel abre o UTF-8 como Latin-1 e os acentos viram lixo.
// Escrito como escape porque o caractere é invisível no fonte — qualquer
// editor poderia removê-lo sem ninguém perceber.
const BOM_UTF8 = String.fromCharCode(0xFEFF)

/** Dispara o download no navegador. */
export function baixarCsv(nome: string, csv: string): void {
  const blob = new Blob([BOM_UTF8 + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  URL.revokeObjectURL(url)
}
