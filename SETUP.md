# 🏥 Sistema UTI — Guia de Configuração

## O que você precisa (uma vez só)

1. Conta no **GitHub** → github.com
2. Conta no **Supabase** → supabase.com (projeto "Balanços e evoluções" já criado ✅)
3. Conta no **Vercel** → vercel.com (pode entrar com o GitHub)
4. **Google AI Studio API Key** → https://aistudio.google.com/app/apikey (grátis!)

---

## PASSO 1 — Configurar o banco de dados (Supabase)

1. Entre no **supabase.com** → seu projeto
2. No menu lateral esquerdo: **SQL Editor**
3. Clique em **New query**
4. Abra o arquivo `supabase/schema.sql` deste projeto
5. Cole todo o conteúdo no editor
6. Clique em **Run** (botão verde)
7. Deve aparecer "Success" — banco configurado ✅

### Pegar as credenciais:
1. Menu lateral: **Project Settings** → **API**
2. Anote:
   - **Project URL** (algo como `https://abcdef.supabase.co`)
   - **anon public** key (string longa)

---

## PASSO 2 — Criar contas para a equipe médica (Supabase Auth)

Para cada médico que vai usar o sistema:

1. Menu lateral: **Authentication** → **Users**
2. Clique em **Invite user** (ou **Add user** → **Create new user**)
3. Digite o e-mail do médico
4. Configure a senha inicial
5. Repita para cada colega

---

## PASSO 3 — Gerar API Key do Google AI Studio (grátis!)

1. Acesse: **https://aistudio.google.com/app/apikey**
2. Clique em **Create API Key**
3. Selecione um projeto (ou crie um novo)
4. Copie a chave gerada (começa com `AIza...`)
5. **Guarde em local seguro** — você vai usar no Vercel

**Limite grátis:** até 60 requisições/minuto (mais que suficiente para sua UTI)

---

## PASSO 4 — Colocar o código no GitHub

1. Entre no **github.com** → **New repository**
2. Nome: `uti-app` → Private ✅ → Create repository
3. Na tela que aparecer, clique em **uploading an existing file**
4. Faça upload de TODOS os arquivos e pastas deste projeto
5. Clique em **Commit changes**

---

## PASSO 5 — Deploy no Vercel

1. Entre no **vercel.com** → **Add New Project**
2. Clique em **Import** no repositório `uti-app` do GitHub
3. Na seção **Environment Variables**, adicione as 3 variáveis:

```
NEXT_PUBLIC_SUPABASE_URL        = https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY   = sua-anon-key-aqui
GOOGLEAISTUDIO_API_KEY          = AIza... (sua chave do Google)
```

4. Clique em **Deploy**
5. Em ~2 minutos seu app estará em: `https://uti-app-xxxx.vercel.app`

---

## PASSO 6 — Testar

1. Acesse a URL do Vercel
2. Entre com um e-mail/senha cadastrado no Supabase
3. Clique em um leito vazio → cadastre um paciente teste
4. Abra em outro computador com outro login → veja o mesmo paciente ✅
5. Adicione um exame em PDF → deve extrair automaticamente com IA do Google ✅
6. Dê alta → resumo gerado com IA ✅

---

## Uso diário

- **Adicionar paciente:** clique em qualquer leito vazio
- **Ver paciente:** clique no cartão do leito
- **Adicionar exame:** dentro do prontuário → aba Exames → "+ Adicionar Exame"
- **Registrar balanço:** aba "Balanço Hídrico" → "+ Novo Turno"
- **Dar alta:** dentro do prontuário → botão "Alta" (vermelho)

---

## Se algo der errado

- **Tela em branco:** verifique se as variáveis de ambiente estão corretas no Vercel
- **"Erro ao extrair exame":** verifique se a chave do Google está correta (não confunda com ID do projeto)
- **Não salva dados:** verifique se o SQL do schema foi executado com sucesso
- **Login não funciona:** verifique se o usuário foi criado em Supabase → Authentication → Users

---

## Custo

✅ **TOTALMENTE GRÁTIS!**
- Supabase: até 500 MB grátis (mais que suficiente)
- Google AI Studio: até 60 requisições/minuto grátis
- Vercel: até 100 horas/mês grátis

---

## Próximas funcionalidades (futuras sessões)

- [ ] Passômetro
- [ ] Controle de Peso (evolução ponderal)
- [ ] Monitorização de Fisioterapia
- [ ] Histórico de altas arquivadas
- [ ] Busca por paciente

