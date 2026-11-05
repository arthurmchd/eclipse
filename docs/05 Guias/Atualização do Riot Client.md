---
tipo: guia
tags: [integração, manutenção]
---

# Atualização do Riot Client

O modo integrado só aceita versões da interface do Riot validadas (**141.0.0** e **142.0.0**). Quando a Riot atualiza, o app mostra um erro em vez de abrir a cópia antiga. Como todas as funções agora vivem na janela Riot, é preciso preparar uma cópia compatível para voltar ao painel de contas.

## Sintomas

- Diálogo "Não foi possível abrir a interface integrada" com motivo de preparação ou versão.
- `npm run integration:probe-private` grava `ok: false` em `.client-integration/private-v1/probe-controller/result.json`.

## O que pode quebrar

| Ponto | Onde | Por quê |
|---|---|---|
| Lista de versões | `SUPPORTED_VERSIONS` em [[privateHostCore]] | Versão nova é recusada por padrão |
| Inicialização do protocolo Sentry | `ORIGINAL_PROTOCOL_BOOTSTRAP*` em [[privateHostCore]] | Texto minificado procurado literalmente |
| Log com argumentos | `UNSAFE_STARTUP_LOG` em [[privateHostCore]] e [[Scripts de integração]] | O filtro precisa encontrar a chamada exata |
| Hook do formulário e MFA | `HOOK_START`, `HOOK_END`, `ORIGINAL_INITIALIZE`, `ORIGINAL_EFFECTS` em [[privateRendererCore]] | Nomes minificados mudam a cada build |
| Seletores do formulário | `addon-renderer.js` ([[addons]]) | O painel procura o `LoginForm` |
| Posições do preenchimento nativo | `login.ps1` ([[login.ps1]]) | Frações medidas na v141 |
| Estados da sessão do jogador | `NON_BLOCKING_SESSION_STATES` em [[riotAuthentication]] | Estado automático novo fica bloqueado até entrar na lista. Compare com a enumeração `PlayerSessionStateType` em `C:\Riot Games\Riot Client\RiotGamesApi.dll` (só leitura) |

Os serviços do Riot (`RiotGamesApi.dll`) atualizam junto com a interface e também afetam o login em segundo plano.

## Passo a passo

1. **Descubra a versão.** Leia `package.json` dentro de `C:\Riot Games\Riot Client\RiotClientElectron\resources\app.asar` sem extrair, com `openArchive` de [[asar]].
2. **Compare o código.** Procure cada âncora da tabela no `dist/main/main.js` e `dist/renderer/renderer.js` da versão nova. Cada âncora tem de aparecer **uma única vez**.
3. **Adapte e teste.** Acrescente a versão, as âncoras novas e um teste no formato de `test/integration/host/privateVersion142.test.js`. `npm test` tem de passar.
4. **Encerre a instância antiga pela bandeja.** Não mova `.client-integration/` nem suas cópias: os manifestos guardam caminhos absolutos.
5. **Prepare.** `npm run integration:prepare-private` cria o destino novo `private-v1/embedded-v1/` e confere que a instalação do Riot não mudou durante a preparação. Se esse destino já existir, preserve-o com seus arquivos e manifesto originais, remova somente o `app.asar` e o `manifest.json` desse destino depois de fechar o host e prepare novamente no mesmo caminho. Não apague as contas em `%APPDATA%`.
6. **Verifique.** `npm run integration:probe-private` com os serviços Riot abertos. Espere `rendererReady` e `managerConnected` verdadeiros.
7. **Confira visualmente** a tela de login com o painel, sem autenticar.
8. **Registre.** Atualize [[Integração com o Riot Client]], [[Changelog]] e as notas dos módulos alterados.

## Ferramenta útil: REA

Para o passo 2, o REA (Reverse Engineer Anything, <https://github.com/morluto/rea>) analisa apps Electron e bundles JavaScript e compara versões de uma aplicação. Ele está configurado como servidor MCP no Claude Code desta máquina, mas não foi auditado. Use só leitura sobre a cópia, nunca sobre a instalação em uso durante uma atualização.

> [!warning]
> Nunca aplique uma cópia preparada para uma versão diferente da instalada, e nunca distribua o `app.asar` preparado.
