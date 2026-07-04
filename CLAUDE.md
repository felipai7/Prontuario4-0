# Instruções do projeto

## Repositório compartilhado — sincronizar antes de editar

Este repositório é editado por mais de uma pessoa (cada uma com sua própria sessão de Claude Code), todas commitando/dando push diretamente na branch `main`.

**Regra obrigatória: no início de toda sessão de trabalho, antes de ler ou editar qualquer arquivo do projeto, rode:**

```
git pull origin main
```

Se o pull trouxer commits novos:
1. Rode `git log --oneline -10` para ver o que mudou e quem fez.
2. Se o autor não for a pessoa que está pedindo a mudança nesta sessão, resuma brevemente o que o outro colaborador alterou antes de prosseguir.
3. Só então continue com a tarefa pedida.

## Sincronizar depois de editar

**Regra obrigatória: ao final de toda sessão de trabalho em que arquivos do projeto foram alterados, faça commit e rode:**

```
git push origin main
```

Não deixe mudanças commitadas apenas localmente — se o push não acontecer, a outra pessoa vai puxar uma versão desatualizada do repositório mesmo seguindo a regra de pull corretamente.

Isso evita sobrescrever trabalho em andamento do outro colaborador e reduz conflitos de merge.
