import type { Exame } from '@/types'

// ══════════════════════════════════════════════════════════════════════════
// Agrupamento de exames laboratoriais por horário de coleta.
//
// Antes, cada linha do banco (cada print enviado) virava uma coluna. Isso fazia
// exames da MESMA coleta, enviados em prints separados, aparecerem em colunas
// diferentes. Aqui juntamos por horário: exames dentro de uma janela de poucos
// minutos viram UMA coluna; horários genuinamente distintos, colunas distintas.
//
// A ordem devolvida é do MAIS NOVO para o mais antigo (esquerda → direita).
// ══════════════════════════════════════════════════════════════════════════

/** Tolerância padrão: exames a menos disto um do outro são a mesma coleta. */
export const TOLERANCIA_MIN = 10

export interface ClusterExames {
  /** Estável para o React: id do exame-âncora (o mais antigo do grupo). */
  key: string
  /** Instante representativo (o mais antigo do grupo), em ms. */
  timestamp: number
  /** "DD/MM/AAAA" para o cabeçalho, ou null se o exame não tinha data. */
  dataLabel: string | null
  /** "HH:MM" para o cabeçalho, ou null se não havia hora. */
  horaLabel: string | null
  /** Exames do grupo, ordenados por created_at ascendente. */
  exames: Exame[]
}

/**
 * Instante do exame em ms, considerando data E hora.
 *
 * `data_exame` é texto livre: "DD/MM/AAAA" ou "DD/MM/AAAA HH:MM". Sem data,
 * cai no created_at — assim cada envio sem data vira sua própria coluna (o
 * created_at é preciso ao segundo e não colide com o de outro envio).
 */
export function parseExameTimestamp(ex: Exame): number {
  if (ex.data_exame) {
    const [datePart, timePart] = ex.data_exame.trim().split(/\s+/)
    const [d, m, y] = (datePart ?? '').split('/')
    if (d && m && y) {
      const hhmm = /^\d{1,2}:\d{2}$/.test(timePart ?? '') ? timePart : '00:00'
      const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}T${hhmm.padStart(5, '0')}:00`
      const ts = new Date(iso).getTime()
      if (!isNaN(ts)) return ts
    }
  }
  return new Date(ex.created_at).getTime()
}

/** Extrai "DD/MM/AAAA" e "HH:MM" (se houver) do texto de data do exame. */
function rotulos(ex: Exame): { dataLabel: string | null; horaLabel: string | null } {
  if (!ex.data_exame) return { dataLabel: null, horaLabel: null }
  const [datePart, timePart] = ex.data_exame.trim().split(/\s+/)
  return {
    dataLabel: datePart || null,
    horaLabel: /^\d{1,2}:\d{2}$/.test(timePart ?? '') ? timePart : null,
  }
}

/**
 * Agrupa exames por horário de coleta e devolve os grupos do mais novo ao mais
 * antigo.
 *
 * Dois exames caem no mesmo grupo se seus horários estão dentro de
 * `toleranciaMin` do horário-âncora (o primeiro do grupo). Ancorar no primeiro,
 * e não no anterior, evita que uma sequência 12:00, 12:08, 12:16... se encadeie
 * num grupo só — cada grupo fica limitado a uma janela de `toleranciaMin`.
 */
export function agruparExamesPorHorario(
  exames: Exame[],
  toleranciaMin: number = TOLERANCIA_MIN,
): ClusterExames[] {
  const tolMs = toleranciaMin * 60_000

  // Ordena por horário; empate desfeito pelo created_at, para o resultado ser
  // estável independentemente da ordem em que os exames chegaram.
  const ordenados = [...exames]
    .map(ex => ({ ex, ts: parseExameTimestamp(ex), criado: new Date(ex.created_at).getTime() }))
    .sort((a, b) => a.ts - b.ts || a.criado - b.criado)

  const grupos: { ancora: number; itens: typeof ordenados }[] = []
  for (const item of ordenados) {
    const atual = grupos[grupos.length - 1]
    if (atual && item.ts - atual.ancora <= tolMs) {
      atual.itens.push(item)
    } else {
      grupos.push({ ancora: item.ts, itens: [item] })
    }
  }

  const clusters: ClusterExames[] = grupos.map(g => {
    // Âncora = exame mais antigo do grupo; dá key, timestamp e rótulos.
    const ancoraEx = g.itens[0].ex
    const { dataLabel, horaLabel } = rotulos(ancoraEx)
    return {
      key: ancoraEx.id,
      timestamp: g.ancora,
      dataLabel,
      horaLabel,
      exames: g.itens
        .map(i => i.ex)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    }
  })

  // Mais novo primeiro (fica à esquerda na tabela).
  return clusters.sort((a, b) => b.timestamp - a.timestamp)
}
