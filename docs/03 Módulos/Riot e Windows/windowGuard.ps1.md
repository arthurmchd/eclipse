---
tipo: módulo
arquivo: src/platform/windows/windowGuard.ps1
camada: plataforma
testes: test/platform/windows/windowGuard.test.js
tags: [módulo]
---

# windowGuard.ps1

> Helper avulso em PowerShell com C# embutido (`RiotWindowHelper`) que traz a janela do Riot Client à frente, fecha a janela dele e procura a janela do jogo.

## Responsabilidade

- Ativa a janela principal da interface do Riot Client (`Riot Client` ou `RiotClientUx`).
- Pede o fechamento das janelas da interface, sem encerrar serviços nem jogos.
- Diz se a janela real do jogo já está visível.
- Não esconde janelas, não muda estilos, não toca em processos de jogo, não injeta código e não usa teclado global. Credenciais nunca entram neste processo.

## API pública

Protocolo por stdin/stdout, em UTF-8. Uma única linha JSON por execução:

| `action` | Efeito |
|---|---|
| `reveal` | Ativa a janela principal da interface do Riot Client, se houver. |
| `close-client` | Envia `WM_CLOSE` somente a janelas raiz de `Riot Client`/`RiotClientUx`. |
| `game-window` | Com `game` igual a `lol`, `tft` ou `val`, imprime `game-ready` se a janela do jogo está pronta. |
| `self-test` | Testa os filtros sem tocar no desktop. |

Termina com `ok` (código 0) ou `error:<motivo>` (código 1). Qualquer outra ação, ou `action` que não é texto, dá `error:invalid-action`.

## Dependências

- Usa: `Add-Type` com P/Invoke em `user32.dll`, `dwmapi.dll` e `kernel32.dll`.
- Usado por: [[windowController]]. Caminho via [[paths]].

## Funcionamento

- **Janela principal em `Reveal`:** entre as candidatas com título, a de maior área; título "Riot Client" ganha bônus de 100 000 000. Restaura com `SW_RESTORE` (9) se minimizada, senão `SW_SHOW` (5), e chama `SetForegroundWindow`.
- **Candidata a ativar:** janela raiz, classe diferente de `TrayIconClass`, ao menos 320×240, processo `Riot Client` ou `RiotClientUx`. Serviços, janelas auxiliares e jogos não são candidatos.
- **`GameWindow`:** janela raiz visível, não minimizada, ao menos 160×120, sem `WS_EX_TOOLWINDOW` (`0x80`), não "cloaked" no DWM (atributo 14). Processo `VALORANT` ou `VALORANT-Win64-Shipping` para `val`; `LeagueClientUx` ou `League of Legends` para `lol` e `tft`.
- **Nome do processo:** `OpenProcess(0x1000)` (`PROCESS_QUERY_LIMITED_INFORMATION`) e `QueryFullProcessImageName`, a cada janela, sem cache.

## Invariantes e decisões

- **Só ações avulsas.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), saíram o monitor persistente (`watch`, `ownerPid`, `initialMode`, comandos `hide`, `conceal`, `park`, `handoff` e `stop`), os ganchos `SetWinEventHook`, as varreduras, o snapshot de estilos nas propriedades `RiotAccountManager.Guard.*`, o worker de estilos com prazo, `restore`, `park`, `hide-auxiliary`, `inspect` e `diagnostics`. Tudo isso servia ao login escondido do modo antigo. O que restou é o que o login visível já usava: ativar a janela (antes `restore`, agora `reveal`), fechar a interface e procurar o jogo. A [[ADR-004 Monitor persistente de janelas]] e a [[ADR-008 Recuperação visual sem reexibir o Riot]] ficam como histórico.
- **Janelas escondidas por versões antigas não são restauradas.** O `restore` antigo desfazia snapshots deixados por um monitor que caiu. O monitor restaurava tudo quando o Eclipse fechava, e nada esconde a Riot desde 2026-11-07, então esse resto só existiria numa Riot aberta desde antes da atualização; ele some quando a Riot reinicia.
- **TrayIconClass nunca é ativada.** A janela da bandeja da Riot não é candidata em `Reveal`. O self-test cobre essa seleção.
- **Só a interface da Riot.** `Reveal` e `close-client` só olham `Riot Client` e `RiotClientUx`. Serviços (`RiotClientServices`), jogos e Vanguard ficam fora.
- **Nome do jogo validado.** `GameWindow` recusa qualquer jogo fora de `lol`, `tft` e `val` com `error:invalid-game`, antes de enumerar janelas.
- **`SelfTest` não toca no desktop.** Testa a escolha da janela a ativar, o filtro de processos da interface, o mapa de processos de cada jogo e a recusa de um nome de jogo inválido.
- **Erro sem dados do pedido.** A saída nunca ecoa entrada do usuário. Quebras de linha do motivo viram espaço.
- **Nome histórico.** O arquivo e as mensagens de erro do [[windowController]] ainda dizem "guard", do tempo do monitor.

## Testes

`test/platform/windows/windowGuard.test.js`, só no Windows: o `self-test` responde `ok`; os pedidos do monitor antigo e as ações de esconder (`watch`, `park`, `restore`, `hide-auxiliary`, `inspect`) são recusados com `error:invalid-action`; um jogo inválido e uma `action` em lista são recusados sem olhar janelas. Comportamento real com janelas não é testado automaticamente.

## Pontos de atenção

- **Motivo de erro sem lista fechada aqui.** Qualquer mensagem de exceção .NET vai para `error:`. O [[windowController]] aceita só códigos `^[a-z0-9-]{1,64}$` e troca o resto por `unknown`.
- **Filtro por nome de executável.** Nomes novos de processo da Riot ou do jogo quebram a detecção: [[Atualização do Riot Client]].
- **Compilação a cada pedido.** O `Add-Type` roda em toda execução, cerca de meio segundo.
- Contexto: [[Integração com o Riot Client]], [[Limitações conhecidas]].
