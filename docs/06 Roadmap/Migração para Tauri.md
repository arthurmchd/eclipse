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
| 3. Serviços | [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[rankWatcher]], [[rankApi]], [[startWithWindows]] | A fazer |
| 4. Sobreposição | [[riotOverlay]], [[overlayToggle]], [[overlayCover]], [[riotWindowObserver]], [[managerHost]], [[manager-preload]] e a ponte `window.api` dos [[cards]] | A fazer |
| 5. Troca | Bandeja completa, Setup do Tauri, tag no git e remoção do Electron | A fazer |

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

A camada `src/core` virou `application` no Rust, porque `core` é o nome de uma biblioteca padrão do Rust e criaria caminhos ambíguos.

## O que a fase 1 entrega

- `cargo test` em `src-tauri/`: 39 testes, mais um manual que decifra um segredo gravado pelo próprio `safeStorage` do Electron.
- `cargo run` abre um Eclipse só com a bandeja e o item Sair. Ele ainda não lê os dados, não mostra cartões e não fala com a Riot.
- Conferido em 2026-11-13: o executável de desenvolvimento tem 12,5 MB e, só com a bandeja, usa 15,5 MB de memória.

## O que a fase 2 entrega

- A camada da Riot inteira em Rust, chamada por funções síncronas: cada espera bloqueia a thread de quem chama. Na fase 3, o [[signInService]] roda o login numa thread própria.
- `cargo test` em `src-tauri/`: 215 testes, mais o manual da fase 1. Os 61 cenários do [[signInFlow]] e os testes de [[riotAuthentication]], [[riotClient]], [[riotTransport]], [[gameRanks]] e dos demais foram portados do JS; o teste de [[language]] confere que todo status e erro do login em Rust tem tradução.
- Nada da fase 2 falou com a Riot real. Os testes usam uma Riot falsa em memória; nenhum processo da Riot foi aberto, fechado ou consultado.

## Pendências entre fases

- `paths.rs` acha a raiz do projeto pela pasta do `Cargo.toml`, gravada na compilação. Isso serve para desenvolvimento; no app instalado, os helpers `.ps1` e os cartões precisam vir dos recursos do Tauri (fase 5).
- O `ManagerPorts` do [[managerService]] é síncrono. Na fase 3 ele recebe as implementações reais; `refresh_all` precisa voltar logo e fazer o trabalho em outra thread, como o JS faz com uma promessa solta.
- A CSP do `tauri.conf.json` ainda aceita imagens `https:`. Rever na fase 4, quando os cartões entrarem.
- Conferir, com permissão do usuário e só com `GET`, se o [[riotTransport]] em Rust aceita o certificado da Riot real em `127.0.0.1`. O Node aceita (conferido em 2026-11-08); o Rust usa o TLS do Windows, que confere o endereço do certificado do seu jeito.
- O `login.ps1` e o `windowGuard.ps1` são os mesmos do Electron, achados por `paths.rs`. Na fase 5 precisam ir nos recursos do Tauri.
