import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getAI, generateWithFallback } from '@/lib/ai'
import { featureFlags } from '@/lib/featureFlags'
import type { ClienteExames } from '@/lib/exames/persistencia'
import { processarPdf, processarIA, type ResultadoIA } from './processar'

/**
 * `ClienteExames` sobre o Supabase de verdade — a única peça de borda que
 * fala com o banco. `processarPdf` (`./processar.ts`) não conhece Supabase,
 * e é isso que permite testá-lo sem servidor nem banco.
 *
 * Tipado com `SupabaseClient` de `@supabase/supabase-js` (dependência direta
 * do projeto — ver `package.json`): não existe um tipo `SupabaseClient`
 * próprio em `lib/`, e inventar um caminho de import seria adivinhação.
 */
function clienteSupabase(supabase: SupabaseClient): ClienteExames {
  return {
    async buscarPorImpressaoDigital(pacienteId, hash) {
      // A coluna `impressao_digital` ainda não existe em produção (pendência
      // externa — ver task-5-report.md). Se a query rejeitar por causa disso,
      // `gravarEntrega` já trata a falha como "nenhum envio anterior
      // encontrado" (não deixa o `.catch` chegar até aqui bloquear nada) —
      // aqui só repassamos o que o Supabase devolveu.
      const { data } = await supabase
        .from('exames')
        .select('created_at')
        .eq('paciente_id', pacienteId)
        .eq('impressao_digital', hash)
        .limit(1)
        .maybeSingle()
      return data ? { dataEnvio: new Date(data.created_at).toLocaleDateString('pt-BR') } : null
    },
    async inserir(linhas) {
      const { error } = await supabase.from('exames').insert(linhas)
      return { erro: error?.message ?? null }
    },
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  try {
    const body = await request.json()
    const { base64, mediaType, rawText, images, pacienteId, pacienteNome, nomeArquivo } = body
    // images: [{ base64, mediaType }]  — multi-image paste
    // base64 + mediaType               — single file upload
    // rawText                          — plain text paste
    // pacienteId / pacienteNome / nomeArquivo — quem recebe o exame e a
    // conferência de nome (A-02). Tarefa 7: os TRÊS caminhos (PDF local, IA
    // sobre print colado, IA sobre texto colado) gravam aqui agora — nenhum
    // deles some sem paciente para não haver onde gravar o exame.
    if (!pacienteId) {
      return NextResponse.json(
        { ok: false, erro: 'Paciente não informado — não há onde gravar o exame.' },
        { status: 400 },
      )
    }

    // ── Caminho local ──────────────────────────────────────────────────────
    // Só para PDF: prints colados e texto colado continuam indo para a IA,
    // porque a camada de texto trabalha sobre o arquivo.
    if (featureFlags.extracaoLocal && base64 && mediaType === 'application/pdf') {
      const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
      const resultado = await processarPdf(
        clienteSupabase(supabase),
        pacienteId,
        bytes,
        nomeArquivo ?? null,
        pacienteNome ?? null,
      )

      // 'NAO_RECONHECIDO' não é uma falha de gravação — é o sinal de que o
      // laudo não foi lido aqui, e por isso segue para a IA (Q6). Qualquer
      // outro `ok: false` É falha de verdade (ex.: A-05, erro do banco) e
      // precisa chegar à tela como erro, não desaparecer num fallback silencioso.
      if (resultado.ok || resultado.erro !== 'NAO_RECONHECIDO') {
        return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 })
      }
      // Não reconhecido: segue para a IA, e o resultado nasce para revisão.
    }

    // A chave da IA só é exigida AQUI, e não na entrada da rota.
    //
    // Exigi-la logo no começo fazia a extração LOCAL — que não usa IA nenhuma,
    // que é o ponto da decisão Q6 — ser recusada em qualquer ambiente sem a
    // chave configurada. Apareceu na primeira vez que um PDF passou pela tela.
    if (!process.env.GOOGLEAISTUDIO_API_KEY) {
      return NextResponse.json({
        error: featureFlags.extracaoLocal
          ? 'Laboratório não reconhecido pela extração local, e a chave da IA não está configurada para o caminho alternativo.'
          : 'Google AI API Key não configurada',
      }, { status: 500 })
    }

    const ai = getAI()

    const prompt =
      'Analise este resultado de exame médico laboratorial.\n' +
      'RESPONDA SOMENTE com um objeto JSON válido, sem texto antes ou depois, sem blocos markdown.\n' +
      'Formato obrigatório:\n' +
      '{"data_exame":"DD/MM/AAAA HH:MM (inclua horário de coleta se disponível) ou DD/MM/AAAA ou null","tipo_exame":"nome do painel",' +
      '"resultados":[{"nome":"parâmetro","valor":"valor","unidade":"unidade ou null",' +
      '"referencia":"referência ou null","alterado":true/false,"direcao":"alto|baixo|normal|qualitativo"}],' +
      '"observacoes":"observações ou null"}\n' +
      'Regras: inclua TODOS os parâmetros sem exceção; use conhecimento médico para "alterado" mesmo sem referência; ' +
      '"direcao" = alto se acima do normal, baixo se abaixo, qualitativo se positivo/negativo/reagente; ' +
      'data_exame é a data de COLETA (não liberação), null se ausente; ' +
      'se houver múltiplos painéis ou imagens combine tudo em um único JSON com todos os resultados.'

    let contents: any[]
    if (rawText) {
      contents = [`${prompt}\n\nTexto do laudo:\n${rawText}`]
    } else if (images && Array.isArray(images) && images.length > 0) {
      // Multiple images: interleave each image then the prompt at the end
      contents = [
        ...images.map((img: { base64: string; mediaType: string }) => ({
          inlineData: { mimeType: img.mediaType, data: img.base64 },
        })),
        prompt,
      ]
    } else {
      contents = [{ inlineData: { mimeType: mediaType, data: base64 } }, prompt]
    }

    const raw = await generateWithFallback(ai, contents)

    // Robust JSON extraction — try multiple strategies
    function tryParse(s: string): any { try { return JSON.parse(s) } catch { return null } }
    let parsed: any =
      tryParse(raw) ??
      (() => { const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/); return m ? tryParse(m[1].trim()) : null })() ??
      (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? tryParse(m[0]) : null })() ??
      (() => { const i = raw.indexOf('{'); return i >= 0 ? tryParse(raw.slice(i)) : null })() ??
      null

    if (!parsed) {
      // Antes da Tarefa 7, JSON malformado da IA ainda virava exame "salvo"
      // com o texto cru em `raw_text`, para leitura manual depois.
      // `processarIA` (Tarefa 6b) grava sempre `raw_text: null` — gravar do
      // mesmo jeito aqui produziria um registro vazio, só com o marcador de
      // IA e nenhum conteúdo visível. Melhor avisar e deixar tentar de novo
      // do que um exame fantasma no prontuário.
      return NextResponse.json(
        { ok: false, erro: 'Não foi possível interpretar a resposta da IA para este laudo. Tente novamente ou use outro formato.' },
        { status: 500 },
      )
    }

    // Tarefa 7 — o caminho da IA (prints, texto colado, PDF não reconhecido
    // localmente) passa a gravar aqui via `processarIA`, e devolve o mesmo
    // formato `RespostaExtracao` do caminho local: é isso que permite a tela
    // tratar os dois com um único contrato (pendências, conferência de
    // paciente, duplicata), sem `if (data.via === 'local')` espalhado.
    const resultadoIA: ResultadoIA = {
      tipo_exame: parsed.tipo_exame || 'Exame',
      data_exame: parsed.data_exame || null,
      resultados: parsed.resultados || null,
      observacoes: parsed.observacoes || null,
    }

    const resultado = await processarIA(clienteSupabase(supabase), pacienteId, resultadoIA, nomeArquivo ?? null)
    return NextResponse.json(resultado, { status: resultado.ok ? 200 : 500 })
  } catch {
    // R10 — a mensagem original de exceção pode carregar trecho do que foi
    // enviado. O módulo local nunca lança (contrato de `extrairExames`), mas
    // o caminho da IA pode (rede, parsing, etc.), e a mensagem dele não é
    // confiável para devolver ao navegador crua.
    return NextResponse.json(
      { ok: false, erro: 'Não foi possível ler este laudo. Tente novamente ou use outro formato.' },
      { status: 500 },
    )
  }
}
