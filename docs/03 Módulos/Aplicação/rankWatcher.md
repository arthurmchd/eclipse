---
tipo: módulo
arquivo: src-tauri/src/application/rank_watcher.rs
camada: aplicação
testes: src-tauri/tests/application/rank_watcher.rs
tags: [módulo]
---

# rankWatcher

> A cada minuto, com o LoL ou o VALORANT aberto, lê o elo pelo [[gameRanks]] e grava na conta salva com o mesmo Riot ID.

## Responsabilidade

- Decide quando ler: a cada 60 s, só com o jogo aberto e fora de um login.
- Acha a conta salva pelo Riot ID e junta a leitura aos `stats` dela sem perder o que só uma chave dá.
- Grava pelo [[store]] e avisa os [[cards]] pelo gancho de conta atualizada.
- **Não** fala com a Riot direto: pergunta pela trait `RankRiot`, que o [[riotClient]] implementa com uma olhada do [[riotState]] e o [[gameRanks]].
- **Não** usa chaves de API nem servidores.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `RankWatcher::new(riot, store, timers, hooks, poll_ms, resave_ms)` | construtor | `riot` é a trait `RankRiot`; `store` é o `ServiceStore`; `hooks` traz ocupado, log e conta atualizada. `POLL_MS` é 60 s; `RESAVE_MS`, 10 min |
| `start()` | método | Agenda a primeira leitura no [[timers]] e passa a ler a cada `poll_ms` |
| `stop()` | método | Para o ciclo; uma leitura que chega depois não é gravada |
| `check()` | método | Lê agora. Devolve `true` se gravou alguma conta. Parado, devolve `false` |
| `merge_reading(stats, leitura, quando)` | função | Junta uma leitura aos `stats`; pública para os testes |

## Dependências

- Usa: [[riotClient]] pela trait `RankRiot` (processos abertos, elos do LoL e do VALORANT, comparação de Riot ID), [[store]] pelo `ServiceStore` e [[timers]].
- Usado por: [[main]], que o cria depois do [[riotWakeup]], e [[refresher]], que o chama na atualização quando não há chave.

## Invariantes e decisões

- **Conta não salva vira sugestão.** Desde 2026-11-15, quando o jogo aberto está numa conta que não existe no Eclipse (ou existe duas vezes), `on_unsaved` recebe o Riot ID. O [[main]] guarda só o último na memória, sem gravar em disco, e os [[cards]] o oferecem ao adicionar conta.
- **A leitura do jogo apaga a marca do OP.GG.** Desde 2026-11-15 ([[ADR-037 Elo do League pelo OP.GG]]), `merge_reading` remove o `source` do `stats.lol`: o bloco passa a ser do jogo, com a hora da leitura, e um perfil mais antigo do [[opgg]] não o substitui.

- **Criado em 2026-11-08** ([[ADR-031 Elo lido do próprio jogo, sem chave]]).
- **Só com o jogo aberto, nunca no login.** A lista de processos de uma olhada do [[riotState]] diz se o LoL (`lol`) ou o VALORANT (`val`) está aberto; sem ele, nada é pedido. Com um login em curso, nada é lido, para não somar pedidos ao fluxo de login.
- **Conta pelo Riot ID único.** Como no [[sessionKeeper]], a leitura só vale para uma conta salva com o mesmo Riot ID (sem diferenciar maiúsculas). Conta que não está no Eclipse, ou salva duas vezes, não é tocada.
- **O que só a chave dá fica.** Com o mesmo elo de antes, os cortes de Grão-Mestre e Desafiante ficam na fila do LoL, e o RR e a última partida ficam no VALORANT. Pico, temporada passada, região, banner e o que mais houver nos `stats` também ficam. Com elo diferente no VALORANT, o RR e a última partida viram `null` (os [[cards]] mostram o elo sem RR). Nível e ícone ausentes na leitura mantêm os antigos. A sequência de vitórias (`hotStreak`), que o cliente do LoL não manda, fica enquanto as vitórias e derrotas daquela fila forem as mesmas; com uma partida nova, vira `false` até a próxima consulta com chave. Nenhum cartão mostra esse campo, mas assim a leitura não o apaga nem grava o `data.json` à toa.
- **Erros do jogo lido somem.** Os erros "falta chave" daquele jogo e o `all` saem dos `stats.errors` quando a leitura dá certo.
- **Sem gravação à toa.** Com os mesmos dados (fora `updatedAt`), só grava de novo depois de 10 min, para o `updatedAt` não ficar velho sem escrever o `data.json` a cada minuto. Os `stats` não entram no backup ([[store]]).
- **Log só quando muda.** Linhas fixas no `data.log`, sem nome de conta, e só quando o resultado é diferente do anterior: "updated a saved account from the …", "could not read the ranks from the …", "… is signed in to an account that is not saved in Eclipse", "could not check the running games".
- **Uma leitura por vez.** Um `check()` pedido durante outro espera o primeiro e devolve o resultado dele, sem ler o jogo duas vezes.
- **Corrida com a atualização por chave.** Uma atualização por chave que começou antes de uma leitura pode escrever por cima dela; a próxima leitura, 1 min depois, corrige.
- **Comparação e falhas.** A comparação sem `updatedAt` compara os valores JSON, sem depender da ordem das chaves. Uma falha ao gravar a conta vira a linha "could not check the running games" e não avisa os cartões.

## Testes

`src-tauri/tests/application/rank_watcher.rs`, com Riot, store e relógio falsos: o LoL aberto atualizando LoL e TFT da conta certa e avisando os cartões; o ciclo seguindo até parar; a mesma leitura gravada de novo só depois de 10 min e uma mudança na hora; conta ausente ou duplicada sem toque; nada lido sem jogo ou durante login, e leitura falha mantendo o elo; VALORANT só com o VALORANT aberto; parar sem gravar uma leitura atrasada; falha do store registrada sem avisar atualização; o que fica de uma chave com o mesmo elo; e a sequência de vitórias da chave mantida até uma partida nova.

## Pontos de atenção

- Depende do [[gameRanks]]. Com o LoL, conferido em 2026-11-08 no Eclipse em Electron: ele gravou o elo do LoL e do TFT numa conta salva e registrou "updated a saved account from the League client". O VALORANT ainda não foi conferido, e no Tauri nenhum dos dois ([[Backlog]]).
- Conta parada não muda no jogo, mas pode mudar fora dele (inatividade no Diamante ou acima, nova temporada). Sem chave, o cartão só corrige quando a conta joga de novo.
