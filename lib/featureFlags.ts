// Feature flags do projeto.
// Flags NEXT_PUBLIC_* são resolvidas em build time e funcionam
// tanto em Server Components quanto em Client Components.
//
// Para ativar localmente, adicione no .env.local:
//   NEXT_PUBLIC_FF_NOVA_ESTRUTURA=true

export const featureFlags = {
  /** Nova estrutura do app (em desenvolvimento na branch feature/nova-estrutura) */
  novaEstrutura: process.env.NEXT_PUBLIC_FF_NOVA_ESTRUTURA === 'true',
  // `extracaoLocal` existiu aqui até 03/08/2026. Ela escolhia entre ler o
  // laudo localmente e mandá-lo para o Gemini — e desligada (que é como
  // produção estava, sem NEXT_PUBLIC_FF_EXTRACAO_LOCAL em lugar nenhum) todo
  // PDF ia para a IA.
  //
  // Removida a IA, a flag não tinha mais dois lados: desligada, ela deixaria
  // a rota sem NENHUM caminho de leitura, e todo envio de PDF responderia
  // "não reconhecido". Uma flag cujo estado padrão quebra a única
  // funcionalidade que ela governa não é uma trava de segurança, é uma
  // armadilha — por isso saiu junto, e não ficou aqui desligada.
} as const

export type FeatureFlag = keyof typeof featureFlags

export function isEnabled(flag: FeatureFlag): boolean {
  return featureFlags[flag]
}
