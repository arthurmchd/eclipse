# Eclipse (Riot Account Manager)

App Windows em Tauri e Rust (`src-tauri/`) que gerencia várias contas Riot, faz login pelo serviço local do Riot Client e mostra elos. Leia `docs/00 Início.md` no começo de qualquer tarefa que não seja trivial.

## O vault é o cérebro

`docs/` é um vault do Obsidian e a fonte do "porquê". O código não tem comentários.

- Antes de mudar um módulo, leia a nota dele em `docs/03 Módulos/<camada>/<módulo>.md` e `docs/02 Arquitetura/Segurança e privacidade.md`.
- Depois de mudar, atualize a seção **Invariantes e decisões** da nota do módulo e acrescente uma linha em `docs/06 Roadmap/Changelog.md`, no mesmo conjunto de mudanças.
- Mudança que enfraquece uma regra de segurança ou altera a arquitetura exige uma nota em `docs/04 Decisões/` (template `docs/_templates/Decisão.md`) antes do código.
- Módulo novo ganha nota a partir de `docs/_templates/Módulo.md` e um link em `docs/00 Início.md`.
- Use wikilinks `[[nome]]` pelo nome da nota, sem caminho.
- O subagente `vault-keeper` faz essa atualização quando pedido.

## Regras de código

- **Nenhum comentário** em Rust, JS, CSS, HTML, PowerShell ou no C# embutido.
- O app é só o Tauri desde 2026-11-15; o Electron saiu (tag `electron-final`, [[ADR-034 Troca do Electron pelo Tauri]]). `src/` guarda o que o Tauri serve ou roda: os cartões (`src/renderer`), a caixa e a cobertura, o `manager-preload.js` embutido e os `.ps1`.
- Caminhos do projeto só por `src-tauri/src/paths.rs` no Rust e `src/paths.js` nos scripts e testes JS.
- Testes do Rust espelham `src-tauri/src/` em `src-tauri/tests/`; os testes JS cobrem os cartões, o preload, a prévia e os `.ps1`. Comportamento novo vem com teste.
- Dependências trocáveis (traits e ganchos injetados) para tudo que toca processo, rede ou disco.
- ES modules no renderer, sem build; CommonJS nos scripts e testes JS.

## Comandos

- `cargo test` dentro de `src-tauri/` e `npm test` antes de declarar qualquer mudança pronta.
- `cargo tauri build` dentro de `src-tauri/` gera o Setup em `src-tauri/target/release/bundle/nsis/`. Em desenvolvimento, `cargo run` só abre com `ECLIPSE_DATA_DIR` apontando para uma pasta de teste.
- `npm run preview` para ver os cartões no navegador com dados fictícios (porta 5178).

## Diagnóstico

- O primeiro lugar para entender uma falha de login é o `sign-in.log` real do usuário.
- Se você roda dentro do Claude Desktop (app empacotado), `%APPDATA%\riot-account-manager\` pode mostrar uma cópia antiga redirecionada para `LocalCache`. Leia o arquivo real por `\\localhost\C$\Users\<usuário>\AppData\Roaming\riot-account-manager\sign-in.log`. Só leitura.

## Limites

- Nunca escreva na instalação do Riot (`C:\Riot Games\`) nem em `%APPDATA%\riot-account-manager\` (dados reais do usuário).
- `.client-integration/` é sobra do modo antigo, sem uso desde 2026-11-07. Não a apague nem mexa nela; só o usuário decide.
- Não rode o fluxo de login com contas reais, não abra jogos e não mexa em processos do Riot sem pedido explícito.
- Não tente contornar CAPTCHA, 2FA ou outras verificações da Riot.
- Nunca versione `.client-integration/`, contas, sessões, chaves, logs ou um `riot-client-bridge.json` antigo.
