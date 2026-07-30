// Gera public/sw.js a partir de public/sw.template.js, carimbando a versão.
//
// Roda automaticamente antes de `next dev` e `next build` (ganchos predev /
// prebuild no package.json). A versão é o hash do commit — é o que muda a cada
// deploy e faz o navegador detectar que há uma versão nova do service worker,
// disparando o aviso de "Atualizar" para a equipe.
//
// Nunca derruba o build: se algo falhar, o app funciona normalmente, só sem o
// cache offline do PWA.

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')

function versao() {
  // Na Vercel o SHA vem pronto na variável de ambiente (sem depender de git).
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8)
  try {
    return execSync('git rev-parse --short HEAD', { cwd: raiz, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim()
  } catch {
    return 'dev-' + Date.now()
  }
}

try {
  const v = versao()
  const template = readFileSync(join(raiz, 'public', 'sw.template.js'), 'utf8')
  writeFileSync(join(raiz, 'public', 'sw.js'), template.split('__SW_VERSION__').join(v))
  console.log('[gen-sw] public/sw.js gerado (versão ' + v + ')')
} catch (e) {
  console.warn('[gen-sw] não foi possível gerar sw.js: ' + e.message)
}
