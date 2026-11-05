---
tipo: módulo
arquivo: src/paths.js
camada: aplicação
testes: nenhum
tags: [módulo]
---

# paths

> Fonte única dos caminhos do projeto: raiz, renderer, addons, helpers do Windows, entrada do host privado e pasta `.client-integration/`.

## Responsabilidade

Calcula caminhos absolutos uma vez, a partir da posição do próprio arquivo, e exporta como constantes. Módulos, scripts e testes importam daqui em vez de montar `path.join(__dirname, …)` cada um.

**Não** cria pastas, não verifica se os arquivos existem e não conhece a pasta de dados do usuário (`userData`, que é do [[store]]).

## API pública

| Export | Tipo | Valor |
|---|---|---|
| `PROJECT_ROOT` | constante | Pasta acima de `src/` |
| `SOURCE_DIR` | constante | `src/` |
| `RENDERER_DIR` | constante | `src/renderer/` |
| `ADDON_DIR` | constante | `src/integration/addon/` |
| `WINDOWS_HELPERS_DIR` | constante | `src/platform/windows/` |
| `PRIVATE_HOST_ENTRY` | constante | `src/integration/host/hostEntry.js` |
| `INTEGRATION_DATA_DIR` | constante | `.client-integration/` na raiz do projeto |
| `PRIVATE_HOST_DIR` | constante | `.client-integration/private-v1/` |
| `EMBEDDED_HOST_DIR` | constante | `.client-integration/private-v1/embedded-v1/`, cópia com o gerenciamento completo |
| `APP_ICON` | constante | `src/renderer/assets/icon.png`, ícone do Eclipse em 256 px |
| `APP_TRAY_ICON` | constante | `src/renderer/assets/icon.ico`, o mesmo ícone em 16 a 256 px para a bandeja |
| `MANAGER_RENDERER_FILE` | constante | `src/renderer/index.html`, carregado pela visualização dentro do Riot |
| `MANAGER_PRELOAD_FILE` | constante | `src/integration/manager/manager-preload.js` |
| `unpackedPath(file)` | função | Troca `app.asar` por `app.asar.unpacked` no caminho |
| `windowsHelper(name)` | função | `unpackedPath` de `WINDOWS_HELPERS_DIR/name` |

## Dependências

- Usa: `path`.
- Usado por: [[main]] (`RENDERER_DIR`, `APP_ICON`), [[riotClient]] (`windowsHelper('login.ps1')`, ver [[login.ps1]]), [[windowController]] (`windowsHelper('windowGuard.ps1')`, ver [[windowGuard.ps1]]), [[privateClient]] (`PROJECT_ROOT`, `PRIVATE_HOST_ENTRY`), [[privateHostCore]] (`PROJECT_ROOT`), [[hostEntry]] (`PRIVATE_HOST_DIR`), [[Scripts de integração]] (`PROJECT_ROOT`, `ADDON_DIR`, `PRIVATE_HOST_DIR`, `INTEGRATION_DATA_DIR`) e scripts de preview em `scripts/dev/`.

## Invariantes e decisões

- `ACCOUNT_CARDS_FILE` aponta para `src/renderer/cards.html`, a interface compacta do modo sobreposto.
- `OVERLAY_TOGGLE_FILE` e `OVERLAY_TOGGLE_PRELOAD_FILE` apontam para a página e o preload da caixa "Ocultar contas" ([[overlayToggle]]), em `src/integration/overlay/`.

- `OVERLAY_RENDERER_FILE` e `OVERLAY_PRELOAD_FILE` centralizam os arquivos locais do botão de [[riotOverlay]]. O observador usa `windowsHelper('riotWindowObserver.ps1')`.

- **Atualização sem mover a cópia anterior.** O preparador usa `EMBEDDED_HOST_DIR`. O controlador procura primeiro essa pasta e só aceita uma cópia anterior se também declarar o gerenciamento completo; perfis e logs seguem a pasta escolhida.

Arquivo novo, criado na reorganização de pastas ([[Estrutura de pastas]]). Não há original com comentários; as regras abaixo vêm do código e do que ele substituiu.

- **A raiz depende da posição do arquivo.** `PROJECT_ROOT = path.resolve(__dirname, '..')`. Mover `paths.js` para outra pasta muda todos os caminhos.
- **Substitui caminhos espalhados.** Antes, `riotClient` e `windowController` montavam o caminho do `.ps1` com `__dirname` e o mesmo `.replace('app.asar', 'app.asar.unpacked')`. `privateClient`, o antigo `run-private-riot-host.js` e os scripts de preparo montavam `.client-integration/private-v1` cada um.
- **Helpers fora do asar.** Os scripts PowerShell são executados por um processo externo, que precisa de um arquivo real no disco. `unpackedPath` aponta para a cópia em `app.asar.unpacked`. Rodando do código-fonte, sem asar, o caminho não muda.
- **`.client-integration/` fica no projeto, não em `userData`.** Guarda cópias locais da interface da Riot, perfis, registros e resultados de testes. Está no `.gitignore` e não pode ser distribuída, porque contém recursos proprietários da instalação local. Ver [[Integração com o Riot Client]].
- **Ícone do Eclipse.** Desde 2026-11-04, `APP_TRAY_ICON` (`.ico` com 16, 24, 32, 48, 64, 128 e 256 px) é o ícone da bandeja no [[main]], para o Windows escolher o tamanho certo em cada escala. `APP_ICON` é o mesmo desenho em PNG de 256 px e fica como última reserva. A imagem foi enviada pelo usuário (fundo branco removido, recortada e centralizada); por parecer arte de jogo da Riot, serve para uso pessoal e não deve ir para uma distribuição pública do app.
- **A visualização integrada usa caminhos centralizados.** [[managerHost]] recebe o HTML local e o preload dedicado pelas constantes deste módulo; a nova estrutura está em [[ADR-007 Interface completa dentro do Riot Client]].

## Testes

Sem teste próprio. Testes de outros módulos importam constantes daqui: `clientAddon.test.js` (`ADDON_DIR`), `clientArchive.test.js` (`PROJECT_ROOT`) e `privateClient.test.js` (`PRIVATE_HOST_ENTRY`). `mainStartup.test.js` substitui o módulo por um objeto falso com `RENDERER_DIR` e `APP_ICON`.

## Pontos de atenção

- Num pacote asar, `PROJECT_ROOT` fica dentro de `app.asar`. `INTEGRATION_DATA_DIR` e `PRIVATE_HOST_DIR` apontariam para dentro de um arquivo somente leitura. Hoje o `package.json` não tem configuração de empacotamento e o app roda do código-fonte.
- `unpackedPath` troca só a primeira ocorrência e não checa se o caminho já está em `app.asar.unpacked`.
- `SOURCE_DIR` e `WINDOWS_HELPERS_DIR` são exportados, mas hoje só são usados dentro do próprio arquivo.
- Ver [[Desenvolvimento]] e [[Backlog]].
