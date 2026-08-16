// Catálogo de exames de imagem: modalidade + região, gerando um nome
// canônico único ("TC de Tórax") em vez de texto livre digitado por cada
// pessoa. Levantado a partir dos ~71 nomes distintos já lançados em produção
// pra ~15 exames de fato ("TC DE TORAX", "TC torax", "Tc torax",
// "TOMOGRAFIA COMPUTADORIZADA DE TÓRAX"...) — a lista de regiões por
// modalidade cobre 100% desse histórico real.

export type Modalidade = 'RX' | 'TC' | 'Angio-TC' | 'RM' | 'Angio-RM' | 'Eco' | 'USG'

export const MODALIDADES: readonly Modalidade[] = ['RX', 'TC', 'Angio-TC', 'RM', 'Angio-RM', 'Eco', 'USG']

export const REGIOES_POR_MODALIDADE: Record<Modalidade, readonly string[]> = {
  'RX':       ['Tórax', 'Abdome', 'Crânio', 'Coluna Cervical', 'Coluna Dorsal', 'Coluna Lombar', 'Pelve/Bacia', 'Ombro', 'Joelho', 'Membros'],
  'TC':       ['Tórax', 'Crânio', 'Abdome', 'Abdome Total', 'Abdome Superior', 'Coluna Cervical', 'Coluna Dorsal', 'Coluna Lombar', 'Pelve/Bacia', 'Ombro', 'Membros'],
  'Angio-TC': ['Tórax', 'Crânio', 'Cervical', 'Aorta Torácica', 'Aorta Abdominal', 'Coronárias', 'Membros'],
  'RM':       ['Crânio', 'Coluna Cervical', 'Coluna Dorsal', 'Coluna Lombar', 'Abdome', 'Pelve/Bacia', 'Quadril', 'Joelho', 'Ombro', 'Vias Biliares (ColangioRM)'],
  'Angio-RM': ['Crânio', 'Carótidas e Vertebrais', 'Aorta', 'Renal'],
  'Eco':      ['Transtorácico', 'Transesofágico', 'Controle'],
  'USG':      ['Abdome', 'Abdome Total', 'Doppler de Carótidas e Vertebrais', 'Doppler Venoso de Membros', 'Doppler Arterial de Membros', 'Tireoide', 'Rins e Vias Urinárias', 'Pélvica'],
}

/** "TC" + "Tórax" → "TC de Tórax". Eco tem construção própria
 *  ("Ecocardiograma Transtorácico", "Ecocardiograma (controle)") porque
 *  "Eco de Transtorácico" soa errado — é a única modalidade cujo nome
 *  completo não é ela mesma ("Ecocardiograma", não "Eco"). */
export function nomeCanonico(modalidade: Modalidade, regiao: string): string {
  const r = regiao.trim()
  if (!r) return modalidade
  if (modalidade === 'Eco') return r === 'Controle' ? 'Ecocardiograma (controle)' : `Ecocardiograma ${r}`
  return `${modalidade} de ${r}`
}
