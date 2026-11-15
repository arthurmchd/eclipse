---
tipo: módulo
arquivo: [src-tauri/src/paths.rs, src/paths.js]
camada: aplicação
testes: src-tauri/tests/paths.rs
tags: [módulo]
---

# paths

> Fonte única dos caminhos do projeto: raiz, cartões, helpers do Windows e pasta de dados.

## Responsabilidade

`src-tauri/src/paths.rs` é o único lugar de caminhos no Rust: raiz do projeto, `src/`, `src/renderer/`, `src/platform/windows/`, o helper do [[riotWindowObserver]] e a pasta de dados. Os scripts e testes JS usam `src/paths.js`, que só tem a raiz, `src/`, `src/renderer/`, `src/platform/windows/` e `windowsHelper(nome)`.

**Não** cria pastas e não verifica se os arquivos existem.

## API pública

| Item | Tipo | Valor |
|---|---|---|
| `project_root()` | função | Pasta do projeto em desenvolvimento; pasta do executável no app instalado (`root_from`) |
| `source_dir()`, `renderer_dir()`, `windows_helpers_dir()` | funções | `src/`, `src/renderer/` e `src/platform/windows/` sob a raiz |
| `observer_script()` | função | O `riotWindowObserver.ps1` |
| `user_data_dir()` | função | `%APPDATA%\riot-account-manager` (`DATA_FOLDER_NAME`) |
| `data_dir()` | função | A pasta de dados que o app usa: a real no app instalado; em desenvolvimento, a de `ECLIPSE_DATA_DIR` (`DATA_DIR_VARIABLE`), ou nenhuma (`data_dir_from`) |

Em `src/paths.js`: `PROJECT_ROOT`, `SOURCE_DIR`, `RENDERER_DIR`, `WINDOWS_HELPERS_DIR` e `windowsHelper(nome)`.

## Dependências

- Usa: `std::path` e `std::env`.
- Usado por: [[main]], [[assetProtocol]], [[managerHost]], [[riotClient]] ([[login.ps1]]), [[windowController]] ([[windowGuard.ps1]]), [[riotWindowObserver]] e os testes. O `paths.js` é usado pela prévia em `scripts/dev/` e pelos testes JS.

## Invariantes e decisões

- **A raiz depende do modo.** Em desenvolvimento, a raiz é a pasta acima do `Cargo.toml`, gravada na compilação. No app compilado em modo release, é a pasta do executável: o Setup põe os cartões, as fontes e os `.ps1` ao lado dele nos mesmos caminhos relativos do projeto, então o resto do código não muda ([[ADR-034 Troca do Electron pelo Tauri]]).
- **Helpers como arquivos reais.** Os scripts PowerShell são executados por um processo externo, que precisa de um arquivo no disco. O Setup os leva por uma lista fechada no `tauri.conf.json`, e `tests/paths.rs` confere que os três vão e nenhum outro.
- **Páginas por lista fechada.** As páginas dos [[cards]], da caixa ([[overlayToggle]]) e da cobertura ([[overlayCover]]) são servidas pelo [[assetProtocol]] a partir de `renderer_dir()` e `source_dir()`, só os arquivos da lista dele.
- **Mesma pasta de dados do Electron.** `%APPDATA%\riot-account-manager`, para o Eclipse 2.0.0 abrir as contas que o Electron gravou.
- **Pasta de dados em desenvolvimento.** `data_dir()` devolve a pasta real só no app compilado em modo release. Em desenvolvimento, devolve a pasta de `ECLIPSE_DATA_DIR`, e só se for absoluta; sem ela, o Eclipse não abre. Assim, um `cargo run` nunca abre os dados reais por acidente ([[ADR-033 Sobreposição no Tauri]]).
- **`.client-integration/` sobra de um modo removido.** A pasta guardava a cópia da interface da Riot ([[ADR-028 Modo antigo removido]]). O código não a usa; ela continua no `.gitignore` e não pode ser distribuída, porque contém recursos proprietários. Ver [[Integração com o Riot Client]].
- **Ícone do Eclipse.** `src/renderer/assets/icon.ico` (16 a 256 px) e `icon.png` (256 px) são o ícone do executável, do Setup e da bandeja, pelo `tauri.conf.json`. A imagem foi enviada pelo usuário (fundo branco removido, recortada e centralizada); por parecer arte de jogo da Riot, serve para uso pessoal e não deve ir para uma distribuição pública do app.

## Testes

`src-tauri/tests/paths.rs` confere que o app de desenvolvimento só abre com uma pasta escolhida à mão e o instalado sempre usa a real, a raiz nos dois modos, que o helper do observador fica junto dos outros helpers e que o Setup leva os três `.ps1` nos mesmos caminhos, e nenhum outro script.

## Pontos de atenção

- No app instalado, a raiz é `%LOCALAPPDATA%\Eclipse`, que o desinstalador apaga. Nenhum módulo grava nela; os dados vão para a pasta do [[store]].
- O `paths.js` calcula a raiz pela posição do próprio arquivo; mover o arquivo muda todos os caminhos dos scripts e testes JS.
- Ver [[Desenvolvimento]] e [[Backlog]].
