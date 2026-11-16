---
tipo: decisão
status: aceita
data: 2026-11-07
tags: [adr, riot, arquitetura]
---

# ADR-029 Estado da Riot definido num lugar só

É o item 4 da análise de remendos de 2026-11-06 ([[Backlog]], "Serviço único de estado da Riot"). Pedido do usuário em 2026-11-07.

## Contexto

Três partes do app perguntam onde a Riot está: o [[sessionKeeper]] (guardião das sessões), o [[riotWakeup]] (abre a janela quando a Riot sai do segundo plano sem uma) e o login ([[signInFlow]] e o `closeEverything` do [[riotClient]]). Todas usam as mesmas três consultas: a lista de processos (`runningGames`), o estado da conta na API local (`authorization`) e se a API de sessão responde (`sessionState`). Mas cada uma as combinava do seu jeito:

- o guardião perguntava "a Riot roda?" por `clientRunning` e, na olhada a cada 4 s, por `runningGames().client`, e "está conectada?" por `isAuthorized`, que esconde o `'unknown'`;
- o wakeup tinha os modos próprios `closed`, `shown`, `hidden` e `background`;
- o `closeEverything` repetia "fechada vale como sem conta, sem consultar a API";
- o login perguntava `sessionState() && isAuthorized()` para reaproveitar a conta atual.

Uma regra nova, por exemplo para um modo novo da Riot, precisaria ser repetida em quatro lugares. E os testes do guardião simulavam `clientRunning` e `runningGames` separados, o que permitia cenários impossíveis na Riot real, como "não roda" para uma pergunta e "roda" para a outra na mesma conferência.

## Decisão

O [[riotState]] define o vocabulário uma vez. Cada decisão faz uma olhada (`look()`), e cada pergunta da olhada consulta a Riot no máximo uma vez. Os consumidores perguntam à olhada; o que fazer com a resposta continua em cada módulo.

| Pergunta | Resposta |
|---|---|
| `running()` | algum processo da Riot aberto (`RiotClientServices`, `Riot Client` ou `RiotClientUx`) |
| `inGame()` | League/TFT ou VALORANT aberto |
| `window()` | `Riot Client.exe` ou `RiotClientUx.exe` aberto |
| `account()` | `'no'` com a Riot fechada, sem consultar a API; senão `'yes'`, `'no'` ou `'unknown'` (erro ou resposta inesperada) |
| `signedIn()` | `account()` é `'yes'` |
| `services()` | `'off'` com a Riot fechada; `'ready'` se a API de sessão responde; `'background'` se não |
| `mode()` | `closed`, `game`, `window`, `hidden` (aberta sem janela, API respondendo) ou `background` (aberta sem janela, API só em `/help`) |

O [[riotClient]] cria a instância com as consultas reais e expõe `look()`. O guardião e o wakeup usam `riot.look()`. O `closeEverything` e o começo do [[signInFlow]] criam a sua a partir das mesmas consultas que recebem.

O comportamento em produção não muda: as regras antigas davam as mesmas respostas com as consultas reais. A única diferença está numa falha de `authorization` dentro do guardião, que agora vira `'unknown'` em vez de derrubar a olhada; com a consulta real isso não acontece, porque ela já devolve `'unknown'` em vez de lançar.

## Fora desta decisão

- **Esperas do login.** Depois do começo, o [[signInFlow]] espera os passos que ele mesmo provoca: a API subir, a conta entrar depois da digitação, a janela do jogo. Isso é o progresso do fluxo, não a pergunta "onde a Riot está". Continua nas consultas diretas, que são as mesmas usadas pela regra.
- **Canal de eventos da API local.** O [[Backlog]] pedia para conferir na Riot real, só lendo e com autorização, se a API local tem eventos (`/help`). Não foi conferido. O guardião continua olhando os processos a cada 4 s, e o wakeup continua seguindo o `lockfile`.

## Alternativas consideradas

- **Um observador único que publica o estado.** Uma olhada só a cada tantos segundos, compartilhada pelos três. Economizaria consultas, mas mudaria o ritmo de cada um (o guardião a cada 4 s, o wakeup pelo `lockfile`, o login na hora do clique) sem teste na Riot real, e um estado guardado pode estar velho na hora de decidir. Fica para depois do canal de eventos.
- **Converter também as esperas do login.** Mais risco no fluxo mais delicado, sem regra nova a juntar.
- **Só documentar as regras.** Não impede que elas se separem de novo.

## Consequências

- Uma regra nova sobre a Riot muda num arquivo só, com teste próprio (`test/riot/riotState.test.js`).
- Os testes do guardião e do wakeup passam pela regra real, com consultas falsas. Cenários impossíveis, como "roda" e "não roda" na mesma conferência, deixam de existir.
- Saem do [[riotClient]] as saídas `clientRunning`, `isAuthorized`, `authorization` e `sessionState`, que só o guardião e o wakeup usavam. `runningGames` continua, porque os [[cards]] perguntam pelos jogos abertos via [[managerService]].
- Um consumidor novo precisa pedir uma olhada nova a cada decisão. Guardar uma olhada entre decisões daria respostas velhas.

## Relacionado

- [[Arquitetura]]
- [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]
- [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]
- [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]
