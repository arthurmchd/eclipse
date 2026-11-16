---
tipo: conceito
tags: [arquitetura, pastas]
---

# Estrutura de pastas

> [!note] Só Tauri desde 2026-11-15
> O Eclipse em Electron saiu do projeto na versão 2.0.0 ([[ADR-034 Troca do Electron pelo Tauri]], tag `electron-final`). Onde esta nota fala de `npm start`, `npm run dist`, `.bat`, `src/main`, `src/core` ou `src/riot`, é histórico.

```
riot-account-manager/
├── Abrir Riot com minhas contas.bat    instala na primeira vez e inicia o Eclipse
├── Iniciar gerenciador de contas.bat   inicia o Eclipse (exige npm install)
├── CLAUDE.md                           instruções para agentes de IA
├── README.md
├── package.json                        main = src/main/index.js; build = configuração do Setup
├── docs/                               este vault do Obsidian
├── src/
│   ├── paths.js                        único lugar que conhece o layout
│   ├── main/                           serviço Electron na bandeja
│   │   └── index.js
│   ├── core/                           regras da aplicação
│   │   ├── store.js
│   │   ├── signInService.js
│   │   ├── managerService.js
│   │   ├── sessionKeeper.js
│   │   ├── riotWakeup.js
│   │   ├── rankWatcher.js              elo lido do jogo aberto
│   │   ├── language.js
│   │   └── rankApi.js
│   ├── riot/                           controle do Riot Client
│   │   ├── riotClient.js
│   │   ├── riotState.js
│   │   ├── gameRanks.js                elo pelo cliente do LoL e pelo chat
│   │   ├── signInFlow.js
│   │   ├── riotAuthentication.js
│   │   ├── riotInterface.js
│   │   ├── riotAppControls.js
│   │   ├── riotTransport.js
│   │   └── riotProcess.js
│   ├── platform/windows/               específico do Windows
│   │   ├── windowController.js
│   │   ├── windowGuard.ps1
│   │   ├── riotWindowObserver.js
│   │   ├── riotWindowObserver.ps1
│   │   ├── login.ps1
│   │   ├── windowsEnvironment.js
│   │   └── startWithWindows.js         opção "Iniciar com o Windows"
│   ├── integration/                    o que fica preso à janela oficial da Riot
│   │   ├── asar.js                     leitura do app.asar oficial (só leitura)
│   │   ├── backend.js                  lockfile e certificado da API local
│   │   ├── manager/                    hospeda os cartões
│   │   │   ├── managerHost.js
│   │   │   └── manager-preload.js
│   │   └── overlay/                    janelas sobre a Riot
│   │       ├── riotOverlay.js
│   │       ├── overlayToggle.js        caixa "Ocultar contas"
│   │       ├── toggle.html / .css / .js, toggle-preload.js, toggle-check.svg
│   │       ├── overlayCover.js         cobertura da coluna de login
│   │       └── cover.html / .css
│   └── renderer/                       os cartões
│       ├── cards.html
│       ├── cards.css
│       ├── cards.js
│       ├── cardsText.js
│       ├── ranks.js
│       └── assets/
├── scripts/
│   ├── dev/                            prévia dos cartões no navegador
│   └── build/installer.nsh             passo extra do desinstalador
├── test/                               espelha src/; package.test.js confere o build
├── dist/                               fora do git: o Setup gerado por npm run dist
└── backups/                            fora do git: cópias do data.json
```

## Regras

- **Testes espelham `src/`.** O teste de `src/riot/signInFlow.js` mora em `test/riot/signInFlow.test.js`. Um script de `scripts/` segue o próprio caminho: `test/scripts/dev/preview-server.test.js`.
- **Caminhos só em `src/paths.js`.** Nenhum módulo calcula a raiz com `__dirname, '..', '..'`. Mover uma pasta exige mudar um arquivo.
- **Nada de escrever na instalação da Riot.** `asar.js` e `backend.js` só leem o `app.asar` e o lockfile oficiais ([[ADR-028 Modo antigo removido]]).
- **Atalhos `.bat` ficam na raiz** porque são o ponto de entrada do usuário rodando do projeto. Desde 2026-11-08 o uso diário pode ser pelo Eclipse instalado ([[ADR-030 Eclipse instalado por um Setup próprio]]).
- **Só `src/` e `package.json` entram no Setup.** O resto da raiz (docs, testes, scripts, `backups/`, `.client-integration/`) fica fora do pacote pela lista `build.files`.
- **`.client-integration/` é sobra do modo antigo.** Se existir na raiz, está fora do git e o código não a usa desde 2026-11-07. O usuário pode apagá-la; ela tem recursos proprietários da Riot e nunca pode ser distribuída.

## Mapa da reorganização (2026-10-26)

| Antes | Depois |
|---|---|
| `main.js` | `src/main/index.js` |
| `preload.js` | `src/main/preload.js` |
| `renderer/` | `src/renderer/` |
| `src/store.js` | `src/core/store.js` |
| `src/signInService.js` | `src/core/signInService.js` |
| `src/riotApi.js` | `src/core/rankApi.js` |
| `src/riotClient.js`, `riotProcess.js`, `riotTransport.js`, `riotAuthentication.js`, `signInFlow.js` | `src/riot/` |
| `src/windowController.js`, `windowsEnvironment.js`, `login.ps1`, `windowGuard.ps1` | `src/platform/windows/` |
| `src/clientIntegration/windowsDpapi.js` | `src/platform/windows/windowsDpapi.js` |
| `src/clientIntegration/{asar,backend,bootstrapChannel,bridgeServer,status,privateClient}.js` | `src/integration/` |
| `src/clientIntegration/{privateHost,privateHostCore,privateRendererCore}.js` | `src/integration/host/` |
| `scripts/run-private-riot-host.js` | `src/integration/host/hostEntry.js` |
| `src/clientIntegration/addon-*.js`, `preview.html` | `src/integration/addon/` |
| `scripts/preview-server.js`, `mock-api.js`, `preview-riot-integration.js` | `scripts/dev/` |
| `scripts/prepare-private-riot-host.js`, `probe-private-riot-host.js` | `scripts/integration/` |
| `scripts/prepare-riot-integration.js`, `install-riot-integration.ps1` | `scripts/legacy/` |
| `ANALISE.md` | [[Backlog]] |
| `INTEGRACAO-RIOT.md` | [[Integração com o Riot Client]] |
| `COMPARACAO-ROSE.md` | [[Estudo - Comparação com o Rose]] |
| `GUIA-GITHUB.md` | [[Publicar no GitHub]] |

Ver [[ADR-006 Estrutura de pastas por camada]]. Na migração posterior para a janela única, `src/main/preload.js` e o atalho da janela independente saíram, e o preload dedicado passou a `src/integration/manager/manager-preload.js` ([[ADR-007 Interface completa dentro do Riot Client]]).

Em 2026-11-07 saíram de vez `src/integration/host/`, `src/integration/addon/`, `privateClient.js`, `bridgeServer.js`, `bootstrapChannel.js`, `status.js`, o seletor antigo `overlay.html` / `.css` / `.js` e `overlay-preload.js`, `src/platform/windows/windowsDpapi.js`, a janela antiga em `src/renderer/` (`index.html`, `app.js`, `styles.css`), `scripts/dev/preview-riot-integration.js`, `scripts/integration/`, `scripts/legacy/` e os comandos `start:riot-login`, `start:private`, `preview:riot-login`, `integration:*` e `legacy:*`. O código está na tag `modo-antigo-final` ([[ADR-028 Modo antigo removido]]).
