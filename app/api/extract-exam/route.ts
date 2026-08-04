import { NextRequest, NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import type { ClienteExames } from '@/lib/exames/persistencia'
import { processarPdf } from './processar'

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
      // Repassa a mensagem do PostgREST INTEIRA, sem reescrever: é nela que
      // vem o código PGRST204 de coluna inexistente, e é por ele que
      // `inserirTolerandoImpressaoDigital` decide regravar sem
      // `impressao_digital` enquanto o ALTER TABLE não roda (C1). Encurtar
      // esta string desliga a tolerância sem quebrar teste nenhum.
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
    const { base64, mediaType, pacienteId, pacienteNome, nomeArquivo } = body
    // base64 + mediaType               — o PDF enviado
    // pacienteId / pacienteNome / nomeArquivo — quem recebe o exame e a
    // conferência de nome (A-02).
    //
    // Em 03/08/2026 a IA saiu daqui (decisão da Juliana). Com ela saíram os
    // outros dois corpos que só existiam para alimentá-la: `rawText` (texto
    // colado) e `images` (prints colados). Nenhum dos dois tem PDF para o
    // leitor local abrir, e aceitar o campo calado faria a rota responder
    // "não reconhecido" a um envio que ela nunca teve como ler.
    if (!pacienteId) {
      return NextResponse.json(
        { ok: false, erro: 'Paciente não informado — não há onde gravar o exame.' },
        { status: 400 },
      )
    }

    // Só PDF. Antes a rota aceitava imagem porque a IA lia imagem; o leitor
    // local trabalha sobre a camada de texto do arquivo e não tem o que fazer
    // com um print. A tela já só oferece PDF — isto é a trava do lado do
    // servidor, para um envio antigo ou um cliente desatualizado não cair no
    // "não reconhecido" com a explicação errada.
    if (!base64 || mediaType !== 'application/pdf') {
      return NextResponse.json(
        {
          ok: false,
          erro: 'Só arquivo PDF é lido aqui. Para print, foto ou texto copiado, '
            + 'digite os resultados na aba Manual.',
        },
        { status: 400 },
      )
    }

    const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
    const resultado = await processarPdf(
      clienteSupabase(supabase),
      pacienteId,
      bytes,
      nomeArquivo ?? null,
      pacienteNome ?? null,
    )

    if (resultado.ok) return NextResponse.json(resultado, { status: 200 })

    // Duas falhas diferentes, e a diferença importa para quem lê o log às 3h:
    // `diagnostico` presente = o documento não foi reconhecido (422, nada
    // quebrou); ausente = a GRAVAÇÃO falhou (500, A-05).
    //
    // O diagnóstico vai para o log e NÃO para a resposta: ele é seguro por
    // construção (perfil, códigos de aviso, contagens — R10), mas a tela não
    // tem o que fazer com ele, e resposta menor é resposta que não vaza por
    // descuido amanhã.
    if (resultado.diagnostico) {
      console.error('[extract-exam] nao reconhecido:', JSON.stringify(resultado.diagnostico))
      return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 422 })
    }

    return NextResponse.json({ ok: false, erro: resultado.erro }, { status: 500 })
  } catch (e) {
    // R10 — a mensagem original de exceção pode carregar trecho do que foi
    // enviado, e por isso nunca é devolvida crua.
    //
    // O que VAI para o log é o NOME do erro e as três primeiras linhas da
    // pilha — arquivo e linha, nunca a mensagem. Isso diz ONDE quebrou sem
    // dizer O QUE estava sendo lido, que é a distinção que R10 exige.
    //
    // Existe porque a primeira falha em produção foi impossível de
    // diagnosticar: a tela dizia "não foi possível ler" e o servidor não
    // guardava nada. Tirar a mensagem sem pôr um diagnóstico no lugar deixa
    // o defeito invisível dos dois lados.
    //
    // Continua valendo sem a IA: `extrairExames` não lança (contrato do
    // módulo), mas `request.json()`, o decode do base64 e o cliente do
    // Supabase lançam — e agora qualquer coisa que caia aqui é local, que é
    // metade do motivo de a IA ter saído.
    const err = e as { name?: string; stack?: string }
    console.error('[extract-exam] falhou:', err?.name ?? 'erro sem nome',
      (err?.stack ?? '').split('\n').slice(1, 4).join(' | '))

    return NextResponse.json(
      { ok: false, erro: 'Não foi possível ler este laudo. Digite os resultados na aba Manual.' },
      { status: 500 },
    )
  }
}
