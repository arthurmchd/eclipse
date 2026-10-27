---
tipo: decisão
status: aceita
data: 2026-10-26
tags: [adr, arquitetura]
---

# ADR-006 Estrutura de pastas por camada

## Contexto

O projeto tinha `main.js` e `preload.js` na raiz, dez módulos soltos em `src/`, `src/clientIntegration/` misturando host privado, addons e utilitários, scripts de desenvolvimento, de integração e legados juntos em `scripts/`, testes todos numa pasta plana e quatro documentos `.md` na raiz. Vários módulos calculavam a raiz do projeto com `path.resolve(__dirname, '..', '..')`.

## Decisão

- `src/` dividido por camada: `main/`, `core/`, `riot/`, `platform/windows/`, `integration/` (com `host/` e `addon/`), `renderer/`.
- `scripts/` dividido por finalidade: `dev/`, `integration/`, `legacy/`.
- `test/` espelha `src/`.
- `src/paths.js` é o único módulo que conhece o layout de pastas.
- Documentação no vault `docs/`.
- `.client-integration/` continua na raiz porque a cópia privada já preparada grava caminhos absolutos no manifesto.

Mapa completo em [[Estrutura de pastas]].

## Alternativas consideradas

- **Por funcionalidade** (`accounts/`, `signIn/`, `ranks/`). Pastas com um arquivo só, e o login cruza quase todas as camadas.
- **Monorepo com pacotes.** Excessivo para um app de um usuário, sem build.

## Consequências

- Mover arquivos agora exige mudar só `src/paths.js` e os `require` relativos.
- `npm test` roda `node --test "test/**/*.test.js"`.
- O comando legado `integration:prepare` virou `legacy:prepare-install`.
- O processo do host privado agora inicia `src/integration/host/hostEntry.js`; a cópia preparada continuou válida porque o manifesto não referencia esse caminho.

## Relacionado

- [[Arquitetura]] · [[paths]]
