// Exporta as contagens do mês no formato da aba "Dados Mensais" da planilha do
// Dr. Flaubert — mesma ordem de colunas, mesmos rótulos. A ideia é que ele cole
// a linha na planilha dele e a aba "Indicadores" recalcule sozinha: enquanto o
// app não faz tudo, ele confere um contra o outro em vez de escolher um dos dois.

import type {
  ContagensMes, ContagensFisioMes, ContagensEnfermagemMes, ContagensNutricaoMes, ContagensIrasMes,
} from '@/types'

/** Contagens do mês + os campos que vêm de lib/config.ts, não do banco. */
export interface LinhaExport extends ContagensMes {
  leitos_dia: number
  leitos_ativos: number
  /** Null = mês sem registro daquele módulo; as colunas dele saem vazias. */
  fisio?: ContagensFisioMes | null
  enfermagem?: ContagensEnfermagemMes | null
  nutricao?: ContagensNutricaoMes | null
  iras?: ContagensIrasMes | null
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
  /** Campos por módulo — a célula fica vazia se o mês não tiver registro dele. */
  fisio?: keyof ContagensFisioMes
  enf?: keyof ContagensEnfermagemMes
  nut?: keyof ContagensNutricaoMes
  iras?: keyof ContagensIrasMes
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
  { label: 'Total de IRAS (eventos) no mes',                          iras: 'total_iras' },
  { label: 'Pacientes com pelo menos uma IRAS',                       iras: 'pacientes_com_iras' },
  { label: 'Total de pacientes internados no mes',                    campo: 'pacientes_internados_mes' },
  // A planilha nunca separou LPP adquirida de LPP de admissão, então esta
  // coluna leva o TOTAL — é o que mantém a série histórica dele comparável.
  { label: 'Total de LPP (eventos) no mes',                            enf: 'lpp_total' },
  { label: 'Pneumonia nosocomial (mes)',                              iras: 'pneumonia' },
  { label: 'Traqueite nosocomial (mes)',                              iras: 'traqueite' },
  { label: 'IPCS laboratorial (hemocultura +)',                       iras: 'ipcs_lab' },
  { label: 'IPCS clinica (sem confirmacao laboratorial)',             iras: 'ipcs_clinica' },
  { label: 'ITU associada a SVD',                                     iras: 'itu_svd' },
  { label: 'PAV (mes)',                                               iras: 'pav' },
  { label: 'CVC-dia (soma do mes)',                                   enf: 'cvc_dia' },
  { label: 'SVD-dia (soma do mes)',                                   enf: 'svd_dia' },
  { label: 'Ventilador-dia (soma do mes)',                            campo: 'ventilador_dia' },
  { label: 'Pacientes que realizaram hemodialise/TRS',                campo: 'pacientes_hemodialise' },
  { label: 'NP >70% da meta (n)',                                     nut: 'dias_np_adequado' },
  { label: 'Total recebendo NP (d)',                                  nut: 'dias_np' },
  { label: 'NE >70% da meta (n)',                                     nut: 'dias_ne_adequado' },
  { label: 'Total recebendo NE (d)',                                  nut: 'dias_ne' },
  { label: 'VO com aceitacao >60% (n)',                               nut: 'dias_vo_adequado' },
  { label: 'Total recebendo VO (d)',                                  nut: 'dias_vo' },
  { label: 'Deficit/risco nutricional (n)',                           nut: 'deficit_risco' },
  { label: 'Avaliados pela nutricao (d)',                             nut: 'avaliados' },
  { label: 'Avaliacao nutricional em ate 24h (n)',                    nut: 'avaliados_ate_24h' },
  { label: 'Admissoes elegiveis para avaliacao 24h (d)',              nut: 'admissoes_elegiveis_24h' },
  { label: 'Jejum >24h antes da TN (n)',                              nut: 'jejum_maior_24h' },
  { label: 'Elegiveis/candidatos para terapia nutricional (d)',       nut: 'elegiveis_tn' },
  { label: 'Diarreia em pacientes com NE (n)',                        nut: 'pacientes_diarreia_ne' },
  { label: 'Diarreia em pacientes com VO (n)',                        nut: 'pacientes_diarreia_vo' },
  { label: 'Pacientes constipados (n)',                               nut: 'constipados' },
  { label: 'Total avaliados para constipacao (d)',                    nut: 'avaliados_constipacao' },
  { label: 'Constipacao em uso de opioide (n)',                       nut: 'constipados_opioide' },
  { label: 'Total em uso de opioide (d)',                             nut: 'pacientes_opioide' },
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
  { label: 'Hipoglicemia relacionada a TN (n)',                       nut: 'hipoglicemia_tn' },
  { label: 'Adequacao nutricional em VM (n)',                         nut: 'dias_vm_nutricao_adequada' },
  { label: 'Pacientes em VM recebendo nutricao (d)',                  nut: 'dias_vm_com_nutricao' },
  { label: 'Elegiveis para NE (n)',                                   nut: 'elegiveis_ne' },
  { label: 'NE iniciada em ate 48h (n)',                              nut: 'ne_iniciada_ate_48h' },
  { label: 'Pacientes com sepse/choque (n)',                          iras: 'sepse_choque' },
  // "Adequacao proteica (n)" na planilha é sobre elegíveis (25/95 no exemplo):
  // corresponde ao por-paciente do app (média ≥80%), não aos dias.
  { label: 'Adequacao proteica (n)',                                  nut: 'pacientes_proteica_media_ok' },
  { label: 'Interrupcao nao justificada de TN (n)',                   nut: 'interrupcao_tn' },
  { label: 'Intolerancia GI grave (n)',                               nut: 'intolerancia_gi' },
  { label: 'Constipacao >72h em VM (n)',                              nut: 'constipacao_vm' },
  { label: 'Discussao nutricional em round (n)',                      nut: 'dias_discutidos_round' },
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
    (c.enf   != null && linha.enfermagem != null) ||
    (c.nut   != null && linha.nutricao != null) ||
    (c.iras  != null && linha.iras != null)
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
    // `?.` proposital: mês sem registro de um módulo deixa a célula VAZIA, não
    // zero — zerar apagaria o lançamento manual dele ao colar na planilha.
    const v = c.campo ? linha[c.campo]
            : c.fisio ? linha.fisio?.[c.fisio]
            : c.enf   ? linha.enfermagem?.[c.enf]
            : c.nut   ? linha.nutricao?.[c.nut]
            : c.iras  ? linha.iras?.[c.iras]
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
