---
tipo: roadmap
atualizado: 2026-10-26
tags: [backlog]
---

# Backlog

Ordenado por prioridade. Use o template [[Tarefa]] para detalhar um item antes de começar. Todos os itens abaixo foram conferidos no código em 2026-10-26, durante a documentação dos módulos. Eles já existiam antes da reorganização.

## Segurança do login

Itens 1 e 2 (segundo envio de senha e `loginState` desconhecido liberando o jogo) foram resolvidos em 2026-10-26. Ver [[Changelog]] e [[riotAuthentication]].

## Correções

3. **Atualização automática que se recupera.** As chamadas agendadas de `refreshAll` em [[main]] não tratam rejeição, e `scheduleRefresh` só roda no caminho feliz: um erro no meio para o refresh automático de vez. Tratar erro e reagendar em `finally`.
4. **Chave ilegível derruba todo refresh.** `getKeys()` em [[store]] não protege o `decrypt`, ao contrário de `publicSettings`. Enquanto a tela mostra a chave como ilegível, todo refresh falha.
5. **Timeout nas consultas de elo.** `getJson` em [[rankApi]] usa `fetch` sem prazo numa fila compartilhada; uma conexão presa trava todas as atualizações e o `refreshing` do main. Um `retry-after` em formato de data vira `NaN` e a nova tentativa sai sem espera.
6. **Conta apagada durante o refresh quebra a interface.** `updateAccountFields` devolve `null`, o main envia `account-updated` com `null` e o [[renderer]] lê `acc.id`. Filtrar no main.
7. **`refreshAll(ids)` ignora `ids` se já houver refresh.** Conta recém-salva só ganha elo no ciclo seguinte ([[main]]).
8. **`onClosed` sem proteção.** Em [[signInService]], `onClosed` é repassado direto, sem o `notify` que protege os outros callbacks. Uma exceção em `saveLeavingSession` aborta o login com o Riot já fechado.
9. **`closeClient` não fecha o cliente.** Em [[signInFlow]], a opção só chama `conceal()`. Decidir: renomear a preferência ou implementar o fechamento.
10. **Corpo de resposta no log.** `requestLaunch` em [[riotClient]] grava até 300 caracteres das respostas de abertura do jogo no `sign-in.log`. Risco baixo, mas contraria "só valores fixos no log" ([[Segurança e privacidade]]).
11. **Erros sem toast na interface.** `submitSettings`, `deleteAccount` e as ações do menu (`pin`, `unban`, `forget`, `delete`) em [[renderer]] não tratam rejeição; recusas como "Wait for sign-in to finish…" somem.
12. **`hostEntry` sem `return` após `app.exit(1)`.** Sem o argumento do pipe, a linha seguinte ainda roda com `flag` indefinido ([[hostEntry]]).
13. **Validação central das mensagens IPC.** Validar formato de conta, tipos de configuração e campos de `account:patch` no main ([[preload]], [[main]]).

## Investigar

- **Validar o [[riotInterface]] numa instalação real** e registrar qual caminho funciona (`show` ou reinício com interface).
- **"The background window guard did not respond".** Apareceu no `sign-in.log` real em duas tentativas de 26/10 (11:33 e 18:40, horário local), logo depois de digitar as credenciais. Investigar o prazo de comandos do [[windowController]] durante o preenchimento nativo.

## Estrutura

14. **Dividir `src/main/index.js`** (≈390 linhas) em `window`, `tray`, `ipc`, `rankScheduler` e `riotLogin`. Exige reescrever o harness de `test/main/mainStartup.test.js`, que hoje executa um arquivo só dentro de um `vm` e falha com qualquer `require` novo.
15. **Dividir `src/renderer/app.js`** (≈840 linhas) em ES modules: `state`, `format`, `render/cards`, `render/sidebar`, `modals`, `actions`, `shortcuts`. Sem testes hoje; verificar pela prévia no navegador.
16. **Lint e formatação.** ESLint (flat config) e Prettier como `devDependencies`, com `npm run lint` e uma regra que barre comentários novos.
17. **Limpar código morto.** `SUPPORTED_VERSION` e `UNSAFE_STARTUP_LOG` não usados em [[privateHostCore]]; ramo `error:focus` em [[riotClient]]; ramo "The game did not start" em [[renderer]]; `dryRun` só usado em testes ([[signInFlow]]).
18. **Remover o experimento legado** (`scripts/legacy/`, [[status]] e os testes associados) se ele não for mais retomado.
19. **Mock da prévia fora de sincronia.** `scripts/dev/mock-api.js` não define `onSignInOperation`.

## Produto

20. **Instalador e atualização.** Instalador assinado, versionamento do formato de `data.json` e atualização controlada. Os auxiliares PowerShell precisam ficar fora do `app.asar` (já suportado por `unpackedPath` em [[paths]]); `.client-integration/` também precisaria sair de dentro do pacote.
21. **Validar o fluxo integrado com contas reais**: sessão nova, sessão expirada e 2FA ([[Integração com o Riot Client]]).

## Ferramentas de desenvolvimento

22. **Servidor de prévia só local.** `scripts/dev/preview-server.js` escuta em todas as interfaces e `decodeURIComponent` pode lançar com URL inválida. Limitar a `127.0.0.1` e tratar o erro.

Mais riscos de menor impacto estão em "Pontos de atenção" de cada nota de módulo.

## Feito

Ver [[Changelog]].
