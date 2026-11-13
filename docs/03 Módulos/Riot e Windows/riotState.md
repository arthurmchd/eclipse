---
tipo: módulo
arquivo: src/riot/riotState.js
camada: riot
testes: test/riot/riotState.test.js
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

| Export | Tipo | Descrição |
|---|---|---|
| `createRiotState({ runningGames, authorization, sessionState })` | fábrica | Devolve `{ look }`. `authorization` e `sessionState` são opcionais: sem eles, a conta é `'unknown'` e os serviços, `'background'`. |
| `look()` | método | Uma olhada nova, com as perguntas abaixo. |

| Pergunta da olhada | Resposta |
|---|---|
| `processes()` | a lista de `runningGames()`, como veio |
| `running()` | `client`: algum processo da Riot aberto |
| `inGame()` | `lol` ou `val` |
| `window()` | `clientWindow`: `Riot Client.exe` ou `RiotClientUx.exe` |
| `account()` | `'no'` com a Riot fechada, sem consultar a API; senão `'yes'`, `'no'` ou `'unknown'` |
| `signedIn()` | `account()` é `'yes'` |
| `services()` | `'off'` com a Riot fechada; `'ready'` se `sessionState()` devolve algo; `'background'` se não |
| `mode()` | `'closed'`, `'game'`, `'window'`, `'hidden'` ou `'background'`, nessa ordem de prioridade |

## Dependências

- Usa: nada além das consultas recebidas. O [[riotClient]] entrega `runningGames`, `authorization` e `sessionState` reais.
- Usado por: [[riotClient]] (`look()` exportado e o `closeEverything`), [[sessionKeeper]] e [[riotWakeup]] (por `riot.look()`), [[signInFlow]] (no começo do login).

## Invariantes e decisões

- **Uma olhada, uma consulta por pergunta.** As respostas ficam guardadas só dentro da olhada, então duas perguntas sobre a mesma coisa nunca se contradizem. Cada decisão pede uma olhada nova; guardar uma olhada entre decisões daria respostas velhas.
- **Riot fechada não é consultada.** Sem processo da Riot, a conta é `'no'` e os serviços `'off'`, sem chamar a API local. Era a regra do `closeEverything` e do guardião, e agora vale para todos.
- **Conta em três valores.** Só `'yes'` e `'no'` são respostas firmes. Erro, resposta inesperada ou ausência de `authorization` viram `'unknown'`, que não prova nada ([[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]).
- **Segundo plano pela API.** Com a Riot aberta, sem janela e sem jogo, a API de sessão responder separa `'hidden'` de `'background'`. Em segundo plano a API local só responde `/help` (conferido na Riot v142 em 2026-11-06, [[riotWakeup]]). Uma falha de `sessionState` vale como segundo plano.
- **A lista de processos manda.** Um jogo aberto sem processo da Riot conta como Riot fechada para `mode()`, embora `inGame()` diga que há jogo. Falha da lista de processos chega a quem perguntou, como antes: cada consumidor já trata esse erro.
- **Comportamento sem mudança.** Até 2026-11-07 cada consumidor combinava as mesmas consultas do seu jeito; com as consultas reais, as respostas são as mesmas. A diferença fica nos testes, que agora passam pela regra real em vez de simular `clientRunning` e `runningGames` separados.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/riot/riot_state.rs`, testes em `src-tauri/tests/riot/riot_state.rs`. As três consultas vêm da trait `RiotProbe`; um `Look` guarda cada resposta em `OnceCell`, então cada pergunta é feita uma vez por olhada, como no JS.

## Testes

`test/riot/riotState.test.js`, com consultas falsas, cobre: Riot fechada sem consulta à API; cada modo da Riot aberta, com `sessionState` consultado só sem janela e sem jogo; conta `'yes'`, `'no'` e `'unknown'`, com resposta estranha e erro virando `'unknown'`; cada pergunta feita uma vez por olhada e de novo numa olhada nova; falha dos serviços valendo segundo plano e falha da lista de processos chegando a quem perguntou; jogo sem processo da Riot contando como fechada.

Os testes do [[sessionKeeper]] e do [[riotWakeup]] montam `riot.look()` com esta fábrica sobre as consultas falsas deles.

## Pontos de atenção

- Uma Riot nova com outro nome de processo ou outro modo exige mudar só este módulo, mas também conferir as decisões dos consumidores ([[Atualização do Riot Client]]).
- O canal de eventos da API local não foi conferido. Se existir, pode substituir as olhadas periódicas do guardião ([[Backlog]]).
