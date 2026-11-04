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
- Detecta monitor morto ou travado, invalida o processo e, se estava armado, sobe outro no mesmo modo.
- Guarda o motivo de cada queda para o `sign-in.log`.
- Não decide quando esconder. Quem decide é o [[signInFlow]] ou o [[riotClient]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createWindowController(options)` | função | Opções: `spawn`, `timeoutMs = 15000`, `scriptPath = windowsHelper('windowGuard.ps1')`, `maxRecoveries = 3`, `recoveryWindowMs = 60000`, `now = Date.now`. |

Métodos do controlador:

| Método | Descrição |
|---|---|
| `hide()` | Arma o modo `hide`, garante o monitor e envia `hide`. Espera `command:hide`. Repete uma vez num monitor novo se o atual cair no meio. |
| `conceal()` | O mesmo, com `conceal`. |
| `reveal()` | Desarma. Monitor vivo: envia `reveal`. Sem monitor vivo: helper avulso `{ action: 'restore' }`. |
| `gameWindow(game)` | Valida `lol`, `tft` ou `val`. Monitor vivo: `game-window:<game>`, espera `:ready` ou `:waiting`. Sem monitor vivo: helper avulso `{ action: 'game-window', game }`, procura `game-ready`. Repete uma vez se o monitor cair no meio. Retorna booleano. |
| `assertHealthy()` | Passa com monitor vivo ou recuperação em andamento. Senão lança "The background window guard stopped (<motivo>). Try Play again". |
| `drainIncidents()` | Devolve e limpa a lista de quedas `{ reason, recovered }` (no máximo 20 guardadas). |
| `stop()` | Desarma, marca como descartado de vez e encerra o monitor. Restaura sem ativação os snapshots retidos por falha ou recuperação; chamadas repetidas compartilham o mesmo encerramento. |

## Motivos de queda (`guardReason`)

| Código | Origem |
|---|---|
| `window-style-timeout`, `window-style-denied`, `window-opacity-denied`, `window-access-denied`, `window-hook-failed`… | Linha `error:<código>` do [[windowGuard.ps1]] |
| `no-response` | Nenhuma confirmação em `timeoutMs` |
| `exit-<código>` | Processo saiu sem `ok` |
| `input-closed`, `spawn-error`, `helper-timeout` | stdin fechado, falha ao iniciar, helper avulso estourou o prazo |
| `unknown` | Qualquer texto fora de `^[a-z0-9-]{1,64}$` |

## Dependências

- Usa: [[windowGuard.ps1]], [[paths]] (`windowsHelper`), `child_process.spawn`.
- Usado por: [[riotClient]] (instância única `windows`), que o entrega ao [[signInFlow]].

## Funcionamento

- **`open(request, persistent)`**: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File windowGuard.ps1`, com `windowsHide`. Escreve o pedido JSON na primeira linha do stdin.
- **Persistente**: `{ ownerPid: process.pid, initialMode: 'hide' | 'conceal' }`. O modo armado é aplicado antes da primeira varredura e do `ready`. Cada comando vira uma linha no stdin.
- **Avulso**: fecha o stdin logo após o pedido. Um watchdog de `timeoutMs` mata o helper. Resolve com as linhas se o código é 0 e houve `ok`.
- **`start()`**: reaproveita a inicialização em curso ou o monitor vivo. Monitor morto é encerrado antes de criar outro. Falha no `ready` encerra o candidato.
- **`shutdown(current, { handoff })`**: em recuperação, escreve `handoff` antes de fechar o stdin, mesmo se o helper já foi marcado como inválido. Espera `close` por até 3 s e depois mata o processo. Encerramento forçado marca a restauração avulsa como necessária.
- **`sequence(fn)`**: fila de promessas. Uma falha não trava os comandos seguintes.

## Invariantes e decisões

- **`closeClient()` após jogo pronto.** Desarma o monitor, restaura estilos se necessário e chama o helper `close-client`. Não encerra o backend ou processos de jogo.

- **`closeClient()` após jogo pronto.** Desarma o monitor, restaura estilos se necessário e chama o helper `close-client`. Não encerra o backend ou processos de jogo.

- **`park()` desarma sem mostrar.** Serializa o comando nativo `park` ou usa helper avulso quando o monitor caiu. Restaura os estilos conservando as janelas ocultas; não reinicia monitor perdido enquanto desarmado. Um `hide` posterior pode armar novamente.

- **Um monitor para toda a sessão de jogo.** Os comandos são confirmados antes de o chamador seguir. Assim a partida não corre contra um monitor ainda não inicializado.
- **Timeout invalida o processo.** Sem resposta em `timeoutMs`, todas as esperas falham e o stdin é fechado. Uma confirmação tardia nunca pode satisfazer um comando posterior com a mesma resposta.
- **`error:` derruba o processo.** Qualquer linha `error:<motivo>` rejeita todas as esperas com "Background window guard: <motivo>". O motivo passa por uma lista fechada de caracteres; texto livre do .NET vira `unknown` e nunca chega ao log.
- **Monitor perdido é reerguido, não abandonado.** Uma queda **depois** do `ready` marca o erro com `guardLost`. Se o controlador está armado (`hide` ou `conceal`), um monitor novo sobe no mesmo modo. Antes de 2026-10-26, a queda abortava o login, inclusive logo depois de a senha ter sido digitada no formulário nativo, e o jogo nunca era pedido.
- **Reerguer sem revelar.** O [[windowGuard.ps1]] só grava o estado original de uma janela se ela ainda não tem o snapshot `Saved`. O monitor novo herda o estado original salvo pelo anterior e o mesmo modo armado. `handoff` conserva a ocultação na passagem entre processos, inclusive no timeout de comandos. Ver [[ADR-008 Recuperação visual sem reexibir o Riot]].
- **Recuperação limitada.** No máximo `maxRecoveries` (3) por `recoveryWindowMs` (60 s). Passou disso, `assertHealthy` falha com o último motivo, e o [[signInFlow]] aborta como antes.
- **Falha antes do `ready` não é repetida.** Um monitor que nunca fica pronto (PowerShell bloqueado, compilação falhando) falha rápido, sem tentativa extra.
- **Comando interrompido é repetido uma vez.** `hide`, `conceal` e `gameWindow` que perdem o monitor no meio são reenviados num monitor novo. A recuperação enfileirada percebe que já foi feita e não duplica.
- **Desarmado não reergue.** Depois de `reveal` ou `stop`, uma queda não sobe outro monitor; o próximo `hide`/`conceal` cria um quando precisar.
- **Comandos em série.** `hide`, `conceal`, `reveal` e `gameWindow` passam por `sequence`. Duas respostas iguais nunca ficam pendentes ao mesmo tempo.
- **Nome do jogo validado antes de enviar.** Impede injetar comandos extras por quebra de linha (`lol\nreveal`).
- **`stop()` é definitivo e idempotente.** Depois dele, todo método falha com "shutting down". Uma inicialização em curso também é rejeitada. O encerramento espera a inicialização e a fila pendentes; erro persistente, `handoff` ou encerramento forçado exigem helper `{ action: 'restore', activate: false }`, mesmo se o monitor já morreu ou a recuperação esgotou seu limite.
- **Saída do helper não vaza.** O stderr guarda só os últimos 2000 caracteres. A mensagem de erro diz apenas "helper error", sem o conteúdo.
- **Fim normal e recuperação são distintos.** EOF normal restaura as janelas. EOF precedido por `handoff` mantém snapshots e ocultação enquanto o dono vive; a saída definitiva do controlador faz a restauração final. O comando manual `reveal` continua restaurando e ativando a interface.

## Testes

`test/platform/windows/windowController.test.js`, com processos falsos:
- `hide` espera `ready` e a confirmação.
- Comandos simultâneos em série num único monitor.
- `game-window` com monitor (`ready`/`waiting`) e sem monitor (helper avulso).
- Timeout do helper avulso mesmo sem evento `close`.
- Erro de `spawn` sem rejeição não tratada.
- Comando com timeout invalida o monitor e é repetido uma vez num monitor novo.
- Monitor perdido enquanto armado é reerguido no mesmo modo, com o motivo registrado.
- `hide`/`conceal` interrompidos são repetidos uma vez.
- Recuperação limitada: depois do limite, `assertHealthy` falha com o motivo.
- Motivo fora do vocabulário vira `unknown`.
- `gameWindow` usa helper avulso quando o monitor desarmado parou.
- `stop` fecha a entrada, mata quem não fecha em 3 s e impede reinício.
- Injeção pelo nome do jogo e `assertHealthy` sem monitor e após `stop`.
- Recuperação sem restauração intermediária e modo inicial correto; `stop` após falha definitiva, com substituto ainda iniciando, e repetido sem duplicar cleanup.

Fora: o PowerShell real (ver [[windowGuard.ps1]]).

## Pontos de atenção

- **Causas observadas.** Os registros de 2026-10-27 confirmam `window-style-denied` depois do formulário e `window-style-timeout` durante carregamentos. A comparação de estilos agora ignora bits alheios ao monitor, e a recuperação preserva a ocultação.
- **Limite da correção.** O monitor reage a eventos de criação de janelas. A ausência de qualquer quadro visível exige validação visual na instalação real; os testes automatizados não abrem o Riot nem uma conta real.
- **15 s incluem a compilação.** O `ready` só chega depois do `Add-Type` do C#, que roda a cada início do monitor.
- Decisão de arquitetura: [[Arquitetura]].
