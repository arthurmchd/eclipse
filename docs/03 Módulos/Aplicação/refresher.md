---
tipo: módulo
arquivo: src-tauri/src/application/refresher.rs
camada: aplicação
testes: src-tauri/tests/application/refresher.rs
tags: [módulo, tauri]
---

# refresher

> A fila de atualização de elos do Eclipse em Rust: o `refreshAll`, o `runRefresh`, o `scheduleRefresh` e o `nextRefreshAt` que no Electron moram no [[main]].

## Responsabilidade

- Atualizar os elos das contas pedidas (ou de todas), uma passada por vez, e agendar a próxima atualização pelo intervalo das configurações.
- **Não** fala com a Riot nem com as APIs: recebe o `refresh_account` do [[rankApi]] e o `check` do [[rankWatcher]] por ganchos.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `Refresher` | struct | `request(ids)`, `schedule()`, `start()`, `stop()`, `next_refresh()`, `last_refresh()` |
| `RefreshStore` | trait | O que a fila precisa do [[store]]; implementada por `Mutex<Store>` |
| `RefreshHooks` | struct | `refresh_account`, `check_game`, `publish` e `now` |
| `iso(ms)` | função | Data no formato do `toISOString` |
| `FAILED` | constante | A linha fixa do `data.log` quando a passada não termina |

## Dependências

- Usa: [[store]], [[timers]].
- Usado por: [[main]] e o `AppPorts` ([[appPorts]]).

## Invariantes e decisões

- **`request` volta na hora.** A passada roda numa tarefa do [[timers]]; o [[managerService]] responde aos cartões sem esperar as APIs.
- **Uma passada por vez, e no máximo uma na fila.** Contas pedidas durante uma passada entram numa fila única, sem repetir; um pedido de todas transforma a fila em "todas"; um pedido de todas durante uma passada de todas é ignorado. Igual ao JS, conferido pelo mesmo cenário do `mainStartup.test.js`.
- **Sem chave de API, o jogo aberto primeiro e depois todas as contas.** Sem chave da Riot, TFT ou HenrikDev, a passada chama o `check` do [[rankWatcher]] e, desde 2026-11-15, também o `refresh_account` de cada conta, que busca o League no OP.GG ([[ADR-037 Elo do League pelo OP.GG]], [[opgg]]). Até lá, ela só lia o jogo aberto.
- **Só a passada de todas marca `lastRefresh`.** Uma passada parcial, uma interrompida pela saída do app e uma que falhou ao gravar não mexem nele. A falha vai ao `data.log` com o texto fixo `FAILED`.
- **A próxima atualização nunca vem antes de 5 segundos** e é `max(agora, última + intervalo)`. Intervalo 0 desliga o agendamento e publica `next-refresh` vazio. Ao iniciar, se a próxima já venceu (com 1 segundo de folga) e há contas, a passada começa na hora.
- **Parar é definitivo.** `stop` cancela o agendamento, corta a passada antes da próxima conta e faz pedidos novos serem ignorados.

## Testes

`src-tauri/tests/application/refresher.rs` cobre a fila (o cenário do JS, inclusive a conta que falha), o progresso e os eventos, a passada sem chave lendo o jogo e atualizando todas as contas, o agendamento a partir da última atualização, o início com atualização vencida e a parada no meio.

## Pontos de atenção

- No Electron, `refreshAll` devolve uma promessa que os cartões não usam. Em Rust não há o que esperar; o progresso chega pelos eventos `refresh-progress`.
