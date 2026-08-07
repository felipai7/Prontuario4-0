'use client'
import { useState, useRef, useEffect, type ReactNode } from 'react'

/**
 * Envelope de rolagem horizontal para tabelas largas (pivô de exames, sinais
 * vitais, balanço hídrico...). Uma barra só, grudada (sticky) no topo da
 * área visível enquanto a página rola verticalmente — sem isso, numa tabela
 * alta, a barra nativa só aparece depois de rolar até o fim dela. A rolagem
 * nativa da tabela em si continua funcionando (toque/trackpad); só a barra
 * visível dela fica escondida, pra não duplicar a de cima.
 */
export default function TabelaRolavel({ children, className = '' }: { children: ReactNode; className?: string }) {
  const scrollTopoRef     = useRef<HTMLDivElement>(null)
  const scrollConteudoRef = useRef<HTMLDivElement>(null)
  const [largura, setLargura] = useState(0)

  // Dependência em `children`, não numa contagem de linhas/colunas: cada
  // tabela que usa isto tem sua própria noção do que muda o tamanho (mais um
  // turno, mais uma coleta), e não há uma dependência única e estável pra
  // declarar aqui. `children` muda de referência sempre que o conteúdo pode
  // ter mudado de largura, então reler scrollWidth nesse momento — uma
  // leitura barata — é o que garante a barra de cima não ficar curta depois
  // que a tabela cresce. `setLargura` só re-renderiza quando o valor muda de
  // verdade (bail-out do React), então isto não vira loop.
  useEffect(() => {
    setLargura(scrollConteudoRef.current?.scrollWidth ?? 0)
  }, [children])

  const sincronizarDoTopo = () => {
    if (scrollConteudoRef.current && scrollTopoRef.current) scrollConteudoRef.current.scrollLeft = scrollTopoRef.current.scrollLeft
  }
  const sincronizarDoConteudo = () => {
    if (scrollTopoRef.current && scrollConteudoRef.current) scrollTopoRef.current.scrollLeft = scrollConteudoRef.current.scrollLeft
  }

  return (
    <>
      <div ref={scrollTopoRef} onScroll={sincronizarDoTopo}
        className="sticky top-0 z-30 overflow-x-auto bg-white border-b border-slate-200" style={{ height: 14 }}>
        <div style={{ width: largura, height: 1 }} />
      </div>
      <div ref={scrollConteudoRef} onScroll={sincronizarDoConteudo}
        className={`overflow-x-auto [&::-webkit-scrollbar]:hidden ${className}`}
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
        {children}
      </div>
    </>
  )
}
