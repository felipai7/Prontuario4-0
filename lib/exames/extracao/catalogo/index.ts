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

import type { Analyte, Catalog, QualitativeCode, SpecimenContext } from '../contratos'
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

/**
 * Vocabulário restrito a um espécime (R6).
 *
 * "Glicose" dentro de uma seção de urina é glicose urinária; no sangue, é
 * glicemia; no líquor, é outra coisa. Estas tabelas só são consultadas quando
 * a estrutura do documento PROVOU o contexto naquele ponto — nunca por
 * herança, nunca por estado de módulo.
 */
const POR_ESPECIME = congelarProfundo(
  sinonimosJson.bySpecimen as Record<string, Record<string, string>>,
)

/**
 * Resolve um nome bruto de laudo para o analito canônico, ou null.
 *
 * `especime` é o escopo provado pelo documento naquele ponto. Sem ele, só o
 * vocabulário global é consultado — que é o comportamento certo para uma linha
 * fora de qualquer seção com contexto.
 */
export function resolverAnalito(
  nomeBruto: string,
  especime: SpecimenContext | null = null,
  catalogo: Catalog = CATALOGO,
): Analyte | null {
  const chave = chaveSinonimo(nomeBruto)
  if (especime) {
    const escopo = POR_ESPECIME[especime]
    const idEscopo = escopo?.[chave]
    if (idEscopo) return catalogo.analytes[idEscopo] ?? null
  }
  const id = catalogo.synonyms[chave]
  return id ? (catalogo.analytes[id] ?? null) : null
}
