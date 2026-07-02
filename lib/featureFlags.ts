// Feature flags do projeto.
// Flags NEXT_PUBLIC_* são resolvidas em build time e funcionam
// tanto em Server Components quanto em Client Components.
//
// Para ativar localmente, adicione no .env.local:
//   NEXT_PUBLIC_FF_NOVA_ESTRUTURA=true

export const featureFlags = {
  /** Nova estrutura do app (em desenvolvimento na branch feature/nova-estrutura) */
  novaEstrutura: process.env.NEXT_PUBLIC_FF_NOVA_ESTRUTURA === 'true',
} as const

export type FeatureFlag = keyof typeof featureFlags

export function isEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag]
}
