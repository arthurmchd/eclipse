---
tipo: módulo
arquivo: src/integration/manager/managerHost.js
camada: integração
testes: test/integration/manager/managerHost.test.js
tags: [módulo, interface]
---

# managerHost

> Hospeda os [[cards]] como visualização filha da janela da sobreposição, sem criar outra `BrowserWindow`.

## Responsabilidade

Cria e redimensiona um `WebContentsView`, carrega o HTML local dos [[cards]], fornece o [[manager-preload]] isolado e encaminha seus comandos ao serviço de contas. Fechar a visualização não encerra o serviço, a janela pai ou o login.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createManagerHost(options)` | função | Recebe Electron e transporte `request(method, args)` injetáveis, os caminhos do renderer (padrão `ACCOUNT_CARDS_FILE`) e do preload, os recuos superior (`topInset`, padrão zero) e esquerdo (`leftInset(largura)`, padrão zero) da visualização e `onWindowAction(ação)`, chamado com `minimize` ou `close` quando a página pede uma ação na janela do Riot (padrão: devolve `false`). |
| `WINDOW_ACTIONS` | constante | `minimize` e `close`. |
| `open(window)` | método assíncrono | Cria ou reaproveita a visualização dentro da janela e devolve `{ ready: true, embedded: true }`. |
| `close()` | método | Desanexa e oculta a visualização, preservando seu estado em memória para a próxima abertura. |
| `dispose()` | método | Remove o handler IPC, fecha o `webContents` e impede reabertura. |
| `CHANNEL` | constante | `ram-manager:invoke`. |

## Dependências

- Usa: `electron` (`WebContentsView`, `ipcMain`), [[paths]] e o transporte `request` que o [[main]] liga ao [[managerService]].
- Usado por: [[riotOverlay]].

## Invariantes e decisões

- **Fundo configurável.** `backgroundColor` conserva o fundo escuro por padrão e aceita transparência para [[cards]]. `rendererFile` determina a URL local exata validada no IPC; usar outro renderer não amplia a lista de métodos permitidos.

- **Só a sobreposição.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), o único pai é a janela do [[riotOverlay]]. O padrão do renderer passou a ser `ACCOUNT_CARDS_FILE`, o de `topInset` passou a zero, e `onClose` e o comando `closeManager` saíram. A lista de métodos ficou com os onze que os [[cards]] usam: `init`, `events`, `operation`, `saveAccount`, `deleteAccount`, `refresh`, `runningGames`, `signIn`, `cancelSignIn`, `saveSettings` e `openExternal`.
- **Uma janela só.** O módulo cria um `WebContentsView`, nunca uma `BrowserWindow`.
- **Origem de chamada exata.** Exige o `webContents` da própria visualização, seu frame principal e a URL `file:` exata do renderer configurado. A página da Riot e iframes não ganham a API.
- **Isolamento próprio.** `sandbox`, `contextIsolation` e `webSecurity` ligados; `nodeIntegration` desligado. A partição `persist:ram-manager-panel` mantém as preferências do painel separadas da página Riot.
- **Sem navegação para fora.** Navegação de página/frame, `<webview>` e janelas novas são recusados. Um link HTTPS é enviado como ação `openExternal` ao serviço, para abrir no navegador padrão.
- **Permissões negadas.** A sessão da visualização recusa pedidos de permissões e suas verificações.
- **Comandos fechados.** Só os métodos de gerenciamento conhecidos, com array de até quatro argumentos e conteúdo limitado, atravessam o IPC. O [[managerService]] faz a validação semântica adicional.
- **Recuo esquerdo limitado.** Desde 2026-11-04, `leftInset` recebe a largura da janela e desloca a visualização para a direita; o valor fica entre zero e largura − 1, então a visualização nunca fica sem largura. O [[riotOverlay]] usa isso para deixar a coluna de login livre ([[ADR-013 Caixa para ocultar as contas na coluna de login]]).
- **Ações na janela do Riot são locais.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): `windowAction` com exatamente um texto de `WINDOW_ACTIONS` chama `onWindowAction` e não chega ao serviço de contas. Responde `{ ok: true }` só quando o handler devolve `true`; falha ou outro valor vira `{ ok: false }`, sem detalhes. Outros formatos são recusados como comando inválido. Substitui o aviso `setModal`, que saiu junto com a região própria de diálogo do [[riotOverlay]]. Desde 2026-11-06 a lista tem só `minimize` e `close`: `reveal` saiu com a cópia do perfil dos [[cards]] e passou a ser recusado como comando inválido.
- **Redimensionamento solidário.** A visualização acompanha o tamanho de conteúdo da janela pai, menos os recuos.
- **Fechamento durante a carga.** Uma geração de carga impede que uma promessa antiga reative uma visualização descartada.
- **Falha sem dados do formulário.** Erros do transporte voltam com uma mensagem fixa, sem ecoar argumentos de cadastro, senhas ou chaves.
- **Versão Rust (fase 4 da [[Migração para Tauri]]).** `src-tauri/src/integration/manager/manager_host.rs`, testes em `src-tauri/tests/integration/manager/manager_host.rs`. Um comando só, `manager`, liberado pela capacidade do Tauri só para a webview `cards`; mesmo assim, o Rust confere que quem chamou é a webview `cards` no endereço exato `http://eclipse.localhost/src/renderer/cards.html` ([[assetProtocol]]). Mesma lista de métodos, até 4 argumentos, até 32 KB e erro genérico. `windowAction` vai ao [[riotOverlay]]. Um link `https:` aberto pelos cartões vira `openExternal`; navegação para fora da página, janelas novas, downloads e permissões do navegador são negados na webview.

## Testes

Testes com Electron e transporte falsos conferem criação como filho da janela, isolamento, redimensionamento, confiança do remetente, recuo esquerdo com limites, recusa de navegação e comandos, `windowAction` só com as duas ações (`reveal` recusado), sem chegar ao serviço, com resposta `ok: false` quando o handler falha ou não existe, `setModal`, `closeManager` e os comandos removidos recusados, fechamento e descarte. Um teste com Electron real (`managerElectron.test.js`) carrega os cartões e o preload sandboxed com o renderer padrão, confere cartões fictícios, temas, configurações e idioma numa única janela; os cliques nas cópias de minimizar e fechar chegam a `onWindowAction` como `minimize` e `close`, e não há cópia do perfil. Até 2026-11-07 ele também carregava a janela antiga. Não carregam contas reais nem autenticam no Riot.

## Pontos de atenção

- Depende de `WebContentsView` na versão Electron usada pelo projeto.
- Fechar a visualização conserva preferências e estado não sensível em memória. `dispose` encerra o renderer.
- Os dados persistidos continuam no [[store]], sob responsabilidade do main em segundo plano.
