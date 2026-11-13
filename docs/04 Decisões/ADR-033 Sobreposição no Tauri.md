---
tipo: decisão
status: aceita
data: 2026-11-13
tags: [adr, arquitetura, segurança, tauri]
---

# ADR-033 Sobreposição no Tauri

Detalha a fase 4 da [[ADR-032 Migração para Tauri e Rust]]: como a sobreposição dos [[cards]] sobre a Riot é montada sem o Electron.

## Contexto

No Electron, o [[riotOverlay]] é uma `BrowserWindow` transparente com três `WebContentsView` dentro: os cartões ([[managerHost]]), a cobertura da coluna de login ([[overlayCover]]) e a caixa "Ocultar contas" ([[overlayToggle]]). A região de cliques é o `setShape`, em pixels lógicos (DIP), convertidos com `screen.screenToDipRect`. Os cartões falam com o processo principal por um `preload` ([[manager-preload]]) que expõe `window.api` sobre `ipcRenderer.invoke`, e o processo principal confere quem chamou pelo `webContents` e pela URL. O [[riotWindowObserver]] (PowerShell) segue a janela da Riot, prende a sobreposição a ela como dona e manda a posição em pixels físicos.

O Tauri não tem `setShape`, nem `preload` com `contextBridge`, e só aceita várias webviews numa janela com a opção `unstable`. Os cartões também carregam fontes de `node_modules/@fontsource`, fora da pasta `src/renderer` que o Tauri serve.

## Decisão

- **Uma janela transparente com três webviews filhas**, como no Electron, pela opção `unstable` do Tauri 2 (`Window::add_child`). Cada webview tem rótulo fixo: `cards`, `cover` e `toggle`.
- **A região de cliques é o `SetWindowRgn` do Windows**, montada em Rust a partir dos mesmos retângulos do `overlayShape`. Tudo passa a ser em pixels físicos, como o observador já manda: some a conversão para DIP, o raio do canto é o da Riot menos 1 e a borda de cima é 1 pixel físico, que é o que o Windows desenha.
- **A geometria e as decisões de layout ficam em Rust puro**, com a janela atrás de uma trait. Os testes do [[riotOverlay]] são portados sem abrir janela nenhuma.
- **O [[riotWindowObserver]] continua sendo o mesmo `.ps1`**, chamado pelo Rust como o `login.ps1` e o `windowGuard.ps1`, com o mesmo protocolo de linhas JSON e o HWND da janela do Tauri.
- **Os arquivos chegam por um protocolo próprio, `eclipse://`, com lista fechada**: os arquivos de `src/renderer`, os da caixa e da cobertura, e só as fontes usadas, de `node_modules/@fontsource`. Qualquer outro caminho, incluindo `..` e escapes, recebe 404. Na fase 5, o mesmo protocolo passa a ler dos recursos do instalador.
- **A ponte `window.api` é um script de inicialização só na webview `cards`.** Ele reaproveita o `createManagerApi` do [[manager-preload]] e troca o `ipcRenderer.invoke` por um único comando do Tauri, `manager`. O comando confere em Rust que veio da webview `cards`, carregada de `eclipse://` no arquivo dos cartões, e repassa ao [[managerService]] com as mesmas validações (lista de métodos, até 4 argumentos, até 32 KB). A caixa usa outro comando, `overlay_toggle`, só da webview `toggle`. A cobertura não tem JavaScript nem comando.
- **Nada além disso fica exposto.** Sem `withGlobalTauri`, sem plugins de arquivo, shell ou processo. O `build.rs` declara os dois comandos do app, e as capacidades do Tauri liberam `manager` só para a webview `cards` e `overlay_toggle` só para a `toggle`, sem nenhuma permissão do núcleo do Tauri; navegação para fora do arquivo de cada webview é negada, e um link `https:` dos cartões abre no navegador pelo `openExternal`, como hoje.
- **O app de desenvolvimento só abre numa pasta de dados escolhida à mão.** Em desenvolvimento, o Eclipse exige `ECLIPSE_DATA_DIR` com um caminho absoluto e lê e grava ali; sem ela, não abre. Assim, um `cargo run` nunca abre `%APPDATA%\riot-account-manager` por acidente, e conferir com contas fictícias não toca os dados reais. O app compilado em modo release ignora a variável e usa a pasta real.
- **O Win32 roda na thread principal.** `SetWindowPos`, `SetWindowRgn` e `ShowWindow` vão para a thread principal por `run_on_main_thread`, e a thread principal nunca espera a trava do controlador: os comandos são `async` e a bandeja e o início rodam em outras threads. Assim, nenhuma das duas fica esperando a outra.

## Alternativas consideradas

- **Uma página só, com os cartões num `iframe`.** Evita a opção `unstable`, mas a ponte passaria por `postMessage` entre frames e a página dos cartões mudaria. Mais código novo e mais lugares para errar a origem.
- **Três janelas separadas, presas uma à outra.** Sem `unstable`, mas cada movimento da Riot moveria três janelas, com tremido entre elas, e a ordem de cima para baixo ficaria frágil.
- **Reescrever o observador em Rust agora.** Daria menos um PowerShell rodando, mas é o código mais delicado da sobreposição e já foi conferido na Riot real. Fica para depois da troca, se valer a pena.
- **Servir `node_modules` inteiro.** Mais simples, mas abre centenas de arquivos que os cartões não usam.

## Consequências

- A opção `unstable` pode mudar entre versões do Tauri. O `Cargo.lock` fixa a 2.12.5, e uma atualização do Tauri precisa rodar a sobreposição de novo antes de entrar.
- A ponte é JavaScript na mesma página dos cartões, sem a separação do `contextIsolation`. Como a página é nossa e não carrega nada de fora, o risco é o mesmo de hoje; a defesa continua no Rust, que valida tudo o que chega.
- O WebView2 pode reduzir o ritmo de uma janela que ele acha coberta. Por isso as três webviews já sobem com `CalculateNativeWinOcclusion` desligado, como o Electron faz, e as transições do DWM da janela vêm desligadas. Os argumentos do navegador precisam ser iguais nas três, porque elas dividem o mesmo ambiente da WebView2.
- A sobreposição precisa ser conferida na Riot real, com permissão do usuário. Os testes cobrem a geometria, o layout e a ponte, não o desenho na tela. Mesmo com uma pasta de dados fictícia, o app ligado vigia a janela da Riot e os serviços leem e limpam o login lembrado da Riot, então rodá-lo já é mexer na Riot real.

## Relacionado

- [[ADR-032 Migração para Tauri e Rust]]
- [[Migração para Tauri]]
- [[Segurança e privacidade]]
- [[riotOverlay]] · [[managerHost]] · [[manager-preload]] · [[overlayToggle]] · [[overlayCover]] · [[riotWindowObserver]] · [[assetProtocol]] · [[paths]]
