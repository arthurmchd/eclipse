---
tipo: módulo
arquivo: src/platform/windows/riotWindowObserver.js
camada: plataforma
testes: test/platform/windows/riotWindowObserver.test.js
tags: [módulo, janelas]
---

# riotWindowObserver

## Responsabilidade

Lê posição e visibilidade da janela oficial para [[riotOverlay]] e prende a sobreposição a ela. O helper `riotWindowObserver.ps1` compila C#, procura a janela a cada 180 ms e envia cada movimento assim que o Windows o anuncia. A única janela que ele altera é a da própria sobreposição.

## API pública

Fábrica com spawn, relógio, timers e callbacks injetáveis; métodos `start(clientPath, overlayWindow)` e `stop()`. Stdin leva somente caminho da instalação, PID dono e `overlayWindow` (identificador decimal da janela da sobreposição, só aceito como texto de dígitos; qualquer outro valor vira `null`). Stdout leva `{target:null}` ou `{target:{id,x,y,width,height}}`, com `minimized:true` quando a janela escolhida está minimizada. `validTarget` só aceita `minimized` ausente ou `true`.

## Invariantes e decisões

- **Dono da sobreposição.** Desde 2026-11-04 ([[ADR-012 Sobreposição presa à janela do Riot]]), a cada leitura o helper define a janela da Riot escolhida como dona da janela da sobreposição (`SetWindowLongPtr` com `GWLP_HWNDPARENT`) e confere com `GetWindow(GW_OWNER)`. Antes, confere que a janela da sobreposição pertence ao PID dono; senão encerra com erro. Se o dono não pode ser definido, o helper também encerra com erro e a sobreposição fica oculta. Fechar a janela da Riot só deixa a sobreposição sem dono.
- **Janela minimizada continua escolhida.** Desde 2026-11-04, se a janela escolhida está minimizada, ainda visível e ainda do executável oficial, `Find` a mantém e `Describe` envia o último retângulo medido dela com `minimized:true`. Só vale para uma janela já medida; uma Riot que começa minimizada continua `target:null` até aparecer. Ao restaurar, o evento de posição envia o retângulo real em cerca de 10 ms (teste com janela de teste).
- **Movimento por evento.** `SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE)` fora de contexto, só para o processo da janela escolhida, trocado quando esse processo muda. Cada evento da própria janela (objeto `0`) envia a nova posição se ela mudou. Teste com janelas de teste em 2026-11-04: cada movimento chegou em 0 a 12 ms, contra até 180 ms da leitura periódica.
- **Laço de mensagens.** O helper roda em C# com `GetMessage` e um temporizador de thread de 180 ms. O temporizador procura a janela, atualiza dono e gancho, envia a amostra (sinal de vida para o watchdog) e encerra quando o processo dono termina.
- O campo `active` (foco) saiu em 2026-11-04: a sobreposição não depende mais do foco.

- Executável deve corresponder ao caminho oficial `RiotClientElectron/Riot Client.exe` ou legado `UX/RiotClientUx.exe` sob a instalação detectada. Não observa League, Vanguard ou programas com nome igual em outro caminho.
- Ignora janela invisível, cloaked ou menor que 320×240, e janela minimizada que não seja a já escolhida. Prefere janela em primeiro plano; caso contrário, a de maior área.
- Usa consciência de DPI por thread para retornar pixels físicos. Electron converte para DIP.
- Mede somente a área cliente com `GetClientRect` e converte sua origem com `ClientToScreen`. Exclui molduras externas invisíveis que `GetWindowRect` incluía, para o painel não ultrapassar a área interna visível do Riot. Janela cuja área não possa ser medida é ignorada.
- Não lê títulos, conteúdo, comandos de processo, autenticação ou credenciais. Não usa eventos de teclado nem mouse. Não altera nenhuma janela da Riot.
- Processo dono encerrado termina o helper. Parada do serviço mata somente seu filho. O watchdog oculta a sobreposição após 3 segundos sem amostra válida.
- JSON inválido/oversized produz erro fixo e oculta o painel; não encaminha stderr nem texto arbitrário. Falha do helper requer reiniciar o gerenciador.

## Testes

Stream fragmentado, validação de limites, timeout, encerramento, erro sem vazamento e identificador da sobreposição só como texto numérico. O helper PowerShell não tem teste automatizado; foi conferido em 2026-11-04 com janelas de teste (dono definido, movimentos em até 12 ms, saída ao terminar o processo dono; janela minimizada com o mesmo `id`, restaurada em cerca de 10 ms). Integração visual deve ser revalidada após mudanças de layout ou versão do Riot.
