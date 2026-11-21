---
tipo: módulo
arquivo: src-tauri/src/application/updates.rs
camada: aplicação
testes: src-tauri/tests/application/updates.rs
tags: [módulo]
---

# updates

> Decide quando perguntar ao GitHub por uma versão nova do Eclipse, avisa uma vez por versão e só instala quando o usuário pede, sem login em andamento.

## Responsabilidade

- Agenda a primeira pergunta 1 minuto depois de abrir e as seguintes a cada 12 horas.
- Guarda a versão nova encontrada e avisa uma vez por versão.
- Instala só a pedido, recusando com um login em andamento.
- Não fala com a rede: isso é do `UpdateSource` (o real é o [[appUpdater]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `Updates::new(fonte, timers, hooks)` | construtor | `fonte` é a trait `UpdateSource` (`check`, `install`); `hooks` (`UpdateHooks`) traz `enabled`, `busy`, `on_available`, `log` e `spawn` |
| `start()`, `stop()` | métodos | Agendam e cancelam as perguntas; depois do `stop`, nada mais roda |
| `check_now()` | método | Pergunta já, se a opção estiver ligada e não houver outra pergunta em curso |
| `available()` | método | A versão nova encontrada, ou `None` |
| `install()` | método | `Started`, `Busy` (login em andamento ou outra instalação), `NoUpdate` ou `Failed` |
| `valid_version(texto)` | função | Só `número.número.número`, até 4 dígitos cada |
| `checks_enabled(configurações)` | função | Ligado, a não ser que `updateChecks` seja exatamente `false` |
| `FIRST_CHECK_MS`, `CHECK_EVERY_MS`, `UPDATE_CHECKS`, `CHECK_FAILED`, `INSTALL_FAILED` | constantes | 60 s, 12 h, o nome da configuração e as linhas fixas do `data.log` |

## Dependências

- Usa: [[timers]].
- Usado por: [[main]], que liga a fonte real ([[appUpdater]]), o balão ([[toasts]]), o item da bandeja e a configuração do [[store]].

## Invariantes e decisões

- **Nunca instala sozinho (2026-11-21, [[ADR-045 Atualização pelo GitHub]]).** A versão encontrada só vira um aviso e um item na bandeja. `install` só roda pelo clique do usuário.
- **Login primeiro.** Com um login em andamento (`busy`), `install` devolve `Busy` sem chamar a fonte: o Setup fecharia o Eclipse no meio do login.
- **Resposta não confiável.** Uma versão fora do formato `número.número.número` é tratada como "sem atualização": não aparece no aviso nem na bandeja. A assinatura do Setup é conferida pelo plugin no [[appUpdater]].
- **Um aviso por versão.** A mesma versão encontrada de novo a cada 12 horas não repete o balão. Uma versão ainda mais nova avisa de novo.
- **Pergunta fora da fila dos timers.** A pergunta pode levar até 30 s; ela roda numa thread própria (`spawn`), para não atrasar os outros timers do Eclipse. Nos testes, `spawn` roda na hora.
- **Desligado, não pergunta.** Com "Procurar atualizações" desmarcado, nenhuma pergunta sai, nem pelo agendamento. Religar pergunta na hora.
- **Log só com valores fixos.** `update available: <versão>` (já validada), `update check failed` e `update install failed`, sem o texto do erro.

## Testes

`src-tauri/tests/application/updates.rs`, com uma fonte falsa e timers manuais: a primeira pergunta em 1 minuto e as seguintes a cada 12 horas; uma versão avisada uma vez e uma mais nova avisada de novo; desligado não pergunta; falha registrada com a linha fixa e a pergunta seguinte agendada; versões fora do formato ignoradas; instalação só com versão encontrada e sem login em andamento; `stop` cancela e recusa instalar; a configuração ligada por padrão.

## Pontos de atenção

- O aviso aparece só quando há um release publicado com o `latest.json` ([[Publicar no GitHub]]).
