// Listas de referência do app.
//
// A PLANTA DA UNIDADE NÃO MORA MAIS AQUI. As alas e os leitos saíram deste
// arquivo e foram para as tabelas `alas` e `leitos` do banco — veja
// lib/unidade.ts e supabase/multiunidade_1_estrutura.sql. Enquanto estavam aqui
// (junto de uma check constraint em pacientes.ala_id), atender uma segunda UTI
// exigia editar código e publicar; e duas unidades jamais poderiam coexistir na
// mesma instalação.

export const PLANOS = ['IPASGO', 'Unimed', 'Particular', 'Bradesco', 'Outros']

// Listas de sugestão para os campos de droga/foco de ATB (Combobox) — o
// campo aceita digitação livre, então estas listas são só atalhos, não um enum.
export const ATBS_SUGERIDOS = [
  'Amicacina', 'Amoxicilina + Clavulanato', 'Ampicilina', 'Ampicilina + Sulbactam',
  'Anfotericina B', 'Azitromicina', 'Aztreonam', 'Caspofungina', 'Cefalexina',
  'Cefazolina', 'Cefepime', 'Ceftazidima', 'Ceftazidima + Avibactam', 'Ceftriaxona',
  'Ceftolozano + Tazobactam', 'Ciprofloxacino', 'Claritromicina', 'Clindamicina',
  'Colistina', 'Daptomicina', 'Doxiciclina', 'Ertapenem', 'Fluconazol',
  'Gentamicina', 'Levofloxacino', 'Linezolida', 'Meropenem', 'Meropenem + Vaborbactam',
  'Metronidazol', 'Micafungina', 'Oxacilina', 'Piperacilina + Tazobactam',
  'Polimixina B', 'Sulfametoxazol + Trimetoprima', 'Teicoplanina', 'Tigeciclina',
  'Vancomicina', 'Voriconazol',
]

export const FOCOS_INFECCIOSOS = [
  'Urinário', 'Pulmonar', 'Abdominal', 'Cutâneo', 'Pele e Partes Moles',
  'Sistema Nervoso Central', 'Otológico', 'Seios da Face', 'Ósseo', 'Articular',
  'Cirúrgico', 'Corrente Sanguínea / Cateter', 'Endocárdico', 'Ginecológico/Pélvico',
]
