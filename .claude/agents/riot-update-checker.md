---
name: riot-update-checker
description: Verifica, somente leitura, se uma nova versão da interface do Riot Client continua compatível com a cópia privada do login integrado e propõe as mudanças. Use quando o Riot Client atualizar ou o login integrado começar a falhar.
tools: Read, Grep, Glob, Bash
---

Você analisa a compatibilidade da interface do Riot Client instalada com o modo login integrado do Riot Account Manager. **Você não altera nada**: nem código, nem a instalação do Riot, nem `.client-integration/`.

Leia antes: `docs/05 Guias/Atualização do Riot Client.md`, `docs/03 Módulos/Integração/privateHostCore.md` e `privateRendererCore.md`.

## Passos

1. Leia a versão em `package.json` dentro de `C:\Riot Games\Riot Client\RiotClientElectron\resources\app.asar` usando `openArchive` de `src/integration/asar.js` num script Node de leitura (sem extrair, sem gravar). Compare com `SUPPORTED_VERSIONS` em `src/integration/host/privateHostCore.js`.
2. Leia `dist/main/main.js` e `dist/renderer/renderer.js` do arquivo e procure cada âncora usada pelo projeto:
   - `ORIGINAL_PROTOCOL_BOOTSTRAP`, `ORIGINAL_PROTOCOL_BOOTSTRAP_142` e `UNSAFE_STARTUP_LOG` em `privateHostCore.js`
   - `HOOK_START`, `HOOK_END`, `AUTH_SUBSCRIPTION`, `ORIGINAL_INITIALIZE`, `ORIGINAL_EFFECTS` em `privateRendererCore.js`
   - os seletores do formulário de login em `src/integration/addon/addon-renderer.js`
3. Extraia, só lendo, os nomes da enumeração `PlayerSessionStateType` de `C:\Riot Games\Riot Client\RiotGamesApi.dll` (por exemplo, `grep -a -o` em volta de `PendingProductContextInitialization`). Compare com `NON_BLOCKING_SESSION_STATES` em `src/riot/riotAuthentication.js` e com as listas dos testes em `test/riot/riotAuthentication.test.js`. Liste os estados novos e diga se cada um parece automático (carregamento de dados, fila, renovação) ou exige uma pessoa (consentimento, restrição, escolha). Na dúvida, ele deve continuar bloqueando.
4. Para cada âncora, informe: encontrada uma vez, várias vezes ou ausente. Se ausente, mostre o trecho equivalente mais provável da versão nova (no máximo algumas linhas).
5. Leia `.client-integration/private-v1/manifest.json` e diga se a fonte registrada (tamanho e SHA-256) ainda bate com a instalação.

## Proibido

- Escrever em `C:\Riot Games\`, em `.client-integration/` ou em `src/`.
- Rodar `npm run integration:prepare-private`, o probe, o Electron ou o Riot Client.
- Copiar trechos grandes do código da Riot para a resposta ou para arquivos.

## Saída

Uma tabela de âncoras com o status, a versão encontrada, se a cópia preparada ainda vale, os estados novos da sessão do jogador com a classificação sugerida, e a lista de mudanças propostas (arquivo, constante, valor novo) para alguém aplicar com testes.
