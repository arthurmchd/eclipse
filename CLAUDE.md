# Riot Account Manager

App Electron para Windows que gerencia várias contas Riot, faz login pelo serviço local do Riot Client e mostra elos. Leia `docs/00 Início.md` no começo de qualquer tarefa que não seja trivial.

## O vault é o cérebro

`docs/` é um vault do Obsidian e a fonte do "porquê". O código não tem comentários.

- Antes de mudar um módulo, leia a nota dele em `docs/03 Módulos/<camada>/<módulo>.md` e `docs/02 Arquitetura/Segurança e privacidade.md`.
- Depois de mudar, atualize a seção **Invariantes e decisões** da nota do módulo e acrescente uma linha em `docs/06 Roadmap/Changelog.md`, no mesmo conjunto de mudanças.
- Mudança que enfraquece uma regra de segurança ou altera a arquitetura exige uma nota em `docs/04 Decisões/` (template `docs/_templates/Decisão.md`) antes do código.
- Módulo novo ganha nota a partir de `docs/_templates/Módulo.md` e um link em `docs/00 Início.md`.
- Use wikilinks `[[nome]]` pelo nome da nota, sem caminho.
- O subagente `vault-keeper` faz essa atualização quando pedido.

## Regras de código

- **Nenhum comentário** em JS, CSS, HTML, PowerShell ou no C# embutido. Exceção: os blocos `/* ${...MARKER} */` dentro de template strings em `src/integration/host/` são marcadores injetados no código do Riot e conferidos em runtime; não remova.
- Caminhos do projeto só por `src/paths.js`. Nada de `path.resolve(__dirname, '..', '..')`.
- Testes espelham `src/` em `test/`. Comportamento novo vem com teste.
- Ao adicionar um `require` em `src/main/index.js`, inclua o módulo no mapa `deps` de `test/main/mainStartup.test.js`.
- Fábricas com dependências injetáveis (`createX({ spawn, request })`) para tudo que toca processo, rede ou disco.
- CommonJS no main e scripts; ES modules no renderer; sem build.

## Comandos

- `npm test` antes de declarar qualquer mudança pronta.
- `npm run preview` para ver a interface no navegador com dados fictícios (porta 5178).

## Limites

- Nunca escreva na instalação do Riot (`C:\Riot Games\`) nem em `%APPDATA%\riot-account-manager\` (dados reais do usuário).
- Não mova `.client-integration/`: a cópia privada preparada guarda caminhos absolutos no manifesto.
- Não rode o fluxo de login com contas reais, não abra jogos e não mexa em processos do Riot sem pedido explícito.
- Não tente contornar CAPTCHA, 2FA ou outras verificações da Riot.
- Nunca versione `.client-integration/`, contas, sessões, chaves, logs ou `riot-client-bridge.json`.
