'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Registra o service worker e cuida da troca de versão de forma SEGURA.
 *
 * O problema que isto resolve: quando sai um deploy novo, o app que já está
 * aberto num computador da UTI continua rodando o JavaScript da versão antiga.
 * Se a versão nova assumisse o controle na hora (skipWaiting automático, como
 * era antes), esse JS antigo poderia pedir arquivos que o deploy renomeou →
 * tela branca no meio de um atendimento.
 *
 * A solução (padrão "esperar e avisar"): a versão nova fica em segundo plano,
 * o app mostra um aviso discreto, e a troca só acontece — com um recarregamento
 * limpo — quando a pessoa toca em "Atualizar", na hora conveniente para ela.
 */
export default function ServiceWorkerRegister() {
  const [esperando, setEsperando] = useState<ServiceWorker | null>(null)
  // Só recarregamos a página quando a troca foi pedida pelo usuário. Sem esta
  // trava, o primeiro acesso (quando o SW assume o controle pela 1ª vez) também
  // dispararia um reload desnecessário.
  const trocaPedida = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let registro: ServiceWorkerRegistration | null = null

    // Mostra o aviso só se JÁ existe um SW controlando a página: no primeiro
    // acesso não há versão anterior, então não é "atualização", é instalação.
    const avisarSeHouverEspera = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setEsperando(r.waiting)
    }

    navigator.serviceWorker.register('/sw.js').then((r) => {
      registro = r
      avisarSeHouverEspera(r)

      // Uma versão nova começou a ser baixada: acompanha até terminar de instalar.
      r.addEventListener('updatefound', () => {
        const novo = r.installing
        if (!novo) return
        novo.addEventListener('statechange', () => {
          if (novo.state === 'installed') avisarSeHouverEspera(r)
        })
      })
    }).catch(() => { /* PWA é um extra, nunca deve quebrar o app */ })

    // Quando o SW novo assume, recarrega uma vez para a página inteira ficar
    // consistente com a versão nova. A trava evita recarregar no primeiro acesso
    // e evita reload duplo.
    const aoTrocarControle = () => {
      if (!trocaPedida.current) return
      trocaPedida.current = false
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', aoTrocarControle)

    // Um computador de posto de enfermagem pode ficar com o app aberto o dia
    // inteiro. Sem isto, ele nunca perguntaria por versões novas. Checamos quando
    // a aba volta ao foco e, por garantia, a cada 30 minutos.
    const checar = () => { registro?.update().catch(() => {}) }
    const aoVoltarFoco = () => { if (document.visibilityState === 'visible') checar() }
    document.addEventListener('visibilitychange', aoVoltarFoco)
    const intervalo = window.setInterval(checar, 30 * 60 * 1000)

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', aoTrocarControle)
      document.removeEventListener('visibilitychange', aoVoltarFoco)
      window.clearInterval(intervalo)
    }
  }, [])

  const atualizar = () => {
    if (!esperando) return
    trocaPedida.current = true
    // Pede para a versão nova assumir; o reload acontece no controllerchange.
    esperando.postMessage({ type: 'SKIP_WAITING' })
    setEsperando(null)
  }

  if (!esperando) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] flex justify-center p-3 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 rounded-xl bg-slate-900 text-white shadow-lg
                      px-4 py-3 w-full max-w-md border border-white/10">
        <span className="text-lg" aria-hidden>🔄</span>
        <p className="text-sm flex-1">Uma nova versão do app está pronta.</p>
        <button
          onClick={atualizar}
          className="text-sm font-semibold bg-indigo-500 hover:bg-indigo-400 rounded-lg px-3 py-1.5 whitespace-nowrap"
        >
          Atualizar
        </button>
      </div>
    </div>
  )
}
