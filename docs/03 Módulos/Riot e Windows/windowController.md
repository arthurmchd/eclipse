---
tipo: módulo
arquivo: src-tauri/src/platform/windows/window_controller.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/window_controller.rs
tags: [módulo]
---

# windowController

> Ponte para o [[windowGuard.ps1]]: roda o helper uma vez por ação, um de cada vez, e devolve o resultado.

## Responsabilidade

- Traz a janela do Riot Client à frente, fecha a janela dele e pergunta se a janela do jogo já está pronta.
- Roda cada pedido num PowerShell avulso e escondido, um por vez.
- Não esconde a Riot e não mantém processo vivo entre pedidos.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `WindowController::new(executor, script, prazo)` | construtor | `executor` é a trait `HelperRunner` (o real é o `PowerShell`); `script`, o [[windowGuard.ps1]]; `prazo`, 15 s no app |
| `reveal()` | método | Helper `{ action: 'reveal' }`: traz a janela principal do Riot Client à frente |
| `close_client()` | método | Helper `{ action: 'close-client' }`: fecha as janelas da interface. Não encerra os serviços nem os jogos |
| `game_window(jogo)` | método | Valida `lol`, `tft` ou `val` e roda `{ action: 'game-window', game }`. Devolve `true` se o helper respondeu `game-ready` |
| `stop()` | método | Espera o helper em andamento e recusa novos pedidos |
| `powershell_args(script)`, `safe_reason(texto)` | funções | Os argumentos do PowerShell escondido e o motivo de erro só do vocabulário conhecido |

## Dependências

- Usa: [[windowGuard.ps1]], [[paths]] (pasta dos helpers) e o PowerShell do Windows.
- Usado por: [[riotClient]] (uma instância, com `reveal` ao abrir e iniciar o cliente e `stop` ao sair), que o entrega ao [[signInFlow]]. O mesmo executor roda o [[login.ps1]], com cancelamento.

## Funcionamento

- **Um processo por pedido:** `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File windowGuard.ps1`, com `windowsHide`. Escreve o pedido JSON numa linha e fecha o stdin.
- **Sucesso:** código 0 e uma linha `ok`. Resolve com as linhas lidas.
- **Falhas:** `error:<motivo>` vira "Background window guard: <motivo>"; saída sem `ok` vira "The background window guard stopped (<código>)", com ": helper error" se houve stderr; o watchdog de `timeoutMs` mata o helper e falha com "The background window helper timed out".
- **`sequence(fn)`:** fila de promessas. Uma falha não trava os pedidos seguintes.

## Invariantes e decisões

- **Sem ocultação e sem monitor persistente.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), saíram `hide`, `conceal`, `park`, `assertHealthy`, `drainIncidents`, o monitor persistente, a recuperação de monitor perdido (`handoff`, `maxRecoveries`, `recoveryWindowMs`, `guardReason`) e a restauração final no `stop`. Só o login escondido do modo antigo armava o monitor; o login visível usava apenas os pedidos avulsos que ficaram. A [[ADR-004 Monitor persistente de janelas]] e a [[ADR-008 Recuperação visual sem reexibir o Riot]] ficam como histórico.
- **Um helper de cada vez.** `reveal`, `close_client` e `game_window` passam por um `Mutex`. Dois PowerShell do Eclipse nunca mexem nas janelas ao mesmo tempo.
- **Nome do jogo validado antes de abrir o helper.** Impede pedir outra ação por quebra de linha (`lol\nreveal`).
- **Motivo de erro com vocabulário fechado.** O motivo de `error:` passa por `^[a-z0-9-]{1,64}$`; texto livre do .NET vira `unknown` e nunca chega à mensagem nem ao log.
- **Saída do helper não vaza.** O stderr guarda só os últimos 2000 caracteres. A mensagem de erro diz apenas "helper error", sem o conteúdo.
- **Timeout não depende do `close`.** O pedido falha no prazo mesmo se matar o processo não emitir `close`.
- **`stop()` é definitivo.** Depois dele, todo método falha com "The background window guard is shutting down". Chamadas repetidas só esperam a fila.
- **Mensagens antigas mantidas.** Os textos de erro continuam os de antes, com "guard", para o `sign-in.log` e o [[language]] não mudarem.
- **Prazo encerra a árvore.** No prazo, a árvore do PowerShell é encerrada (`taskkill /T`), e o erro é um texto fixo.

## Testes

`src-tauri/tests/platform/windows/window_controller.rs`, com executor falso:
- `reveal` roda um helper avulso e escondido que traz a Riot à frente.
- `close_client` usa o helper próprio de fechar a janela.
- `game_window` responde pelo helper avulso; nomes de jogo não injetam outras ações.
- Helpers rodam um por vez.
- Erro do helper só com o vocabulário fixo; saída sem confirmação falha com o código.
- Prazo estourado ou falha ao iniciar dão texto fixo.
- `stop` espera o helper em andamento e depois recusa pedidos.

Fora: o PowerShell real (ver [[windowGuard.ps1]]).

## Pontos de atenção

- **15 s incluem a compilação.** Cada pedido compila o C# do helper com `Add-Type` antes de agir.
- Decisão de arquitetura: [[Arquitetura]].
