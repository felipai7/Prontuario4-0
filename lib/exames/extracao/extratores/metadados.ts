// ══════════════════════════════════════════════════════════════════════════
// Rótulos de metadado do laudo — o que TEM forma de resultado e não é.
//
// "Convênio : CRE - HOC" e "Tel: 3245-0000" são indistinguíveis de
// "Creatinina: 1,42" para qualquer matcher que olhe só a forma. Sem esta
// guarda, os três matchers reivindicam cabeçalho e rodapé e despejam mil
// entradas inúteis no canal de descarte.
//
// Isso importa mais do que parece: 7.B-4 é justamente sobre o canal de
// descarte precisar ser LEGÍVEL. Um canal com 1.201 entradas de "Data Nasc" e
// "Cep" é tão inútil quanto um canal vazio — o antibiograma que o usuário
// precisava ver fica soterrado.
// ══════════════════════════════════════════════════════════════════════════

/** Identificação do paciente, do pedido e do laboratório. */
const IDENTIFICACAO =
  /^(?:paciente|nome|paci|paci\.|dt\.?\s*nasc|data\s*nasc|nascimento|idade|sexo|cpf|rg|cns|cart[ãa]o|conv[êe]nio|plano|leito|quarto|setor|unidade|ala|pedido|requisi|protocolo|amostra|cadastro|registro|prontu[áa]rio|pront|id\s*exame|matr[íi]cula|solicitante|m[ée]dic|dr\(?a\)?|crm|crbm|crf|cro|respons[áa]vel|assinad|documento|cnes|cnpj|cep|tel|telefone|fax|email|e-mail|endere|rua|av\.|bairro|cidade|estado)/i

/** Datas e horários que não são o resultado em si. */
const TEMPORAL =
  /^(?:data|dt\.?|hora|hor[áa]rio|coleta|coletado|liberado|libera[çc][ãa]o|entrada|sa[íi]da|emiss[ãa]o|impress|cadastrado|recebid)/i

/** Metadado analítico e notas em prosa. */
const ANALITICO =
  /^(?:m[ée]todo|metodologia|material|equipamento|aparelho|t[ée]cnica|obs\b|observa|nota|coment|interpreta|refer[êe]ncia|valor(?:es)?\s+de\s+refer|valor\s+cr[íi]tico|anterior|resultado\s+anterior|legenda|rodap)/i

/** Linhas de tabela de referência por faixa etária ou sexo. */
const FAIXA_TABELADA =
  /^(?:adultos?|crian[çc]as?|rec[ée]m|neonat|lactent|idosos?|homens?|mulheres?|masculino|feminino|gestante|de\b|at[ée]\b|menos\s+de|mais\s+de|maiores?\s+de|menores?\s+de|\d)/i

/** Acima disto não é nome de exame: é prosa que a quebra de linha partiu. */
const COMPRIMENTO_MAXIMO = 42

/**
 * Verdadeiro quando o "nome" é rótulo de metadado, e não de exame.
 *
 * Devolver isto faz o matcher responder `noMatch` — a linha não é dele, e não
 * é descarte. Descarte é para o que PARECIA resultado e foi rejeitado; rodapé
 * nunca foi candidato.
 */
export function ehRotuloDeMetadado(nome: string): boolean {
  const t = nome.trim()
  if (t.length === 0 || t.length > COMPRIMENTO_MAXIMO) return true
  return (
    IDENTIFICACAO.test(t) || TEMPORAL.test(t) || ANALITICO.test(t) || FAIXA_TABELADA.test(t)
  )
}
