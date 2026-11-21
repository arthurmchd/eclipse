---
tipo: módulo
arquivo: src-tauri/src/platform/windows/window_guard.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/window_guard.rs
tags: [módulo]
---

# windowGuard

> Traz a janela do Riot Client à frente, fecha a janela dele e diz se a janela do jogo já apareceu, chamando o Windows direto de dentro do Eclipse.

## Responsabilidade

- Ativa a janela principal da interface do Riot Client (`Riot Client` ou `RiotClientUx`).
- Pede o fechamento das janelas da interface, sem encerrar serviços nem jogos.
- Diz se a janela real do jogo já está visível.
- Não esconde janelas, não muda estilos, não toca em processos de jogo, não injeta código e não usa teclado global. Credenciais nunca passam por aqui.

Até a 2.18.1 isso era o `windowGuard.ps1`, um PowerShell com C# embutido aberto a cada pedido, inclusive a cada 500 ms enquanto o Eclipse esperava o jogo abrir ([[ADR-044 Helpers do Windows em Rust]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `WindowOps` | trait | `reveal()`, `close_client()`, `game_window(jogo) -> Result<bool, &str>`. Trocável nos testes do [[windowController]] |
| `NativeWindows` | struct | O real, com `windows-sys` |
| `GAMES` | constante | `lol`, `tft`, `val`, `2xko`, `lor` |
| `client_interface`, `activation_candidate`, `activation_score`, `game_processes`, `game_process` | funções puras | Os filtros, testados sem janela |

Erros são códigos curtos (`invalid-game`); o [[windowController]] os passa por `safe_reason`.

## Dependências

- Usa: [[win32]] (janelas, processo de cada janela, `cloaked`).
- Usado por: [[windowController]], que serializa os pedidos.

## Funcionamento

- **Janela principal em `reveal`:** entre as candidatas, a de maior área; título "Riot Client" ganha bônus de 100 000 000. `ShowWindowAsync` com `SW_RESTORE` se minimizada, senão `SW_SHOW`, e `SetForegroundWindow`.
- **Candidata a ativar:** janela raiz, classe diferente de `TrayIconClass`, ao menos 320×240, processo `Riot Client` ou `RiotClientUx`.
- **`close_client`:** `WM_CLOSE` só às janelas raiz desses dois processos.
- **`game_window`:** janela raiz visível, não minimizada, ao menos 160×120, sem `WS_EX_TOOLWINDOW`, não "cloaked" no DWM, de um processo do jogo pedido.
- **Processos por jogo:** `lol` → `LeagueClientUx`, `League of Legends`; `tft` → `TFTClient-Win64-Shipping`, `TFTClient`; `val` → `VALORANT-Win64-Shipping`, `VALORANT`; `2xko` → `Lion-Win64-Shipping`, `Lion`; `lor` → `LoR`. Comparação sem diferença de maiúsculas.
- **Nome do processo:** `OpenProcess` com `PROCESS_QUERY_LIMITED_INFORMATION` e `QueryFullProcessImageNameW`, a cada janela, sem cache.

## Invariantes e decisões

- **Em Rust, sem processo externo (2026-11-21, [[ADR-044 Helpers do Windows em Rust]]).** Cada pedido custava 1 a 2 s de PowerShell e compilação de C#; a espera pelo jogo abria um PowerShell a cada 500 ms, e o "Jogo aberto" chegava cerca de 4,5 s depois da janela do League. Agora cada pedido é uma enumeração de janelas, em milissegundos. As regras são as mesmas do `.ps1`.
- **Janela dos cinco jogos (2026-11-19, [[ADR-038 TFT, 2XKO e Runeterra no Eclipse]]).** O TFT só conta pela janela dele, não pela do League; um jogo não vale pelo outro.
- **Só ações avulsas.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) não há monitor persistente, ganchos, nem esconder ou restaurar janelas. A [[ADR-004 Monitor persistente de janelas]] e a [[ADR-008 Recuperação visual sem reexibir o Riot]] ficam como histórico.
- **TrayIconClass nunca é ativada.** A janela da bandeja da Riot não é candidata.
- **Só a interface da Riot.** `reveal` e `close_client` só olham `Riot Client` e `RiotClientUx`. Serviços, jogos e Vanguard ficam fora.
- **Nome do jogo validado antes de olhar janelas.** Um jogo fora de `GAMES` dá `invalid-game` sem enumerar nada; o [[windowController]] já recusa antes, com "Invalid game".
- **Nome histórico.** As mensagens de erro do [[windowController]] ainda dizem "guard", do tempo do monitor.

## Testes

`src-tauri/tests/platform/windows/window_guard.rs`: a escolha da janela a ativar (bandeja, tamanho, raiz, processo), o filtro dos dois processos da interface, o bônus do título, o mapa de processos de cada jogo e que o `NativeWindows` recusa um jogo inválido. O comportamento com janelas reais não é testado automaticamente.

## Pontos de atenção

- **Filtro por nome de executável.** Nomes novos de processo da Riot ou do jogo quebram a detecção: [[Atualização do Riot Client]].
- Contexto: [[Integração com o Riot Client]], [[Limitações conhecidas]].
