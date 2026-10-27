---
tipo: conceito
tags: [arquitetura, pastas]
---

# Estrutura de pastas

```
riot-account-manager/
├── Abrir Riot Account Manager.bat      atalho do gerenciador
├── Abrir Riot com minhas contas.bat    atalho do login integrado
├── CLAUDE.md                           instruções para agentes de IA
├── README.md
├── package.json                        main = src/main/index.js
├── docs/                               este vault do Obsidian
├── src/
│   ├── paths.js                        único lugar que conhece o layout
│   ├── main/                           processo principal Electron
│   │   ├── index.js
│   │   └── preload.js
│   ├── core/                           regras da aplicação
│   │   ├── store.js
│   │   ├── signInService.js
│   │   └── rankApi.js
│   ├── riot/                           controle do Riot Client
│   │   ├── riotClient.js
│   │   ├── signInFlow.js
│   │   ├── riotAuthentication.js
│   │   ├── riotInterface.js
│   │   ├── riotTransport.js
│   │   └── riotProcess.js
│   ├── platform/windows/               específico do Windows
│   │   ├── windowController.js
│   │   ├── windowGuard.ps1
│   │   ├── login.ps1
│   │   ├── windowsDpapi.js
│   │   └── windowsEnvironment.js
│   ├── integration/                    cópia privada da interface do Riot
│   │   ├── privateClient.js
│   │   ├── bridgeServer.js
│   │   ├── bootstrapChannel.js
│   │   ├── backend.js
│   │   ├── asar.js
│   │   ├── status.js
│   │   ├── host/                       processo do host privado
│   │   │   ├── hostEntry.js
│   │   │   ├── privateHost.js
│   │   │   ├── privateHostCore.js
│   │   │   └── privateRendererCore.js
│   │   └── addon/                      código anexado ao app.asar do Riot
│   │       ├── addon-main.js
│   │       ├── addon-preload.js
│   │       ├── addon-renderer.js
│   │       └── preview.html
│   └── renderer/                       interface do gerenciador
│       ├── index.html
│       ├── app.js
│       ├── ranks.js
│       ├── styles.css
│       └── assets/
├── scripts/
│   ├── dev/                            prévia no navegador e demo do painel
│   ├── integration/                    preparar e testar a cópia privada
│   └── legacy/                         experimento antigo de instalar no Riot
├── test/                               espelha src/
└── .client-integration/                fora do git: cópia do Riot, perfis, logs
```

## Regras

- **Testes espelham `src/`.** O teste de `src/riot/signInFlow.js` mora em `test/riot/signInFlow.test.js`.
- **Caminhos só em `src/paths.js`.** Nenhum módulo calcula a raiz com `__dirname, '..', '..'`. Mover uma pasta exige mudar um arquivo.
- **`.client-integration/` fica na raiz.** O manifesto da cópia privada guarda caminhos absolutos e o host só aceita arquivos dentro do projeto ([[privateHostCore]]). Mover essa pasta invalida a cópia preparada.
- **Nomes dos arquivos do host não mudam à toa.** O diagnóstico de inicialização filtra rastros de pilha por `privateHost.js` e `privateHostCore.js` ([[privateClient]], [[hostEntry]]).
- **Atalhos `.bat` ficam na raiz** porque são o ponto de entrada do usuário.

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

O comando `npm run integration:prepare` (experimento legado) virou `npm run legacy:prepare-install`. Os demais comandos mantiveram o nome. Ver [[ADR-006 Estrutura de pastas por camada]].
