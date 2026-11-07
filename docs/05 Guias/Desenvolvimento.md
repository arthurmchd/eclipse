---
tipo: guia
tags: [dev]
---

# Desenvolvimento

## Requisitos

- Windows 10/11 (DPAPI, PowerShell e o Riot Client são requisitos reais, inclusive para parte dos testes)
- Node.js 22 ou mais novo
- `npm ci` na primeira vez

## Comandos

| Comando | O que faz |
|---|---|
| `npm start` | Inicia o Eclipse na bandeja; os cartões aparecem sobre a Riot oficial |
| `npm test` | Roda todos os testes (`node --test "test/**/*.test.js"`) |
| `npm run preview` | Cartões no navegador com contas fictícias em <http://localhost:5178> |

Os comandos do modo antigo (`start:riot-login`, `start:private`, `preview:riot-login`, `integration:*`, `legacy:*`) saíram em 2026-11-07 ([[ADR-028 Modo antigo removido]]).

Rodar um teste só: `node --test test/riot/signInFlow.test.js`.

## Testes

- `test/` espelha `src/`.
- Não autenticam contas reais nem abrem jogos.
- Os testes do helper de janelas (`windowGuard.ps1`: compila o C# e roda um autoteste que não toca janelas do desktop) e o teste dos cartões com Electron real usam recursos reais do Windows com dados sintéticos.
- Pastas temporárias são criadas dentro da pasta do próprio teste e removidas no fim; os testes conferem isso antes de apagar.
- `test/main/mainStartup.test.js` executa `src/main/index.js` dentro de um `vm` com um `require` falso. **Se você adicionar um `require` em `src/main/index.js`, inclua o módulo no mapa `deps` desse teste.**
- `test/core/store.test.js` faz o mesmo com `src/core/store.js`.

## Convenções

- **Sem comentários no código.** O porquê vai para a nota do módulo ([[ADR-005 Código sem comentários e conhecimento no vault]]).
- **CommonJS no main e nos scripts, ES modules no renderer.** Sem build, sem TypeScript.
- **Fábricas com dependências injetáveis** (`createX({ spawn, request, ... })`) para tudo que toca processo, rede ou disco.
- **Caminhos só por `src/paths.js`** ([[paths]]).
- **Nenhuma janela própria:** os cartões são um `WebContentsView` ([[managerHost]]) dentro de uma janela transparente presa à janela da Riot ([[riotOverlay]]). A interface de desenvolvimento continua disponível no navegador com dados fictícios.
- **Nomes de arquivo em camelCase**, exceto páginas e preloads (`cards.html`, `manager-preload.js`, `toggle-preload.js`).

## Adicionar um módulo

1. Crie o arquivo na camada certa ([[Estrutura de pastas]]).
2. Crie o teste no caminho espelhado em `test/`.
3. Crie a nota em `03 Módulos/<camada>/` a partir do template [[Módulo]].
4. Ligue a nota em [[00 Início]] e nas notas que dependem dele.

## Prévia no navegador

`npm run preview` serve a raiz do projeto, redireciona `/` para `/src/renderer/cards.html` e injeta nela `scripts/dev/mock-api.js`, que cria um `window.api` falso com contas de exemplo. É só para desenvolvimento: escuta em todas as interfaces e não deve ser exposto ([[Backlog]]).
