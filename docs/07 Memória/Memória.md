---
tipo: índice
tags: [moc, memória]
---

# Memória

A memória do Claude Code neste projeto. O resto do vault guarda o porquê do código; esta pasta guarda o que o agente precisa lembrar entre conversas e que não cabe numa nota de módulo: preferências do usuário, combinados de trabalho e o estado de tarefas em andamento.

## Regras

- O agente lê este índice no começo de toda tarefa e abre as notas que tocam o assunto.
- Uma nota por fato, a partir do template [[Nota de memória]]. Categoria `preferência` (como o usuário quer que o agente trabalhe), `perfil` (quem é o usuário), `projeto` (trabalho em andamento, com datas absolutas) ou `referência` (onde achar algo fora do repositório).
- Antes de criar, procure uma nota que já cubra o fato e atualize-a. Nota que ficou errada é apagada, junto com a linha abaixo.
- O que o código, o git ou outra nota do vault já registram não vira memória: atualize a nota certa.
- O vault vai para o GitHub. Nada de senhas, tokens, nomes de contas Riot, e-mail ou outros dados pessoais.
- Toda nota nova ganha uma linha na lista abaixo.

## Notas

- [[Testes sem o usuário]]: só capturas das janelas do próprio Eclipse; nada de controlar a tela ou de Riot falsa
- [[Setup novo a cada mudança]]: subir a versão, gerar o Setup e instalar, sem perguntar
- [[Escolhas técnicas pelo agente]]: o usuário conta com a recomendação do agente em escolhas de tecnologia
