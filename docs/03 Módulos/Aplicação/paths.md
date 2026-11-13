---
tipo: módulo
arquivo: src/paths.js
camada: aplicação
testes: nenhum
tags: [módulo]
---

# paths

> Fonte única dos caminhos do projeto: raiz, renderer, páginas da sobreposição e helpers do Windows.

## Responsabilidade

Calcula caminhos absolutos uma vez, a partir da posição do próprio arquivo, e exporta como constantes. Módulos, scripts e testes importam daqui em vez de montar `path.join(__dirname, …)` cada um.

**Não** cria pastas, não verifica se os arquivos existem e não conhece a pasta de dados do usuário (`userData`, que é do [[store]]).

## API pública

| Export | Tipo | Valor |
|---|---|---|
| `PROJECT_ROOT` | constante | Pasta acima de `src/` |
| `SOURCE_DIR` | constante | `src/` |
| `RENDERER_DIR` | constante | `src/renderer/` |
| `WINDOWS_HELPERS_DIR` | constante | `src/platform/windows/` |
| `APP_ICON` | constante | `src/renderer/assets/icon.png`, ícone do Eclipse em 256 px |
| `APP_TRAY_ICON` | constante | `src/renderer/assets/icon.ico`, o mesmo ícone em 16 a 256 px para a bandeja |
| `MANAGER_PRELOAD_FILE` | constante | `src/integration/manager/manager-preload.js` |
| `ACCOUNT_CARDS_FILE` | constante | `src/renderer/cards.html`, a página dos [[cards]] |
| `OVERLAY_TOGGLE_FILE` | constante | `src/integration/overlay/toggle.html` |
| `OVERLAY_TOGGLE_PRELOAD_FILE` | constante | `src/integration/overlay/toggle-preload.js` |
| `OVERLAY_COVER_FILE` | constante | `src/integration/overlay/cover.html` |
| `unpackedPath(file)` | função | Troca `app.asar` por `app.asar.unpacked` no caminho |
| `windowsHelper(name)` | função | `unpackedPath` de `WINDOWS_HELPERS_DIR/name` |

## Dependências

- Usa: `path`.
- Usado por: [[main]] (`APP_ICON`, `APP_TRAY_ICON`), [[managerHost]] (`ACCOUNT_CARDS_FILE`, `MANAGER_PRELOAD_FILE`), [[riotOverlay]] (`ACCOUNT_CARDS_FILE`), [[overlayToggle]] (`OVERLAY_TOGGLE_FILE`, `OVERLAY_TOGGLE_PRELOAD_FILE`), [[overlayCover]] (`OVERLAY_COVER_FILE`), [[riotClient]] (`windowsHelper('login.ps1')`, ver [[login.ps1]]), [[windowController]] (`windowsHelper('windowGuard.ps1')`, ver [[windowGuard.ps1]]), [[riotWindowObserver]] (`windowsHelper('riotWindowObserver.ps1')`) e a prévia em `scripts/dev/` (`PROJECT_ROOT`).

## Invariantes e decisões

- `ACCOUNT_CARDS_FILE` aponta para `src/renderer/cards.html`, a única interface desde 2026-11-07. É também o padrão do [[managerHost]].
- `OVERLAY_TOGGLE_FILE` e `OVERLAY_TOGGLE_PRELOAD_FILE` apontam para a página e o preload da caixa "Ocultar contas" ([[overlayToggle]]), em `src/integration/overlay/`.
- `OVERLAY_COVER_FILE` aponta para `src/integration/overlay/cover.html`, a cobertura da coluna de login durante o login ([[overlayCover]]).
- **Constantes do modo antigo saíram.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), `ADDON_DIR`, `PRIVATE_HOST_ENTRY`, `INTEGRATION_DATA_DIR`, `PRIVATE_HOST_DIR`, `EMBEDDED_HOST_DIR`, `MANAGER_RENDERER_FILE`, `OVERLAY_RENDERER_FILE` e `OVERLAY_PRELOAD_FILE` não existem mais. Nenhum código conhece a pasta `.client-integration/`.

Arquivo novo, criado na reorganização de pastas ([[Estrutura de pastas]]). Não há original com comentários; as regras abaixo vêm do código e do que ele substituiu.

- **A raiz depende da posição do arquivo.** `PROJECT_ROOT = path.resolve(__dirname, '..')`. Mover `paths.js` para outra pasta muda todos os caminhos.
- **Substitui caminhos espalhados.** Antes, `riotClient` e `windowController` montavam o caminho do `.ps1` com `__dirname` e o mesmo `.replace('app.asar', 'app.asar.unpacked')`. Os módulos da cópia privada, hoje removidos, também montavam `.client-integration/private-v1` cada um.
- **Helpers fora do asar.** Os scripts PowerShell são executados por um processo externo, que precisa de um arquivo real no disco. `unpackedPath` aponta para a cópia em `app.asar.unpacked`. Rodando do código-fonte, sem asar, o caminho não muda. Desde 2026-11-08 o Setup existe ([[ADR-030 Eclipse instalado por um Setup próprio]]): `build.asarUnpack` tira os `.ps1` de `src/platform/windows/` do asar, e o primeiro Setup foi conferido com os três auxiliares iguais aos do projeto em `app.asar.unpacked`.
- **`.client-integration/` sobra de um modo removido.** A pasta guardava a cópia da interface da Riot. O código não a usa mais; ela continua no `.gitignore` e não pode ser distribuída, porque contém recursos proprietários. Ver [[Integração com o Riot Client]].
- **Ícone do Eclipse.** Desde 2026-11-04, `APP_TRAY_ICON` (`.ico` com 16, 24, 32, 48, 64, 128 e 256 px) é o ícone da bandeja no [[main]], para o Windows escolher o tamanho certo em cada escala. `APP_ICON` é o mesmo desenho em PNG de 256 px e fica como última reserva. A imagem foi enviada pelo usuário (fundo branco removido, recortada e centralizada); por parecer arte de jogo da Riot, serve para uso pessoal e não deve ir para uma distribuição pública do app.
- **A view usa caminhos centralizados.** [[managerHost]] recebe o HTML local e o preload dedicado pelas constantes deste módulo.
- **Versão Rust (fase 1 da [[Migração para Tauri]]).** `src-tauri/src/paths.rs` é o único lugar de caminhos no Rust: raiz do projeto, `src/`, `src/renderer/`, `src/platform/windows/` e a pasta de dados (`%APPDATA%
iot-account-manager`, a mesma do Electron). A raiz vem da pasta do `Cargo.toml` gravada na compilação; serve para desenvolvimento e muda na fase 5, quando o app instalado passar a ler os recursos do Tauri.
- **Pasta de dados em desenvolvimento (fase 4 da [[Migração para Tauri]]).** `data_dir()` devolve a pasta real só no app compilado em modo release. Em desenvolvimento, devolve a pasta de `ECLIPSE_DATA_DIR`, e só se for absoluta; sem ela, o Eclipse não abre. Assim, um `cargo run` nunca abre os dados reais por acidente ([[ADR-033 Sobreposição no Tauri]]). `observer_script()` acha o `riotWindowObserver.ps1`; testes em `src-tauri/tests/paths.rs`.
- **Raiz do app instalado (fase 5 da [[Migração para Tauri]]).** `project_root()` é a pasta do projeto em desenvolvimento e a pasta do executável no app compilado em modo release (`root_from`). O Setup do Tauri põe os cartões, as fontes e os `.ps1` ao lado do executável nos mesmos caminhos relativos do projeto, então o resto do código não muda ([[ADR-034 Troca do Electron pelo Tauri]]). `tests/paths.rs` confere os dois modos e que o Setup leva os três `.ps1`, e só eles.
## Testes

Sem teste próprio. Testes de outros módulos importam constantes daqui (`PROJECT_ROOT`, `SOURCE_DIR`, `RENDERER_DIR`, as páginas e `windowsHelper`). `mainStartup.test.js` lê o `index.js` por `SOURCE_DIR` e troca este módulo por um objeto falso com `APP_ICON` e `APP_TRAY_ICON`.

## Pontos de atenção

- No Eclipse instalado, `PROJECT_ROOT` fica dentro de `app.asar`, somente leitura. Nenhum módulo grava nele; os dados vão para a pasta do [[store]].
- `unpackedPath` troca só a primeira ocorrência e não checa se o caminho já está em `app.asar.unpacked`.
- `WINDOWS_HELPERS_DIR` é exportado, mas hoje só é usado dentro do próprio arquivo.
- Ver [[Desenvolvimento]] e [[Backlog]].
