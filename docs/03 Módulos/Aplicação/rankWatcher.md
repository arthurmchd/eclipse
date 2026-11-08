---
tipo: módulo
arquivo: src/core/rankWatcher.js
camada: aplicação
testes: test/core/rankWatcher.test.js
tags: [módulo]
---

# rankWatcher

> A cada minuto, com o LoL ou o VALORANT aberto, lê o elo pelo [[gameRanks]] e grava na conta salva com o mesmo Riot ID.

## Responsabilidade

- Decide quando ler: a cada 60 s, só com o jogo aberto e fora de um login.
- Acha a conta salva pelo Riot ID e junta a leitura aos `stats` dela sem perder o que só uma chave dá.
- Grava pelo [[store]] e avisa os [[cards]] pelo `onUpdated`.
- **Não** fala com a Riot direto: pergunta ao [[riotClient]] (`look()` e `gameRanks`).
- **Não** usa chaves de API nem servidores.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createRankWatcher({ riot, store, busy, log, onUpdated, setTimeout, clearTimeout, pollMs, resaveMs, now })` | fábrica | `riot` precisa de `look`, `gameRanks` e `sameRiotId`. `pollMs` é 60 s; `resaveMs`, 10 min. Devolve `{ start, stop, check }`. |
| `start()` | método | Lê uma vez e passa a ler a cada `pollMs`. |
| `stop()` | método | Para o ciclo; uma leitura que chega depois não é gravada. |
| `check()` | método async | Lê agora. Devolve `true` se gravou alguma conta. Parado, devolve `false`. |
| `mergeReading(stats, reading, at)` | função | Junta uma leitura aos `stats`. Exportada para os testes. |

## Dependências

- Usa: [[riotClient]] (`look().processes()`, `gameRanks.league()`, `gameRanks.valorant()`, `sameRiotId`), [[store]] (`data.accounts`, `updateAccountFields`).
- Usado por: [[main]], que o cria depois do [[riotWakeup]] e o chama no `refreshAll` quando não há chave.

## Invariantes e decisões

- **Criado em 2026-11-08** ([[ADR-031 Elo lido do próprio jogo, sem chave]]).
- **Só com o jogo aberto, nunca no login.** A lista de processos de uma olhada do [[riotState]] diz se o LoL (`lol`) ou o VALORANT (`val`) está aberto; sem ele, nada é pedido. Com `busy()`, nada é lido, para não somar pedidos ao fluxo de login.
- **Conta pelo Riot ID único.** Como no [[sessionKeeper]], a leitura só vale para uma conta salva com o mesmo Riot ID (sem diferenciar maiúsculas). Conta que não está no Eclipse, ou salva duas vezes, não é tocada.
- **O que só a chave dá fica.** Com o mesmo elo de antes, os cortes de Grão-Mestre e Desafiante ficam na fila do LoL, e o RR e a última partida ficam no VALORANT. Pico, temporada passada, região, banner e o que mais houver nos `stats` também ficam. Com elo diferente no VALORANT, o RR e a última partida viram `null` (os [[cards]] mostram o elo sem RR). Nível e ícone ausentes na leitura mantêm os antigos.
- **Erros do jogo lido somem.** Os erros "falta chave" daquele jogo e o `all` saem dos `stats.errors` quando a leitura dá certo.
- **Sem gravação à toa.** Com os mesmos dados (fora `updatedAt`), só grava de novo depois de 10 min, para o `updatedAt` não ficar velho sem escrever o `data.json` a cada minuto. Os `stats` não entram no backup ([[store]]).
- **Log só quando muda.** Linhas fixas no `data.log`, sem nome de conta, e só quando o resultado é diferente do anterior: "updated a saved account from the …", "could not read the ranks from the …", "… is signed in to an account that is not saved in Eclipse", "could not check the running games".
- **Uma leitura por vez.** Um `check()` pedido durante outro devolve o mesmo.
- **Corrida com a atualização por chave.** Uma atualização por chave que começou antes de uma leitura pode escrever por cima dela; a próxima leitura, 1 min depois, corrige.

## Testes

`test/core/rankWatcher.test.js`, com Riot e store falsos: o LoL aberto atualizando LoL e TFT da conta certa e avisando os cartões; a mesma leitura gravada de novo só depois de 10 min e uma mudança na hora; conta ausente ou duplicada sem toque; nada lido sem jogo ou durante login, leitura falha mantendo o elo e log sem repetir; VALORANT só com o VALORANT aberto; parar sem gravar uma leitura atrasada; e o que fica de uma chave (cortes, RR, pico, temporada passada) com o mesmo elo.

## Pontos de atenção

- Depende do [[gameRanks]], que ainda não foi conferido na Riot real ([[Backlog]]).
- Conta parada não muda no jogo, mas pode mudar fora dele (inatividade no Diamante ou acima, nova temporada). Sem chave, o cartão só corrige quando a conta joga de novo.
