// ══════════════════════════════════════════════════════════════════════════
// Carga do catálogo clínico.
//
// Os JSON desta pasta são gerados por `scripts/migrate-clinboard-catalog.mts`
// e revisados por decisão clínica — não os edite à mão sem reexecutar o script,
// senão a próxima migração sobrescreve a edição em silêncio.
//
// A carga é feita uma vez, congelada, e compartilhada por leitura. Congelar é o
// que garante que uma extração não consiga alterar o catálogo para a próxima
// (R9) — o objeto é global, mas imutável, e portanto não é estado.
// ══════════════════════════════════════════════════════════════════════════

import type { Analyte, Catalog, QualitativeCode } from '../contratos'
import analitosJson from './analitos.json'
import sinonimosJson from './sinonimos.json'
import qualitativosJson from './qualitativos.json'
import unidadesJson from './unidades.json'

/** Chave de busca: NFC, maiúsculo, espaços colapsados. Igual à da migração. */
export function chaveSinonimo(nome: string): string {
  return nome.normalize('NFC').toUpperCase().replace(/\s+/g, ' ').trim()
}

function congelarProfundo<T>(valor: T): T {
  if (valor && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor)
    for (const v of Object.values(valor)) congelarProfundo(v)
  }
  return valor
}

const CATALOGO: Catalog = congelarProfundo({
  version: analitosJson.version,
  analytes: analitosJson.analytes as unknown as Record<string, Analyte>,
  synonyms: sinonimosJson.synonyms as Record<string, string>,
  qualitative: qualitativosJson.codes as unknown as Record<string, QualitativeCode>,
  units: unidadesJson.canonical as Record<string, string>,
})

export function carregarCatalogo(): Catalog {
  return CATALOGO
}

/** Resolve um nome bruto de laudo para o analito canônico, ou null. */
export function resolverAnalito(nomeBruto: string, catalogo: Catalog = CATALOGO): Analyte | null {
  const id = catalogo.synonyms[chaveSinonimo(nomeBruto)]
  return id ? (catalogo.analytes[id] ?? null) : null
}
