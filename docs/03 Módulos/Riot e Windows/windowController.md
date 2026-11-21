---
tipo: módulo
arquivo: src-tauri/src/platform/windows/window_controller.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/window_controller.rs
tags: [módulo]
---

# windowController

> Porta para o [[windowGuard]]: um pedido de janela por vez, com nome de jogo validado e erro em vocabulário fechado.

## Responsabilidade

- Traz a janela do Riot Client à frente, fecha a janela dele e pergunta se a janela do jogo já está pronta.
- Serializa os pedidos e recusa novos depois do `stop`.
- Não esconde a Riot e não mantém nada vivo entre pedidos.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `WindowController::new(janelas)` | construtor | `janelas` é a trait `WindowOps` do [[windowGuard]] (o real é o `NativeWindows`) |
| `reveal()` | método | Traz a janela principal do Riot Client à frente |
| `close_client()` | método | Fecha as janelas da interface. Não encerra os serviços nem os jogos |
| `game_window(jogo)` | método | Valida o jogo contra `GAMES` e pergunta se a janela dele está pronta |
| `stop()` | método | Espera o pedido em andamento e recusa novos |
| `safe_reason(texto)` | função | O motivo de erro só do vocabulário conhecido |
| `CREATE_NO_WINDOW` | constante | Flag que o [[riotClient]] usa ao abrir o `taskkill` e o Riot Client sem janela de console |

## Dependências

- Usa: [[windowGuard]].
- Usado por: [[riotClient]] (uma instância, com `reveal` ao abrir e iniciar o cliente e `stop` ao sair), que o entrega ao [[signInFlow]].

## Funcionamento

- **Falhas:** um erro do [[windowGuard]] vira "Background window guard: <motivo>", com o motivo passado por `safe_reason`. Um jogo fora da lista vira "Invalid game" sem chamar o [[windowGuard]].
- **Fila:** um `Mutex` por pedido. Uma falha não trava os seguintes.

## Invariantes e decisões

- **Sem processo externo (2026-11-21, [[ADR-044 Helpers do Windows em Rust]]).** Até a 2.18.1, cada pedido abria um `powershell.exe -ExecutionPolicy Bypass` escondido com o `windowGuard.ps1`, com prazo de 15 s e `taskkill /T` no estouro. Saíram o `HelperRunner`, o `PowerShell`, os argumentos, a leitura de stdout e stderr, o prazo e os erros "stopped (código)" e "timed out", que só existiam por causa do processo. Os pedidos agora levam milissegundos.
- **Sem ocultação e sem monitor persistente.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]). A [[ADR-004 Monitor persistente de janelas]] e a [[ADR-008 Recuperação visual sem reexibir o Riot]] ficam como histórico.
- **Um pedido de cada vez.** Dois pedidos do Eclipse nunca mexem nas janelas ao mesmo tempo.
- **Nome do jogo validado antes.** Impede um nome com quebra de linha ou fora da lista.
- **Motivo de erro com vocabulário fechado.** `safe_reason` aceita só `^[a-z0-9-]{1,64}$`; o resto vira `unknown` e nunca chega à mensagem nem ao log.
- **`stop()` é definitivo.** Depois dele, todo método falha com "The background window guard is shutting down". Chamadas repetidas só esperam a fila.
- **Mensagens antigas mantidas.** Os textos de erro continuam com "guard", para o `sign-in.log` e o [[language]] não mudarem.

## Testes

`src-tauri/tests/platform/windows/window_controller.rs`, com um `WindowOps` falso:
- `reveal`, `close_client` e `game_window` chegam ao [[windowGuard]] na ordem e com o jogo pedido.
- Nomes de jogo fora da lista são recusados sem chamar nada.
- Pedidos rodam um por vez.
- Erro só com o vocabulário fixo.
- `stop` espera o pedido em andamento e depois recusa pedidos.

As chamadas reais ao Windows ficam no [[windowGuard]].

## Pontos de atenção

- Decisão de arquitetura: [[Arquitetura]].
