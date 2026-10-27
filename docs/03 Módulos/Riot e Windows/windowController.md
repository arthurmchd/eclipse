---
tipo: módulo
arquivo: src/platform/windows/windowController.js
camada: plataforma
testes: test/platform/windows/windowController.test.js
tags: [módulo]
---

# windowController

> Ponte em Node para o [[windowGuard.ps1]]: mantém um monitor persistente, enfileira comandos e espera a confirmação de cada um.

## Responsabilidade

- Inicia e reinicia o processo PowerShell do monitor de janelas.
- Envia `hide`, `conceal`, `reveal` e consultas de janela do jogo, um por vez.
- Detecta monitor morto ou travado e invalida o processo.
- Não decide quando esconder. Quem decide é o [[signInFlow]] ou o [[riotClient]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createWindowController(options)` | função | Opções: `spawn`, `timeoutMs = 15000`, `scriptPath = windowsHelper('windowGuard.ps1')`. |

Métodos do controlador:

| Método | Descrição |
|---|---|
| `hide()` | Garante o monitor e envia `hide`. Espera `command:hide`. |
| `conceal()` | Garante o monitor e envia `conceal`. Espera `command:conceal`. |
| `reveal()` | Monitor vivo: envia `reveal`. Sem monitor: roda um helper avulso `{ action: 'restore' }`. |
| `gameWindow(game)` | Valida `lol`, `tft` ou `val`. Com monitor: `game-window:<game>`, espera `:ready` ou `:waiting`. Sem monitor: helper avulso `{ action: 'game-window', game }`, procura `game-ready`. Retorna booleano. |
| `assertHealthy()` | Lança "The background window guard stopped. Try Play again" se parado ou morto. |
| `stop()` | Marca como descartado de vez e encerra o monitor. |

## Dependências

- Usa: [[windowGuard.ps1]], [[paths]] (`windowsHelper`), `child_process.spawn`.
- Usado por: [[riotClient]] (instância única `windows`), que o entrega ao [[signInFlow]].

## Funcionamento

- **`open(request, persistent)`**: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File windowGuard.ps1`, com `windowsHide`. Escreve o pedido JSON na primeira linha do stdin.
- **Persistente**: `{ ownerPid: process.pid }`. Espera `ready`. Cada comando vira uma linha no stdin.
- **Avulso**: fecha o stdin logo após o pedido. Um watchdog de `timeoutMs` mata o helper. Resolve com as linhas se o código é 0 e houve `ok`.
- **`start()`**: reaproveita a inicialização em curso ou o monitor vivo. Monitor morto é encerrado antes de criar outro. Falha no `ready` encerra o candidato.
- **`shutdown(current)`**: fecha o stdin e espera o `close` por até 3 s. Depois mata o processo.
- **`sequence(fn)`**: fila de promessas. Uma falha não trava os comandos seguintes.

## Invariantes e decisões

- **Um monitor para toda a sessão de jogo.** Os comandos são confirmados antes de o chamador seguir. Assim a partida não corre contra um monitor ainda não inicializado.
- **Timeout invalida o processo.** Sem resposta em `timeoutMs`, todas as esperas falham e o stdin é fechado. Uma confirmação tardia nunca pode satisfazer um comando posterior com a mesma resposta.
- **`error:` derruba tudo.** Qualquer linha `error:<motivo>` rejeita todas as esperas com "Background window guard: <motivo>".
- **Comandos em série.** `hide`, `conceal`, `reveal` e `gameWindow` passam por `sequence`. Duas respostas iguais nunca ficam pendentes ao mesmo tempo.
- **Nome do jogo validado antes de enviar.** Impede injetar comandos extras por quebra de linha (`lol\nreveal`).
- **`stop()` é definitivo.** Depois dele, todo método falha com "shutting down". Uma inicialização em curso também é rejeitada.
- **Saída do helper não vaza.** O stderr guarda só os últimos 2000 caracteres. A mensagem de erro diz apenas "helper error", sem o conteúdo.
- **Fechar o stdin encerra o monitor.** O [[windowGuard.ps1]] restaura as janelas ao estado original ao perceber o fim da entrada.

## Testes

`test/platform/windows/windowController.test.js`, com processos falsos:
- `hide` espera `ready` e a confirmação.
- Comandos simultâneos em série num único monitor.
- `game-window` com monitor (`ready`/`waiting`) e sem monitor (helper avulso).
- Timeout do helper avulso mesmo sem evento `close`.
- Erro de `spawn` sem rejeição não tratada.
- Comando com timeout invalida o monitor; o próximo cria outro.
- `stop` fecha a entrada, mata quem não fecha em 3 s e impede reinício.
- Injeção pelo nome do jogo e `assertHealthy` após perda do monitor.

Fora: o PowerShell real (ver [[windowGuard.ps1]]).

## Pontos de atenção

- **`gameWindow` e `reveal` tratam monitor morto de forma diferente.** `reveal` cai para o helper avulso quando o monitor não está vivo. `gameWindow` testa só `if (guard)`, e um monitor morto rejeita.
- **Timeout pode mostrar as janelas.** Depois de um timeout o stdin é fechado. Se o monitor ainda roda o laço, ele restaura as janelas Riot ao estado original. Elas ficam assim até um novo `hide` ou `conceal` criar outro monitor.
- **15 s incluem a compilação.** O `ready` só chega depois do `Add-Type` do C#, que roda a cada início do monitor.
- Decisão de arquitetura: [[Arquitetura]].
