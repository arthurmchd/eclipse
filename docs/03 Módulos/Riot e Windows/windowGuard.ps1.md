---
tipo: módulo
arquivo: src/platform/windows/windowGuard.ps1
camada: plataforma
testes: test/platform/windows/windowGuard.test.js
tags: [módulo]
---

# windowGuard.ps1

> Monitor persistente em PowerShell com C# embutido (`RiotWindowGuard`) que esconde as janelas do Riot Client e as devolve ao estado original.

## Responsabilidade

- Esconde e restaura janelas de processos Riot: `Riot Client`, `RiotClientUx`, `RiotClientUxRender`, `RiotClientServices`.
- Diz se a janela real do jogo já está visível.
- Não toca em processos de jogo, não injeta código, não usa teclado global e não tem tempo de vida fixo. Credenciais nunca entram neste processo.

## API pública

Protocolo por stdin/stdout, em UTF-8. A primeira linha é JSON:

| `action` | Efeito |
|---|---|
| `watch` ou ausente | `Watch(ownerPid)`: monitor persistente. |
| `restore` | `RestoreAll(true)` uma vez. |
| `game-window` | Imprime `game-ready` se a janela do jogo está pronta. |
| `self-test` | Testes internos sem tocar no desktop. |

No modo `watch`, cada linha seguinte é um comando:

| Comando | Efeito | Resposta |
|---|---|---|
| `hide` | Estilos ocultos, alpha 1, janela continua "mostrada". | `command:hide` |
| `conceal` | O mesmo de `hide` + `SW_HIDE`. | `command:conceal` |
| `reveal` | Restaura e ativa a janela principal. Para varreduras e eventos. | `command:reveal` |
| `stop` | Restaura sem ativar e sai. | `command:stop` |
| `game-window:<game>` | Consulta a janela do jogo. | `game-window:<game>:ready` ou `:waiting` |

Também imprime `ready` após armar, `ok` ao terminar bem e `error:<motivo>` (código 1) em falha.

## Dependências

- Usa: `Add-Type` com P/Invoke em `user32.dll`, `dwmapi.dll` e `kernel32.dll`.
- Usado por: [[windowController]]. Caminho via [[paths]].

## Funcionamento

- **Estilos ocultos:** `WS_EX_LAYERED`, `0x20` (transparente ao mouse), `0x08000000` (não ativa), `0x80` (janela de ferramenta). Remove `WS_EX_APPWINDOW`. Alpha 1 via `SetLayeredWindowAttributes`.
- **Snapshot por janela** em propriedades `SetProp` com prefixo `RiotAccountManager.Guard.`: `Saved`, `ExStyle`, `Visible`, `Iconic`, `Color`, `Alpha`, `AlphaFlags`, `Concealed`.
- **Ganchos:** `SetWinEventHook` para primeiro plano (`3`) e criação/exibição (`0x8000`–`0x8002`), fora de contexto e ignorando o próprio processo (flag `2`).
- **Laço do `Watch`:** drena até 128 mensagens, processa comandos, trata até 128 eventos, confere o dono a cada 500 ms, varre a cada 100 ms (fora de `reveal`) e dorme 5 ms. Sai com fim do stdin, dono encerrado ou `stop`.
- **Saída:** `mode = "reveal"`, remove os ganchos e chama `RestoreAll(false)`, salvo worker abandonado.
- **Janela principal em `RestoreAll`:** maior área com título; título "Riot Client" ganha bônus de 100 000 000.
- **`GameWindow`:** janela raiz visível, não minimizada, ao menos 160×120, sem `0x80`, não "cloaked" no DWM (atributo 14). Processo `VALORANT` ou `VALORANT-Win64-Shipping` para `val`; `LeagueClientUx` ou `League of Legends` para `lol` e `tft`.
- **Foco:** guarda a última janela não Riot em primeiro plano e devolve o foco a ela quando uma janela Riot o toma.

## Invariantes e decisões

- **O pump de mensagens é obrigatório.** Ganchos WinEvent fora de contexto entregam eventos pela fila desta thread.
- **Varredura cobre janelas recriadas.** O cliente pode recriar janelas com o jogo aberto; a varredura periódica as pega.
- **Nome do processo nunca fica em cache.** O cliente pode criar a interface depois da primeira varredura, ou o Windows pode reutilizar um PID numa troca de conta. Usa `OpenProcess(0x1000)` (`PROCESS_QUERY_LIMITED_INFORMATION`).
- **`Saved` é gravado por último.** A recuperação nunca lê um snapshot pela metade.
- **`CREATE` vem antes de `SHOW`.** Uma janela principal nova ainda não estava visível quando o estilo foi capturado, mas precisa ficar visível na recuperação. `SHOW` marca `Visible = 1`.
- **Mudança de estilo com prazo.** `SetWindowLong` envia `WM_STYLECHANGING` à thread dona da janela. Uma janela Chromium travada não pode bloquear o pump nem as confirmações. A chamada roda num worker em segundo plano, com limite de 750 ms, que morre com o helper.
- **Evento de worker com timeout não é descartado.** O worker ainda pode sinalizá-lo. O handle é liberado quando o helper sai ou o worker é coletado.
- **`FRAMECHANGED` assíncrono.** Ele envia `WM_NCCALCSIZE`. Com `SWP_ASYNCWINDOWPOS`, a mensagem vai para a fila da outra janela em vez de esperar o procedimento dela.
- **Alpha 1, não 0.** Mantém o Chromium renderizando para `PrintWindow` e para a digitação postada do [[login.ps1]].
- **Saindo de `conceal`, `SW_SHOWNA`.** A janela já está transparente antes de reaparecer, e não é ativada.
- **Restauração sem ativação.** `SW_SHOWMINNOACTIVE` (7), `SW_SHOWNA` (8) ou `SW_HIDE` (0), conforme o snapshot. Só `reveal` ativa a janela principal com `SW_RESTORE` (9) ou `SW_SHOW` (5).
- **Bit layered sai primeiro.** Senão, `SetLayeredWindowAttributes` deixa em alpha 1 uma janela que usava `UpdateLayeredWindow`, e as chamadas seguintes dela falham.
- **Callback nativo só enfileira.** Mudar estilos de outro processo ali pode reentrar na entrega de WinEvents ou atrasar a thread que lê o stdin. Fila limitada a 512.
- **Seguir a janela atual do usuário.** Não só a que estava ativa quando o monitor começou.
- **Delegate enraizado.** `callback` é estático e `GC.KeepAlive` o mantém vivo durante todo o gancho nativo.
- **Drenagem limitada.** No máximo 128 mensagens por volta, para uma rajada de eventos não atrasar comandos nem o fim da entrada.
- **Worker abandonado encerra o helper.** Uma chamada de estilo com timeout não pode ser cancelada com segurança. O helper sai em vez de restaurar em paralelo com ela. Os snapshots continuam nas janelas para um `restore` manual depois.
- **`SelfTest` não toca no desktop.** Testa o filtro de nomes, o worker (execução, erro e timeout) e a fila de eventos com um handle sintético nunca entregue a `HandleEvent`. Espera o worker de teste sair antes de descartar o evento dele.
- **Erro sem dados do pedido.** A saída nunca ecoa entrada do usuário. Quebras de linha do motivo viram espaço.

## Testes

`test/platform/windows/windowGuard.test.js` roda `{"action":"self-test"}` e espera `ok`. Só no Windows. Comportamento real com janelas não é testado automaticamente.

## Pontos de atenção

- **`firstFailure` guarda a última falha.** Em `RestoreAll`, cada erro sobrescreve o anterior.
- **Motivo de erro sem lista fechada.** Ao contrário do [[login.ps1]], qualquer mensagem de exceção .NET vai para `error:`. O `ConvertFrom-Json` da primeira linha não tem `try` próprio. O pedido não tem segredo, mas a regra é mais fraca.
- **Filtro por nome de executável.** Nomes novos de processo da Riot ou do jogo quebram a detecção: [[Atualização do Riot Client]].
- **Custo contínuo.** Varredura a cada 100 ms com `EnumWindows` e `OpenProcess` por janela, enquanto o app estiver aberto.
- **Ao fechar o app, as janelas voltam.** O fim do stdin restaura o estado original; janelas que estavam visíveis reaparecem.
- Contexto: [[Integração com o Riot Client]], [[Limitações conhecidas]].
