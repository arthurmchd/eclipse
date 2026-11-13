---
tipo: módulo
arquivo: src/platform/windows/windowController.js
camada: plataforma
testes: test/platform/windows/windowController.test.js
tags: [módulo]
---

# windowController

> Ponte em Node para o [[windowGuard.ps1]]: roda o helper uma vez por ação, um de cada vez, e devolve o resultado.

## Responsabilidade

- Traz a janela do Riot Client à frente, fecha a janela dele e pergunta se a janela do jogo já está pronta.
- Roda cada pedido num PowerShell avulso e escondido, um por vez.
- Não esconde a Riot e não mantém processo vivo entre pedidos.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createWindowController(options)` | função | Opções: `spawn`, `timeoutMs = 15000`, `scriptPath = windowsHelper('windowGuard.ps1')`. |

Métodos do controlador:

| Método | Descrição |
|---|---|
| `reveal()` | Helper `{ action: 'reveal' }`: traz a janela principal do Riot Client à frente. |
| `closeClient()` | Helper `{ action: 'close-client' }`: fecha as janelas da interface. Não encerra os serviços nem os jogos. |
| `gameWindow(game)` | Valida `lol`, `tft` ou `val` e roda `{ action: 'game-window', game }`. Retorna `true` se o helper respondeu `game-ready`. |
| `stop()` | Espera o helper em andamento e recusa novos pedidos. |

## Dependências

- Usa: [[windowGuard.ps1]], [[paths]] (`windowsHelper`), `child_process.spawn`.
- Usado por: [[riotClient]] (instância única `windows`, com `reveal` em `openClient` e `startClient` e `stop` no `dispose`), que o entrega ao [[signInFlow]].

## Funcionamento

- **Um processo por pedido:** `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File windowGuard.ps1`, com `windowsHide`. Escreve o pedido JSON numa linha e fecha o stdin.
- **Sucesso:** código 0 e uma linha `ok`. Resolve com as linhas lidas.
- **Falhas:** `error:<motivo>` vira "Background window guard: <motivo>"; saída sem `ok` vira "The background window guard stopped (<código>)", com ": helper error" se houve stderr; o watchdog de `timeoutMs` mata o helper e falha com "The background window helper timed out".
- **`sequence(fn)`:** fila de promessas. Uma falha não trava os pedidos seguintes.

## Invariantes e decisões

- **Sem ocultação e sem monitor persistente.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), saíram `hide`, `conceal`, `park`, `assertHealthy`, `drainIncidents`, o monitor persistente, a recuperação de monitor perdido (`handoff`, `maxRecoveries`, `recoveryWindowMs`, `guardReason`) e a restauração final no `stop`. Só o login escondido do modo antigo armava o monitor; o login visível usava apenas os pedidos avulsos que ficaram. A [[ADR-004 Monitor persistente de janelas]] e a [[ADR-008 Recuperação visual sem reexibir o Riot]] ficam como histórico.
- **Um helper de cada vez.** `reveal`, `closeClient` e `gameWindow` passam por `sequence`. Dois PowerShell do Eclipse nunca mexem nas janelas ao mesmo tempo.
- **Nome do jogo validado antes de abrir o helper.** Impede pedir outra ação por quebra de linha (`lol\nreveal`).
- **Motivo de erro com vocabulário fechado.** O motivo de `error:` passa por `^[a-z0-9-]{1,64}$`; texto livre do .NET vira `unknown` e nunca chega à mensagem nem ao log.
- **Saída do helper não vaza.** O stderr guarda só os últimos 2000 caracteres. A mensagem de erro diz apenas "helper error", sem o conteúdo.
- **Timeout não depende do `close`.** O pedido falha no prazo mesmo se matar o processo não emitir `close`.
- **`stop()` é definitivo.** Depois dele, todo método falha com "The background window guard is shutting down". Chamadas repetidas só esperam a fila.
- **Mensagens antigas mantidas.** Os textos de erro continuam os de antes, com "guard", para o `sign-in.log` e o [[language]] não mudarem.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/platform/windows/window_controller.rs`, testes em `src-tauri/tests/platform/windows/window_controller.rs`. O PowerShell roda pela trait `HelperRunner`; um `Mutex` faz os helpers rodarem um por vez e o `stop` espera o que está rodando. No prazo, o Rust encerra a árvore do PowerShell (`taskkill /T`). O mesmo executor aceita cancelamento, usado pelo `login.ps1` no [[riotClient]]. Veio para a fase 2 porque o [[signInFlow]] depende dele.

## Testes

`test/platform/windows/windowController.test.js`, com processos falsos:
- O controlador só expõe `reveal`, `closeClient`, `gameWindow` e `stop`.
- `reveal` abre um PowerShell escondido com o pedido certo e fecha o stdin.
- `closeClient` usa o helper `close-client` sem matar processos.
- `gameWindow` devolve `true` com `game-ready` e `false` sem ele; nomes de jogo inválidos não abrem helper.
- Pedidos em série.
- Motivo de erro fora do vocabulário vira `unknown`; saída sem `ok` falha com o código.
- Timeout sem evento `close` e erro de `spawn` sem rejeição não tratada.
- `stop` espera o helper em andamento e depois recusa pedidos.

Fora: o PowerShell real (ver [[windowGuard.ps1]]).

## Pontos de atenção

- **15 s incluem a compilação.** Cada pedido compila o C# do helper com `Add-Type` antes de agir.
- Decisão de arquitetura: [[Arquitetura]].
