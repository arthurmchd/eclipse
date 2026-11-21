---
tipo: guia
tags: [dev]
---

# Desenvolvimento

## Requisitos

- Windows 10/11 (DPAPI, UI Automation e o Riot Client são requisitos reais, inclusive para parte dos testes)
- Rust pelo `rustup` (`winget install Rustlang.Rustup`), as Build Tools do Visual Studio com C++ e o WebView2, que já vem no Windows 11. `cargo install tauri-cli --version "^2" --locked` dá o `cargo tauri`.
- Node.js 22 ou mais novo, para as fontes que o Setup leva, a prévia no navegador e os testes JS. `npm ci` na primeira vez.

## Comandos

| Comando | O que faz |
|---|---|
| `cargo run` (em `src-tauri/`) | Abre o Eclipse em desenvolvimento. Só abre com `ECLIPSE_DATA_DIR` apontando para uma pasta absoluta escolhida à mão ([[paths]]) |
| `cargo test` (em `src-tauri/`) | Roda os testes Rust |
| `cargo tauri build` (em `src-tauri/`) | Gera o Setup em `src-tauri/target/release/bundle/nsis/` ([[ADR-034 Troca do Electron pelo Tauri]]) |
| `npm test` | Roda os testes JS (`node --test "test/**/*.test.js"`) |
| `npm run preview` | Cartões no navegador com contas fictícias em <http://localhost:5178> |
| `cargo run --example riot_check` (em `src-tauri/`) | Checagem da Riot real antes de publicar, sem login: versão, observador, formulário e campos ([[Publicar no GitHub]]). Só com autorização do usuário |

O Eclipse em Electron saiu na versão 2.0.0, em 2026-11-15; o código está na tag `electron-final`. Os comandos do modo antigo saíram em 2026-11-07 ([[ADR-028 Modo antigo removido]]).

Com um `cargo run` aberto, o `target/debug/eclipse.exe` fica travado: rode o `cargo test` com outro `CARGO_TARGET_DIR`.

Rodar só uma parte: `cargo test --test riot sign_in_flow` (uma camada e um filtro de nome) ou `node --test test/renderer/ranks.test.js`.

## Testes

- `src-tauri/tests/` espelha `src-tauri/src/`: cada camada é um arquivo (`tests/application.rs`, `tests/riot.rs` e assim por diante) que inclui os testes da pasta dela por `#[path]`.
- `test/` tem o que continua em JavaScript: os cartões (`test/renderer/`), o [[manager-preload]], a prévia e o `package.json`.
- Não autenticam contas reais nem abrem jogos.
- O autoteste do [[riotWindowObserver]] e o do `NativeObserver` só tocam janelas próprias, criadas fora da tela. As regras do [[loginForm]] e do [[windowGuard]] são testadas como funções puras, sem janela.
- Pastas temporárias são criadas dentro da pasta do próprio teste e removidas no fim; os testes conferem isso antes de apagar.
- O GitHub roda `cargo clippy -- -D warnings`, `cargo test` e `npm test` no Windows a cada envio e pull request (`.github/workflows/tests.yml`). O clippy só olha o código do app, não os testes.
- O único teste que fala com a Riot real é marcado com `#[ignore]` e só roda a pedido, com a Riot aberta pelo usuário ([[riotTransport]]).
- `test/package.test.js` trava o `package.json`: sem Electron, só as fontes como dependências, a versão igual à do Tauri e do Cargo, e o nome `riot-account-manager`.

## Gerar o instalador

`cargo tauri build` (em `src-tauri/`) compila em modo release e gera `Eclipse_<versão>_x64-setup.exe`, o instalador de um clique, por usuário e sem administrador. O Setup leva o `eclipse.exe` e, por uma lista fechada em `bundle.resources` do `tauri.conf.json`, as páginas e as fontes nos mesmos caminhos relativos do projeto ([[paths]]). `src-tauri/tests/paths.rs` confere que nenhum script vai junto.

Desde a 2.19.0 o build também assina o Setup para a atualização automática ([[ADR-045 Atualização pelo GitHub]]) e precisa da variável `TAURI_SIGNING_PRIVATE_KEY` com o caminho da chave. Num PC sem a chave, para só testar o Setup, gere uma de teste com `cargo tauri signer generate --ci -w <pasta fora do projeto>` e aponte a variável para ela; um Setup assim não serve para publicar.

O instalador e o desinstalador têm passos próprios em `src-tauri/windows/hooks.nsh`: desinstalar o Eclipse em Electron, se houver, mantendo as contas, trocar o caminho do início com o Windows e apagá-lo na desinstalação, menos numa atualização ([[startWithWindows]]).

Para lançar uma versão nova, suba a versão no `tauri.conf.json`, no `Cargo.toml` e no `package.json` (o `test/package.test.js` confere que são iguais); o Setup novo instala por cima e mantém os dados.

Depois de gerar, não abra o app para conferir: o Eclipse instalado mexe na Riot real e na pasta de dados real.

## Convenções

- **Sem comentários no código.** O porquê vai para a nota do módulo ([[ADR-005 Código sem comentários e conhecimento no vault]]).
- **Rust no app; JavaScript só nas páginas.** Os cartões e a caixa usam ES modules sem build e sem TypeScript; o [[manager-preload]] é embutido no executável.
- **Dependências por trait** para tudo que toca processo, rede, disco, registro ou tempo, para os testes trocarem por dublês.
- **Caminhos só por `src-tauri/src/paths.rs`** ([[paths]]). Os scripts e testes JS usam `src/paths.js`.
- **Nenhuma janela própria:** os cartões são uma webview ([[managerHost]]) dentro de uma janela transparente presa à janela da Riot ([[riotOverlay]]). A interface de desenvolvimento continua disponível no navegador com dados fictícios.
- **Nomes de arquivo:** `snake_case` no Rust; camelCase no JavaScript, exceto páginas e preloads (`cards.html`, `manager-preload.js`).

## Adicionar um módulo

1. Crie o arquivo na camada certa ([[Estrutura de pastas]]).
2. Crie o teste no caminho espelhado em `src-tauri/tests/` e inclua-o no arquivo da camada.
3. Crie a nota em `03 Módulos/<camada>/` a partir do template [[Módulo]].
4. Ligue a nota em [[00 Início]] e nas notas que dependem dele.

## Prévia no navegador

`npm run preview` redireciona `/` para `/src/renderer/cards.html` e injeta nela `scripts/dev/mock-api.js`, que cria um `window.api` falso com contas de exemplo. É só para desenvolvimento.

Desde 2026-11-07 o servidor escuta só em `127.0.0.1` e serve só `src/renderer/`, `node_modules/@fontsource/` e `scripts/dev/mock-api.js`. O resto do projeto (`.git`, `package.json`, `.client-integration/`, `src-tauri/`) recebe 403, inclusive por `%2F` e `%2e%2e` codificados e por pastas vizinhas com o mesmo começo de nome. Até então a checagem era `startsWith` na raiz, que deixava passar uma pasta vizinha como `riot-account-manager-x`. Um endereço malformado recebe 400 em vez de derrubar o servidor. O teste fica em `test/scripts/dev/preview-server.test.js`; `scripts/` não espelha `src/`, então o teste segue o caminho do script.
