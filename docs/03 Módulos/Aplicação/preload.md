---
tipo: módulo
arquivo: src/main/preload.js
camada: aplicação
testes: nenhum
tags: [módulo]
---

# preload

> Ponte mínima entre o [[renderer]] e o [[main]]: publica `window.api`, com uma função para cada canal IPC.

## Responsabilidade

Roda no contexto isolado da janela e chama `contextBridge.exposeInMainWorld('api', …)`. Cada função faz `ipcRenderer.invoke` num canal fixo ou assina um evento enviado pelo main.

**Não** tem lógica, validação nem estado. **Não** expõe `ipcRenderer` nem um método genérico de envio.

## API pública

`window.api`:

| Export | Tipo | Canal | Descrição |
|---|---|---|---|
| `init()` | invoke | `init` | Dados iniciais da janela |
| `saveAccount(input)` | invoke | `account:save` | Cria ou edita conta |
| `deleteAccount(id)` | invoke | `account:delete` | Apaga conta |
| `patchAccount(id, fields)` | invoke | `account:patch` | Nota, ban, última temporada, fixar |
| `forgetSession(id)` | invoke | `account:forget-session` | Apaga o login salvo |
| `copy(id, what)` | invoke | `copy` | `password`, `riotId` ou `username` |
| `refresh(ids)` | invoke | `refresh` | Atualiza elos (todas as contas sem `ids`) |
| `runningGames()` | invoke | `running-games` | Jogos abertos |
| `signIn(id, game)` | invoke | `sign-in` | Login e abertura do jogo |
| `showRiotClient()` | invoke | `show-riot-client` | Mostra o Riot Client |
| `cancelSignIn()` | invoke | `cancel-sign-in` | Cancela o login |
| `saveSettings(input)` | invoke | `settings:save` | Salva configurações |
| `pickClientPath()` | invoke | `pick-client-path` | Escolhe o executável do cliente |
| `openDataFolder()` | invoke | `open-data-folder` | Abre a pasta de dados |
| `onAccountUpdated(cb)` | assinatura | `account-updated` | Conta pública alterada |
| `onRefreshProgress(cb)` | assinatura | `refresh-progress` | `{ done, total }` |
| `onNextRefresh(cb)` | assinatura | `next-refresh` | Horário ISO do próximo refresh |
| `onSignInStatus(cb)` | assinatura | `sign-in-status` | `{ id, text, needsAttention, nativeClient }` |
| `onSignInOperation(cb)` | assinatura | `sign-in-operation` | Cópia da operação de login |

## Dependências

- Usa: `electron` (`contextBridge`, `ipcRenderer`).
- Usado por: [[main]] (`webPreferences.preload`) e [[renderer]] (`window.api`).

## Invariantes e decisões

O arquivo original não tinha comentários. As regras abaixo vêm do próprio código e da configuração da janela no [[main]].

- **Superfície fechada.** Só canais nomeados. O renderer não consegue invocar um canal arbitrário. Canal novo exige mudar preload e main juntos.
- **Assinatura devolve o cancelamento.** `on(channel)(cb)` repassa só o `payload` (descarta o evento do Electron) e devolve uma função que remove o listener. O [[renderer]] usa isso em `play()` para soltar `onSignInStatus`.
- **Contexto isolado.** A janela usa `sandbox: true`, `contextIsolation: true` e `nodeIntegration: false`. O preload só depende de `contextBridge` e `ipcRenderer`.
- **Proteção está no main.** O preload não filtra dados. Quem garante que a senha não chega ao renderer é o [[store]] (`publicAccount`, `publicSettings`). `copy('password')` grava a senha direto na área de transferência pelo main.

## Testes

Nenhum teste direto. `test/main/mainStartup.test.js` não carrega o preload. A ponte do addon da Riot tem teste próprio em `test/integration/addon/clientAddon.test.js`, mas é outro arquivo ([[addons]]).

## Pontos de atenção

- Os nomes de canal aparecem em dois lugares (aqui e no [[main]]) sem constante compartilhada. Erro de digitação só aparece em execução.
- `scripts/dev/mock-api.js` imita `window.api` para o preview no navegador e precisa acompanhar mudanças. Hoje ele não define `onSignInOperation`; por isso o [[renderer]] chama esse método com `?.`. Ver [[Desenvolvimento]].
- Ver [[Segurança e privacidade]].
