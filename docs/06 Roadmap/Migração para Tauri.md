---
tipo: roadmap
atualizado: 2026-11-13
tags: [roadmap, tauri]
---

# Migração para Tauri

Acompanha a [[ADR-032 Migração para Tauri e Rust]]. O app Electron em `src/` continua sendo o Eclipse de verdade até a fase 5; o Tauri cresce ao lado, em `src-tauri/`.

## Fases

| Fase | Conteúdo | Situação |
|---|---|---|
| 1. Base | Projeto Tauri, `paths`, [[safeStorage]], [[store]], [[language]], [[managerService]] | Feita em 2026-11-13 |
| 2. Riot | [[asar]], [[backend]], [[riotTransport]], [[riotState]], [[riotAuthentication]], [[riotInterface]], [[riotAppControls]], [[riotProcess]], [[gameRanks]], [[riotClient]], [[signInFlow]], [[windowController]], [[windowsEnvironment]] | Feita em 2026-11-13, sem conferir na Riot real |
| 3. Serviços | [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[rankWatcher]], [[rankApi]], [[startWithWindows]] e o novo [[timers]] | Feita em 2026-11-13, sem ligar ao app nem conferir na Riot real |
| 4. Sobreposição | [[riotOverlay]], [[overlayToggle]], [[overlayCover]], [[riotWindowObserver]], [[managerHost]], [[manager-preload]], a ponte `window.api` dos [[cards]], o [[main]] que liga os serviços, mais os novos [[assetProtocol]], [[refresher]] e [[appPorts]] | Feita em 2026-11-13, sem rodar o app nem conferir na Riot real |
| 5. Troca | Bandeja completa, Setup do Tauri, tag no git e remoção do Electron, mais [[notices]], [[toasts]] e [[electronInstance]] ([[ADR-034 Troca do Electron pelo Tauri]]) | Bandeja e Setup feitos em 2026-11-13; a tag e a remoção do Electron esperam o usuário conferir o app na Riot real |

## Onde fica cada módulo

| Electron | Rust | Testes Rust |
|---|---|---|
| `src/paths.js` | `src-tauri/src/paths.rs` | indireto |
| `src/core/language.js` | `src-tauri/src/application/language.rs` | `src-tauri/tests/application/language.rs` |
| `src/core/store.js` | `src-tauri/src/application/store.rs` | `src-tauri/tests/application/store.rs` |
| `src/core/managerService.js` | `src-tauri/src/application/manager_service.rs` | `src-tauri/tests/application/manager_service.rs` |
| `safeStorage` do Electron | `src-tauri/src/platform/windows/safe_storage.rs` e `dpapi.rs` | `src-tauri/tests/platform/windows/safe_storage.rs` |
| `src/integration/asar.js`, `backend.js` | `src-tauri/src/integration/asar.rs`, `backend.rs` | `src-tauri/tests/integration/` |
| `src/riot/*.js` | `src-tauri/src/riot/*.rs`, com nomes em `snake_case` (`signInFlow.js` vira `sign_in_flow.rs`) | `src-tauri/tests/riot/` |
| `src/platform/windows/windowController.js`, `windowsEnvironment.js` | `src-tauri/src/platform/windows/window_controller.rs`, `windows_environment.rs` | `src-tauri/tests/platform/windows/` |
| `src/core/signInService.js`, `sessionKeeper.js`, `riotWakeup.js`, `rankWatcher.js`, `rankApi.js` | `src-tauri/src/application/sign_in_service.rs`, `session_keeper.rs`, `riot_wakeup.rs`, `rank_watcher.rs`, `rank_api.rs`, mais `timers.rs` | `src-tauri/tests/application/` |
| `src/platform/windows/startWithWindows.js` | `src-tauri/src/platform/windows/start_with_windows.rs` | `src-tauri/tests/platform/windows/start_with_windows.rs` |
| `src/platform/windows/riotWindowObserver.js` | `src-tauri/src/platform/windows/riot_window_observer.rs` (o `.ps1` é o mesmo) | `src-tauri/tests/platform/windows/riot_window_observer.rs` |
| `src/integration/overlay/riotOverlay.js`, `overlayToggle.js`, `overlayCover.js` | `src-tauri/src/integration/overlay/riot_overlay.rs`, `overlay_toggle.rs`, `overlay_window.rs` | `src-tauri/tests/integration/overlay/` |
| `src/integration/manager/managerHost.js`, `manager-preload.js` | `src-tauri/src/integration/manager/manager_host.rs` (o preload é o mesmo arquivo, embutido) | `src-tauri/tests/integration/manager/manager_host.rs` |
| `file://` das views | `src-tauri/src/integration/asset_protocol.rs` | `src-tauri/tests/integration/asset_protocol.rs` |
| `src/main/index.js` | `src-tauri/src/main.rs`, mais `application/refresher.rs`, `app_ports.rs` e `notices.rs` | `src-tauri/tests/application/refresher.rs`, `app_ports.rs`, `notices.rs` e `tests/paths.rs` |
| `displayBalloon` e `requestSingleInstanceLock` do Electron | `src-tauri/src/platform/windows/toasts.rs`, `electron_instance.rs` e o `tauri-plugin-single-instance` | `src-tauri/tests/platform/windows/` |
| `build` do `package.json` e `scripts/build/installer.nsh` | `bundle` do `src-tauri/tauri.conf.json` e `src-tauri/windows/hooks.nsh` | `tests/integration/asset_protocol.rs` e `tests/paths.rs` conferem os arquivos do Setup |

A camada `src/core` virou `application` no Rust, porque `core` é o nome de uma biblioteca padrão do Rust e criaria caminhos ambíguos.

## O que a fase 1 entrega

- `cargo test` em `src-tauri/`: 39 testes, mais um manual que decifra um segredo gravado pelo próprio `safeStorage` do Electron.
- `cargo run` abre um Eclipse só com a bandeja e o item Sair. Ele ainda não lê os dados, não mostra cartões e não fala com a Riot.
- Conferido em 2026-11-13: o executável de desenvolvimento tem 12,5 MB e, só com a bandeja, usa 15,5 MB de memória.

## O que a fase 2 entrega

- A camada da Riot inteira em Rust, chamada por funções síncronas: cada espera bloqueia a thread de quem chama. Na fase 3, o [[signInService]] roda o login numa thread própria.
- `cargo test` em `src-tauri/`: 215 testes, mais o manual da fase 1. Os 61 cenários do [[signInFlow]] e os testes de [[riotAuthentication]], [[riotClient]], [[riotTransport]], [[gameRanks]] e dos demais foram portados do JS; o teste de [[language]] confere que todo status e erro do login em Rust tem tradução.
- Nada da fase 2 falou com a Riot real. Os testes usam uma Riot falsa em memória; nenhum processo da Riot foi aberto, fechado ou consultado.

## O que a fase 3 entrega

- Os serviços em Rust, cada um com suas dependências trocáveis: a Riot por uma trait que o [[riotClient]] implementa, o disco pelo `ServiceStore` do [[store]], o tempo pelo [[timers]], o HTTP do [[rankApi]] pelo `RankHttp` e o registro do [[startWithWindows]] pelo `StartupRegistry`.
- O login roda numa thread própria e `start_from_manager` volta na hora, resolvendo a pendência da fase 2.
- `cargo test` em `src-tauri/`: 315 testes, mais o manual da fase 1. Os cenários dos testes JS dos seis módulos foram portados; os poucos que não existem em Rust estão explicados nas notas dos módulos. Três mutações de propósito (no [[sessionKeeper]], na redação do [[signInService]] e no regravar do [[rankWatcher]]) foram pegas pelos testes e desfeitas.
- Os serviços ainda não estão ligados ao app: `cargo run` continua só com a bandeja. Nada da fase 3 leu os dados reais, consultou a Riot, falou com a API da Riot ou da HenrikDev, nem tocou o registro do Windows.

## O que a fase 4 entrega

- O [[main]] em Rust liga tudo: [[store]], serviços, a fila de elos do [[refresher]], as portas do [[managerService]] ([[appPorts]]), a sobreposição colada na janela da Riot e a bandeja com Contas no Riot, Abrir Riot Client, Cancelar login e Sair. Uma cópia por vez.
- A sobreposição segue a [[ADR-033 Sobreposição no Tauri]]: uma janela transparente com três webviews (`cards`, `cover`, `toggle`), região de cliques por `SetWindowRgn`, tudo em pixels físicos. Os cartões, a caixa e a cobertura são os mesmos arquivos do Electron, servidos pelo `eclipse://` ([[assetProtocol]]) a partir de uma lista fechada; o `window.api` vem do mesmo `manager-preload.js`.
- Só a webview `cards` chama `manager` e só a `toggle` chama `overlay_toggle`: capacidade do Tauri mais a conferência do rótulo e do endereço no Rust.
- Em desenvolvimento, o app só abre com `ECLIPSE_DATA_DIR` apontando para uma pasta absoluta escolhida à mão; nunca abre `%APPDATA%\riot-account-manager` por acidente.
- `cargo test` em `src-tauri/`: 359 testes, mais o manual da fase 1 e um ignorado do observador. Os 383 do `npm test` continuam passando. Cinco mutações de propósito foram pegas pelos testes e desfeitas.
- O app não foi rodado. Mesmo com uma pasta de dados fictícia, ele vigia a janela da Riot real e os serviços leem e limpam o login lembrado da Riot; rodar só com permissão do usuário.

## O que a fase 5 entrega até aqui

- A bandeja do Electron inteira: "Iniciar com o Windows" com a marca de ligado (só no app compilado em modo release), a segunda cópia abrindo as contas da primeira e os balões, agora notificações do Windows que abrem as contas ao clicar.
- O Eclipse em Tauri não abre enquanto o Electron estiver aberto ([[electronInstance]]), conferido com o `lockfile` do Electron do usuário aberto pelo `npm start`.
- O Setup: `cargo tauri build` em `src-tauri/` gera `src-tauri/target/release/bundle/nsis/Eclipse_1.0.0_x64-setup.exe`, com 2,3 MB (o do Electron tem perto de 100 MB) e um `eclipse.exe` de 5,3 MB. Instala por usuário em `%LOCALAPPDATA%\Eclipse`, leva só os arquivos da lista fechada e, se achar o Eclipse em Electron instalado, o desinstala mantendo os dados e o início com o Windows ([[ADR-034 Troca do Electron pelo Tauri]]).
- `cargo test` em `src-tauri/`: 369 testes, mais o manual da fase 1 e um ignorado do observador. Os 383 do `npm test` continuam passando. Duas mutações de propósito (uma fonte fora do Setup e a trava do Electron invertida) foram pegas e desfeitas.
- Nada foi instalado nem rodado: o Setup só foi compilado. O app em Tauri ainda não abriu nesta máquina.

## Para terminar a fase 5

1. Com permissão do usuário, abrir o Eclipse em Tauri (o de desenvolvimento, com `ECLIPSE_DATA_DIR` numa pasta de teste, ou o Setup) e conferir na Riot real: a sobreposição, os cartões, a caixa, a bandeja, as notificações e o login de uma conta.
2. Com a aprovação do usuário, instalar o Setup do Tauri, que substitui o do Electron.
3. Tag no git no último commit com o Electron e remoção de `src/main`, `src/core`, do resto do JS do Electron, dos testes JS que só valem para ele, do `electron` e do `electron-builder` do `package.json` e de `scripts/build/`. Ficam `src/renderer`, os arquivos da caixa e da cobertura, os `.ps1` e as fontes.

## Pendências entre fases

- O [[startWithWindows]] em Rust grava no registro do usuário. O Setup do Tauri troca o caminho da entrada `Eclipse` do Electron pelo novo; conferir quando o usuário instalar.
- Conferir a sobreposição na Riot real, com permissão do usuário: posição, cantos, a caixa, a cobertura, o idioma e o ritmo da janela quando coberta.
- Conferir as notificações no app instalado: nome, ícone e o clique abrindo as contas ([[toasts]]).
- O Tauri está com a feature `unstable` (webviews filhas). Fixar a versão do `tauri` no `Cargo.lock` e rever a cada atualização.
- Conferir, com permissão do usuário e só com `GET`, se o [[riotTransport]] em Rust aceita o certificado da Riot real em `127.0.0.1`. O Node aceita (conferido em 2026-11-08); o Rust usa o TLS do Windows, que confere o endereço do certificado do seu jeito.
