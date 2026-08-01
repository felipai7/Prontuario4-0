// Feature flags do projeto.
// Flags NEXT_PUBLIC_* são resolvidas em build time e funcionam
// tanto em Server Components quanto em Client Components.
//
// Para ativar localmente, adicione no .env.local:
//   NEXT_PUBLIC_FF_NOVA_ESTRUTURA=true

export const featureFlags = {
  /** Nova estrutura do app (em desenvolvimento na branch feature/nova-estrutura) */
  novaEstrutura: process.env.NEXT_PUBLIC_FF_NOVA_ESTRUTURA === 'true',
  /**
   * Extração de exames pelo módulo determinístico local, em vez da IA.
   *
   * Desligada, o comportamento é exatamente o de hoje: todo PDF vai para o
   * Gemini. Ligada, laudos dos laboratórios reconhecidos são lidos na própria
   * máquina e o PDF não sai dela; só documento não reconhecido cai na IA, e o
   * que vier dela nasce marcado para revisão (decisão Q6, 01/08/2026).
   */
  extracaoLocal: process.env.NEXT_PUBLIC_FF_EXTRACAO_LOCAL === 'true',
} as const

export type FeatureFlag = keyof typeof featureFlags

export function isEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag]
}
