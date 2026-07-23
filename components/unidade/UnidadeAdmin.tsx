'use client'
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import ToastContainer, { useToast } from '@/components/ui/Toast'
import { normalizarCodigo } from '@/lib/unidade'
import type { Unit, Ala, Leito } from '@/types'

interface Props {
  souChefe: boolean
  userEmail: string
  /** Lista inicial, vinda do servidor. Depois é mantida em estado local. */
  units: Unit[]
  meuNome: string
}

/** Hoje em ISO, no fuso de Brasília — é a data que carimba vigência de leito. */
function hojeISO(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function fmtData(iso: string): string {
  const [a, m, d] = iso.split('-')
  return `${d}/${m}/${a}`
}

export default function UnidadeAdmin({ souChefe, userEmail, units: unitsIniciais, meuNome }: Props) {
  const router = useRouter()
  const supabase = createClient()
  const { toasts, showToast, removeToast } = useToast()

  // A lista vive em estado, e não só na prop do servidor: router.refresh() não
  // trouxe a unidade recém-criada (a tela só a mostrava depois de um recarregar
  // completo), então a releitura é feita aqui, explicitamente.
  const [units, setUnits] = useState<Unit[]>(unitsIniciais)
  const [unidadeId, setUnidadeId] = useState(unitsIniciais[0]?.id ?? '')
  const [alas, setAlas] = useState<Ala[]>([])
  const [leitos, setLeitos] = useState<Leito[]>([])
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async (unitId: string) => {
    if (!unitId) { setAlas([]); setLeitos([]); return }
    setCarregando(true)
    const { data: alasData, error: e1 } = await supabase
      .from('alas').select('*').eq('unit_id', unitId).order('ordem')
    if (e1) { showToast('Erro ao carregar alas: ' + e1.message, 'error'); setCarregando(false); return }

    const lista = (alasData as Ala[]) ?? []
    setAlas(lista)

    if (lista.length === 0) { setLeitos([]); setCarregando(false); return }
    const { data: leitosData, error: e2 } = await supabase
      .from('leitos').select('*').in('ala_id', lista.map(a => a.id)).order('numero')
    if (e2) showToast('Erro ao carregar leitos: ' + e2.message, 'error')
    setLeitos((leitosData as Leito[]) ?? [])
    setCarregando(false)
  }, [])

  useEffect(() => { carregar(unidadeId) }, [unidadeId, carregar])

  const hoje = hojeISO()
  const vigente = (l: Leito) => l.ativo_desde <= hoje && (l.ativo_ate === null || l.ativo_ate >= hoje)
  const leitosDaAla = (alaId: string) => leitos.filter(l => l.ala_id === alaId)
  const totalVigentes = leitos.filter(vigente).length

  // ── Unidade ─────────────────────────────────────────────────────────────
  const [novaUnidade, setNovaUnidade] = useState('')

  const recarregarUnidades = useCallback(async (): Promise<Unit[]> => {
    const { data } = await supabase.from('units').select('*').order('name')
    const lista = (data as Unit[]) ?? []
    setUnits(lista)
    return lista
  }, [])

  const criarUnidade = async () => {
    const nome = novaUnidade.trim()
    if (!nome) return
    // RPC e não INSERT: a unidade precisa nascer já com um chefe, senão fica
    // órfã e invisível (o RLS de units exige vínculo para enxergar).
    const { error } = await supabase.rpc('criar_unidade', { p_nome: nome, p_meu_nome: meuNome })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setNovaUnidade('')

    const antes = new Set(units.map(u => u.id))
    const lista = await recarregarUnidades()
    // Já pula para a unidade nova: o passo seguinte é sempre cadastrar as alas
    // e os leitos dela, e sem isso ela nasce sem mapa de leitos.
    //
    // A unidade nova é identificada por diferença de conjunto, e não pelo uuid
    // devolvido pela RPC (que não chega como string simples) nem pelo nome
    // (que pode repetir). Assim não depende do formato da resposta.
    const nova = lista.find(u => !antes.has(u.id))
    if (nova) setUnidadeId(nova.id)

    showToast(`Unidade "${nome}" criada. Cadastre as alas e os leitos dela.`)
  }

  const renomearUnidade = async (u: Unit) => {
    const nome = prompt('Novo nome da unidade:', u.name)?.trim()
    if (!nome || nome === u.name) return
    const { error } = await supabase.from('units').update({ name: nome }).eq('id', u.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    await recarregarUnidades()
    showToast('Unidade renomeada.')
    // O nome da unidade aparece no cabeçalho do painel — o servidor precisa saber.
    router.refresh()
  }

  // ── Alas ────────────────────────────────────────────────────────────────
  const [novaAlaNome, setNovaAlaNome] = useState('')

  const criarAla = async () => {
    const nome = novaAlaNome.trim()
    if (!nome) return
    const codigo = normalizarCodigo(nome)
    if (!codigo) { showToast('Nome de ala inválido.', 'error'); return }
    if (alas.some(a => a.codigo === codigo)) { showToast('Já existe uma ala com esse código.', 'error'); return }

    const { error } = await supabase.from('alas').insert({
      unit_id: unidadeId, codigo, nome, ordem: alas.length + 1,
    })
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setNovaAlaNome('')
    showToast(`Ala "${nome}" criada (código ${codigo}).`)
    carregar(unidadeId)
  }

  const renomearAla = async (a: Ala) => {
    const nome = prompt(`Novo nome para "${a.nome}":`, a.nome)?.trim()
    if (!nome || nome === a.nome) return
    // O CÓDIGO NÃO MUDA de propósito: ele está gravado em pacientes.ala_id de
    // todo mundo que já passou pela ala. Renomear é rótulo; trocar o código
    // seria reescrever o histórico.
    const { error } = await supabase.from('alas').update({ nome }).eq('id', a.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    carregar(unidadeId)
  }

  const alternarAla = async (a: Ala) => {
    if (a.ativa && !confirm(
      `Desativar "${a.nome}"?\n\nA ala some do mapa de leitos e para de contar na ocupação. ` +
      `Os pacientes que passaram por ela continuam no histórico.`)) return
    const { error } = await supabase.from('alas').update({ ativa: !a.ativa }).eq('id', a.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    carregar(unidadeId)
  }

  // ── Leitos ──────────────────────────────────────────────────────────────
  const [faixa, setFaixa] = useState<Record<string, { de: string; ate: string }>>({})

  const addLeitos = async (a: Ala) => {
    const f = faixa[a.id] ?? { de: '', ate: '' }
    const de = parseInt(f.de, 10)
    const ate = f.ate.trim() === '' ? de : parseInt(f.ate, 10)
    if (!Number.isFinite(de) || !Number.isFinite(ate) || de < 1 || ate < de) {
      showToast('Faixa de leitos inválida.', 'error'); return
    }
    if (ate - de > 99) { showToast('Faixa muito longa (máx. 100 leitos por vez).', 'error'); return }

    const jaExistem = new Set(leitos.map(l => `${l.ala_id}:${l.numero}`))
    const novos = []
    for (let n = de; n <= ate; n++) {
      if (jaExistem.has(`${a.id}:${n}`)) continue
      // ativo_desde = HOJE, nunca uma data antiga. Se um leito novo nascesse
      // valendo desde sempre, a taxa de ocupação dos meses passados mudaria
      // sozinha — a unidade teria "mais leitos" em janeiro do que teve de fato.
      novos.push({ ala_id: a.id, numero: n, ativo_desde: hoje })
    }
    if (novos.length === 0) { showToast('Esses leitos já existem nesta ala.', 'error'); return }

    const { error } = await supabase.from('leitos').insert(novos)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    setFaixa(f2 => ({ ...f2, [a.id]: { de: '', ate: '' } }))
    showToast(`${novos.length} leito(s) adicionado(s), valendo a partir de hoje.`)
    carregar(unidadeId)
  }

  const desativarLeito = async (l: Leito) => {
    if (!confirm(
      `Desativar o leito ${l.numero}?\n\nEle sai do mapa a partir de hoje (${fmtData(hoje)}), ` +
      `mas continua contando nos leitos-dia dos meses em que existiu — a ocupação do passado não muda.`)) return
    const { error } = await supabase.from('leitos').update({ ativo_ate: hoje }).eq('id', l.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    carregar(unidadeId)
  }

  const reativarLeito = async (l: Leito) => {
    if (!confirm(
      `Reativar o leito ${l.numero}?\n\nAtenção: o período em que ele ficou desativado ` +
      `(desde ${fmtData(l.ativo_ate!)}) some do histórico, e a ocupação daqueles meses será ` +
      `recalculada como se o leito nunca tivesse parado.`)) return
    const { error } = await supabase.from('leitos').update({ ativo_ate: null }).eq('id', l.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    carregar(unidadeId)
  }

  const apagarLeito = async (l: Leito) => {
    if (!confirm(
      `APAGAR o leito ${l.numero} de vez?\n\nUse isto só para corrigir um cadastro errado. ` +
      `Para um leito que existiu de verdade, prefira "desativar" — apagar reescreve os ` +
      `leitos-dia de todos os meses passados.`)) return
    const { error } = await supabase.from('leitos').delete().eq('id', l.id)
    if (error) { showToast('Erro: ' + error.message, 'error'); return }
    carregar(unidadeId)
  }

  if (!souChefe) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center space-y-3">
          <p className="text-4xl">🔒</p>
          <h1 className="text-lg font-bold text-slate-800">Acesso restrito</h1>
          <p className="text-sm text-slate-500">
            A configuração da unidade é responsabilidade do Médico Intensivista.
          </p>
          <button onClick={() => router.push('/dashboard')}
            className="mt-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2 rounded-lg text-sm">
            Voltar ao painel
          </button>
        </div>
      </div>
    )
  }

  const unidadeAtual = units.find(u => u.id === unidadeId)

  return (
    <div className="min-h-screen bg-slate-50">
      <ToastContainer toasts={toasts} remove={removeToast} />

      <header className="bg-gradient-to-r from-indigo-600 to-purple-700 text-white px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold">🏗️ Configuração da unidade</h1>
            <p className="text-indigo-200 text-xs">{userEmail}</p>
          </div>
          <button onClick={() => router.push('/dashboard')}
            className="text-xs font-medium bg-white/15 hover:bg-white/25 border border-white/25 rounded-lg px-3 py-1.5">
            ← Painel
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-6 space-y-5">

        {/* Seleção / criação de unidade */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <select value={unidadeId} onChange={e => setUnidadeId(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
              {units.length === 0 && <option value="">Nenhuma unidade</option>}
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            {unidadeAtual && (
              <button onClick={() => renomearUnidade(unidadeAtual)}
                className="text-xs font-medium border border-slate-300 text-slate-600 hover:bg-slate-50 rounded-lg px-3 py-2">
                ✏️ Renomear
              </button>
            )}
            <p className="text-xs text-slate-400 ml-auto">
              {alas.filter(a => a.ativa).length} ala(s) ativa(s) · {totalVigentes} leito(s) vigente(s)
            </p>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <input value={novaUnidade} onChange={e => setNovaUnidade(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') criarUnidade() }}
              placeholder="Nome de uma nova unidade (ex.: UTI Cardiológica)"
              className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <button onClick={criarUnidade} disabled={!novaUnidade.trim()}
              className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40
                         text-white rounded-lg px-3 py-2 whitespace-nowrap">
              + Nova unidade
            </button>
          </div>
          <p className="text-[11px] text-slate-400">
            Você entra automaticamente como chefe da unidade que criar. Os pacientes de cada
            unidade são invisíveis para as equipes das outras.
          </p>
        </section>

        {carregando && <p className="text-sm text-slate-400">Carregando...</p>}

        {/* Alas e leitos */}
        {unidadeId && !carregando && (
          <>
            {alas.length === 0 && (
              <p className="text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center">
                Esta unidade ainda não tem alas. Crie a primeira abaixo.
              </p>
            )}

            {alas.map(ala => {
              const meus = leitosDaAla(ala.id)
              const f = faixa[ala.id] ?? { de: '', ate: '' }
              return (
                <section key={ala.id}
                  className={`bg-white border rounded-xl p-4 space-y-3 ${ala.ativa ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="font-semibold text-slate-700">{ala.nome}</h2>
                    <code className="text-[11px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{ala.codigo}</code>
                    {!ala.ativa && <span className="text-[11px] text-amber-600 font-medium">desativada</span>}
                    <span className="text-xs text-slate-400">
                      {meus.filter(vigente).length} leito(s) vigente(s)
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                      <button onClick={() => renomearAla(ala)}
                        className="text-xs text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1">
                        Renomear
                      </button>
                      <button onClick={() => alternarAla(ala)}
                        className="text-xs text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg px-2 py-1">
                        {ala.ativa ? 'Desativar' : 'Reativar'}
                      </button>
                    </div>
                  </div>

                  {meus.length === 0 ? (
                    <p className="text-xs text-slate-400">Nenhum leito cadastrado nesta ala.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {meus.map(l => {
                        const ok = vigente(l)
                        return (
                          <span key={l.id}
                            title={ok
                              ? `Vigente desde ${fmtData(l.ativo_desde)}`
                              : `Desativado em ${fmtData(l.ativo_ate!)}`}
                            className={`inline-flex items-center gap-1 text-xs rounded-lg border px-2 py-1
                              ${ok ? 'border-indigo-200 bg-indigo-50 text-indigo-700'
                                   : 'border-slate-200 bg-slate-50 text-slate-400 line-through'}`}>
                            {String(l.numero).padStart(2, '0')}
                            <button onClick={() => ok ? desativarLeito(l) : reativarLeito(l)}
                              title={ok ? 'Desativar leito' : 'Reativar leito'}
                              className="hover:text-indigo-900">{ok ? '⏸' : '▶'}</button>
                            <button onClick={() => apagarLeito(l)} title="Apagar cadastro errado"
                              className="text-slate-300 hover:text-red-500">✕</button>
                          </span>
                        )
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-2 border-t border-slate-100 flex-wrap">
                    <span className="text-xs text-slate-500">Adicionar leitos do</span>
                    <input type="number" min="1" value={f.de} placeholder="1"
                      onChange={e => setFaixa(s => ({ ...s, [ala.id]: { ...f, de: e.target.value } }))}
                      className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                    <span className="text-xs text-slate-500">ao</span>
                    <input type="number" min="1" value={f.ate} placeholder="9"
                      onChange={e => setFaixa(s => ({ ...s, [ala.id]: { ...f, ate: e.target.value } }))}
                      className="w-20 border border-slate-300 rounded-lg px-2 py-1.5 text-sm" />
                    <button onClick={() => addLeitos(ala)} disabled={!f.de}
                      className="text-xs font-semibold border border-slate-300 text-slate-600 hover:bg-slate-50
                                 disabled:opacity-40 rounded-lg px-3 py-1.5">
                      + Adicionar
                    </button>
                  </div>
                </section>
              )
            })}

            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
              <h2 className="font-semibold text-slate-700 text-sm">Nova ala</h2>
              <div className="flex items-center gap-2 flex-wrap">
                <input value={novaAlaNome} onChange={e => setNovaAlaNome(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') criarAla() }}
                  placeholder="Nome da ala (ex.: UTI 03)"
                  className="flex-1 min-w-[12rem] border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                <button onClick={criarAla} disabled={!novaAlaNome.trim()}
                  className="text-xs font-semibold bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40
                             text-white rounded-lg px-3 py-2">
                  + Criar ala
                </button>
              </div>
              {novaAlaNome.trim() && (
                <p className="text-[11px] text-slate-400">
                  Código: <code className="bg-slate-100 rounded px-1">{normalizarCodigo(novaAlaNome)}</code> —
                  fica gravado no prontuário de quem passar pela ala e não muda depois.
                </p>
              )}
            </section>

            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-1">
              <p className="text-xs font-semibold text-amber-800">Por que leito tem data</p>
              <p className="text-[11px] text-amber-700">
                Leito novo passa a valer <strong>a partir de hoje</strong>, e leito desativado
                continua contando nos meses em que existiu. É isso que impede a taxa de ocupação
                dos meses passados de mudar sozinha quando a UTI cresce ou reduz.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
