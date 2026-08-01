// ══════════════════════════════════════════════════════════════════════════
// Camada 2 · detecção do laboratório emissor.
//
// A4 — score bruto NÃO é confiança. Abaixo do limiar o resultado é "não
// reconhecido" com aviso explícito, nunca um fallback calado para um perfil
// genérico que se comporta diferente. Empate resolve por regra declarada, e
// não pela ordem em que o perfil foi registrado num array.
//
// Nada de porta de entrada dura: os sinais SOMAM confiança, nenhum aborta a
// detecção. No doador, o perfil de um hospital exige a string do analisador
// hematológico, e um laudo só de bioquímica do mesmo hospital cai no genérico.
//
// Função pura sobre texto: testável sem nenhum PDF em disco (7.B-12).
// ══════════════════════════════════════════════════════════════════════════

import type { DetectionEvidence, DocumentText, LabDetection, LabProfile } from '../contratos'
import hoc from '../perfis/hoc/perfil.json'
import hugo from '../perfis/hugo/perfil.json'
import imec from '../perfis/imec/perfil.json'
import nucleo from '../perfis/nucleo/perfil.json'
import piox from '../perfis/piox/perfil.json'

/**
 * Os perfis conhecidos.
 *
 * `generic` não entra: ele não é um laboratório a detectar, é o comportamento
 * base de quem não foi reconhecido. Listá-lo aqui reintroduziria o fallback
 * silencioso que A4 proíbe.
 */
export const PERFIS: readonly LabProfile[] = Object.freeze(
  [hoc, hugo, imec, nucleo, piox] as unknown as LabProfile[],
)

/**
 * Peso máximo que um perfil pode somar. Serve de denominador da confiança —
 * sem ele, um perfil com muitos sinais pareceria sempre mais confiável.
 */
function tetoDe(perfil: LabProfile): number {
  return perfil.fingerprint.signals.reduce((soma, s) => soma + s.weight, 0)
}

interface Pontuacao {
  perfil: LabProfile
  score: number
  evidencias: DetectionEvidence[]
  /** Um sinal institucional vale mais que a soma: identifica o LUGAR. */
  temInstitucional: boolean
}

function pontuar(perfil: LabProfile, texto: DocumentText): Pontuacao {
  let score = 0
  let temInstitucional = false
  const evidencias: DetectionEvidence[] = []

  for (const sinal of perfil.fingerprint.signals) {
    const re = new RegExp(sinal.pattern, 'i')
    for (const linha of texto.lines) {
      if (!re.test(linha.text)) continue
      score += sinal.weight
      if (sinal.kind === 'institutional') temInstitucional = true
      evidencias.push({
        signalId: sinal.id,
        kind: sinal.kind,
        weight: sinal.weight,
        page: linha.page,
        lineIndex: linha.index,
      })
      break // um sinal conta uma vez, por mais que se repita entre páginas
    }
  }

  return { perfil, score, evidencias, temInstitucional }
}

/**
 * Detecta o laboratório emissor a partir do texto já extraído.
 *
 * Regra de desempate, declarada aqui e em nenhum outro lugar:
 *   1. maior score;
 *   2. entre scores iguais, quem tem sinal institucional vence — CNES e CNPJ
 *      identificam o estabelecimento; modelo de analisador e nome de LIS
 *      identificam o FORNECEDOR, e colidem entre laboratórios da mesma região
 *      que compraram o mesmo sistema;
 *   3. persistindo, ninguém vence: o resultado é `null` com os empatados
 *      listados, porque escolher por ordem de array seria escolher por acaso.
 */
export function detectar(texto: DocumentText): LabDetection {
  const pontuacoes = PERFIS
    .map(p => pontuar(p, texto))
    .filter(p => p.score >= p.perfil.fingerprint.threshold)
    .sort((a, b) =>
      b.score - a.score ||
      Number(b.temInstitucional) - Number(a.temInstitucional))

  if (pontuacoes.length === 0) {
    return { profileId: null, confidence: 0, evidence: [], tiedWith: [] }
  }

  const melhor = pontuacoes[0]!
  const empatados = pontuacoes.filter(
    p => p.score === melhor.score && p.temInstitucional === melhor.temInstitucional,
  )

  if (empatados.length > 1) {
    return {
      profileId: null,
      confidence: 0,
      evidence: melhor.evidencias,
      tiedWith: empatados.map(p => p.perfil.id).sort(),
    }
  }

  return {
    profileId: melhor.perfil.id,
    confidence: Math.min(1, melhor.score / tetoDe(melhor.perfil)),
    evidence: melhor.evidencias,
    tiedWith: [],
  }
}

/** O perfil pelo id, para o motor carregar o que a detecção escolheu. */
export function perfilPorId(id: string): LabProfile | null {
  return PERFIS.find(p => p.id === id) ?? null
}
