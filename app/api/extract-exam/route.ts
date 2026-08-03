import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAI, generateWithFallback } from '@/lib/ai'
import { featureFlags } from '@/lib/featureFlags'
import { extrairExames } from '@/lib/exames/extracao'
import { adaptarParaExames, type ExameParaSalvar } from '@/lib/exames/adaptador'
import { montarEntrega } from '@/lib/exames/entrega'

/**
 * Extração LOCAL, sem mandar o PDF para lugar nenhum.
 *
 * Decisão Q6 (01/08/2026): laudos dos laboratórios reconhecidos são lidos aqui;
 * só documento não reconhecido cai na IA. Devolve `null` quando não reconheceu
 * nada — e é o chamador que decide se aciona o fallback.
 *
 * Nenhum conteúdo do laudo aparece em erro nem em log (R10): o módulo não
 * lança, e o que ele devolve de diagnóstico são contadores e um hash.
 */
async function extrairLocalmente(base64: string): Promise<{
  exames: ExameParaSalvar[]
  laboratorio: string | null
  avisos: string[]
} | null> {
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  const resultado = await extrairExames({
    document: { bytes, filename: null },
    hints: null,
    options: null,
  })
  if (resultado.observations.length === 0) return null
  return {
    exames: adaptarParaExames(montarEntrega(resultado, false)),
    laboratorio: resultado.detection.profileId,
    avisos: resultado.warnings.map(w => w.code),
  }
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  try {
    const body = await request.json()
    const { base64, mediaType, rawText, images } = body
    // images: [{ base64, mediaType }]  — multi-image paste
    // base64 + mediaType               — single file upload
    // rawText                          — plain text paste

    // ── Caminho local ──────────────────────────────────────────────────────
    // Só para PDF: prints colados e texto colado continuam indo para a IA,
    // porque a camada de texto trabalha sobre o arquivo.
    if (featureFlags.extracaoLocal && base64 && mediaType === 'application/pdf') {
      const local = await extrairLocalmente(base64)
      if (local) {
        return NextResponse.json({
          via: 'local',
          laboratorio: local.laboratorio,
          exames: local.exames,
          avisos: local.avisos,
        })
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

    return NextResponse.json({
      via: 'ia',
      tipo_exame:  parsed?.tipo_exame  || 'Exame',
      data_exame:  parsed?.data_exame  || null,
      resultados:  parsed?.resultados  || null,
      observacoes: parsed?.observacoes || null,
      raw_text:    parsed ? null : raw,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
