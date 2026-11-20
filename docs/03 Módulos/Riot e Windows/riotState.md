---
tipo: módulo
arquivo: src-tauri/src/riot/riot_state.rs
camada: riot
testes: src-tauri/tests/riot/riot_state.rs
tags: [módulo]
---

# riotState

> Diz onde a Riot está (fechada, em jogo, com janela, sem janela ou em segundo plano) e se há conta conectada, com uma regra só para o [[sessionKeeper]], o [[riotWakeup]] e o login.

## Responsabilidade

- Define, num lugar só, o vocabulário do estado da Riot ([[ADR-029 Estado da Riot definido num lugar só]]).
- Responde cada pergunta de uma olhada consultando a Riot no máximo uma vez.
- **Não** decide o que fazer com a resposta: limpar o arquivo, pedir a saída, abrir a janela ou reaproveitar a conta continua nos consumidores.
- **Não** guarda estado entre olhadas nem observa a Riot sozinho.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `RiotProbe` | trait | As três consultas: `running_games`, `authorization` e `session_state`. As duas últimas têm padrão: sem elas, a conta é `Unknown` e os serviços, segundo plano |
| `Look::new(sonda)` | construtor | Uma olhada nova, com as perguntas abaixo |

| Pergunta da olhada | Resposta |
|---|---|
| `processes()` | a lista de `running_games()`, como veio |
| `running()` | algum processo da Riot aberto |
| `in_game()` | `lol` ou `val` |
| `window()` | `Riot Client.exe` ou `RiotClientUx.exe` |
| `account()` | `No` com a Riot fechada, sem consultar a API; senão `Yes`, `No` ou `Unknown` |
| `signed_in()` | `account()` é `Yes` |
| `services()` | `Off` com a Riot fechada; `Ready` se `session_state()` devolve algo; `Background` se não |
| `mode()` | `Closed`, `Game`, `Window`, `Hidden` ou `Background`, nessa ordem de prioridade |

## Dependências

- Usa: só as consultas da `RiotProbe`. O [[riotClient]] a implementa com a lista de processos, a autorização e o estado da sessão reais.
- Usado por: [[riotClient]] (`look()` e o fechamento de tudo), [[sessionKeeper]], [[riotWakeup]] e [[rankWatcher]] (pela olhada do [[riotClient]]) e [[signInFlow]] (no começo do login).

## Invariantes e decisões

- **Em jogo com qualquer um dos cinco (2026-11-19).** `in_game` usa `RunningGames::any_game`, que inclui TFT, 2XKO e Runeterra ([[ADR-038 TFT, 2XKO e Runeterra no Eclipse]]).
- **Uma olhada, uma consulta por pergunta.** As respostas ficam guardadas só dentro da olhada, então duas perguntas sobre a mesma coisa nunca se contradizem. Cada decisão pede uma olhada nova; guardar uma olhada entre decisões daria respostas velhas.
- **Riot fechada não é consultada.** Sem processo da Riot, a conta é `'no'` e os serviços `'off'`, sem chamar a API local. Era a regra do fechamento de tudo e do guardião, e agora vale para todos.
- **Conta em três valores.** Só `'yes'` e `'no'` são respostas firmes. Erro, resposta inesperada ou ausência de `authorization` viram `'unknown'`, que não prova nada ([[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]).
- **Segundo plano pela API.** Com a Riot aberta, sem janela e sem jogo, a API de sessão responder separa `'hidden'` de `'background'`. Em segundo plano a API local só responde `/help` (conferido na Riot v142 em 2026-11-06, [[riotWakeup]]). Uma falha de `session_state` vale como segundo plano.
- **A lista de processos manda.** Um jogo aberto sem processo da Riot conta como Riot fechada para `mode()`, embora `in_game()` diga que há jogo. Falha da lista de processos chega a quem perguntou, como antes: cada consumidor já trata esse erro.
- **Comportamento sem mudança.** Até 2026-11-07 cada consumidor combinava as mesmas consultas do seu jeito; com as consultas reais, as respostas são as mesmas. A diferença fica nos testes, que passam pela regra real em vez de simular cada consulta separada.
- **Uma consulta por olhada.** Um `Look` guarda cada resposta em `OnceCell`, então cada pergunta vai à Riot no máximo uma vez por olhada; uma olhada nova pergunta de novo.

## Testes

`src-tauri/tests/riot/riot_state.rs`, com consultas falsas, cobre: Riot fechada sem consulta à API; cada modo da Riot aberta, com o estado da sessão consultado só sem janela e sem jogo; conta `Yes`, `No` e `Unknown`, com falha virando `Unknown`; cada pergunta feita uma vez por olhada e de novo numa olhada nova; falha dos serviços valendo segundo plano e falha da lista de processos chegando a quem perguntou; lista sem a Riot contando como fechada.

Os testes do [[sessionKeeper]] e do [[riotWakeup]] montam a olhada sobre as consultas falsas deles.

## Pontos de atenção

- Uma Riot nova com outro nome de processo ou outro modo exige mudar só este módulo, mas também conferir as decisões dos consumidores ([[Atualização do Riot Client]]).
- O canal de eventos da API local não foi conferido. Se existir, pode substituir as olhadas periódicas do guardião ([[Backlog]]).
