---
tipo: guia
tags: [integração, manutenção]
---

# Atualização do Riot Client

O modo login integrado só aceita versões da interface do Riot validadas (hoje **141.0.0** e **142.0.0**). Quando a Riot atualiza, o app mostra um erro em vez de abrir a cópia antiga. O gerenciador normal continua funcionando.

## Sintomas

- Diálogo "Não foi possível abrir o Riot com Minhas Contas" com motivo de preparação ou versão.
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

## Passo a passo

1. **Descubra a versão.** Leia `package.json` dentro de `C:\Riot Games\Riot Client\RiotClientElectron\resources\app.asar` sem extrair, com `openArchive` de [[asar]].
2. **Compare o código.** Procure cada âncora da tabela no `dist/main/main.js` e `dist/renderer/renderer.js` da versão nova. Cada âncora tem de aparecer **uma única vez**.
3. **Adapte e teste.** Acrescente a versão, as âncoras novas e um teste no formato de `test/integration/host/privateVersion142.test.js`. `npm test` tem de passar.
4. **Guarde a cópia atual.** Mova `.client-integration/private-v1/` para `.client-integration/private-<versão>-backup/`. O preparador exige destino inexistente.
5. **Prepare.** `npm run integration:prepare-private`. Ele confere que a instalação do Riot não mudou durante a preparação.
6. **Verifique.** `npm run integration:probe-private` com os serviços Riot abertos. Espere `rendererReady` e `managerConnected` verdadeiros.
7. **Confira visualmente** a tela de login com o painel, sem autenticar.
8. **Registre.** Atualize [[Integração com o Riot Client]], [[Changelog]] e as notas dos módulos alterados.

## Ferramenta útil: REA

Para o passo 2, o REA (Reverse Engineer Anything, <https://github.com/morluto/rea>) analisa apps Electron e bundles JavaScript e compara versões de uma aplicação. Ele está configurado como servidor MCP no Claude Code desta máquina, mas não foi auditado. Use só leitura sobre a cópia, nunca sobre a instalação em uso durante uma atualização.

> [!warning]
> Nunca aplique uma cópia preparada para uma versão diferente da instalada, e nunca distribua o `app.asar` preparado.
