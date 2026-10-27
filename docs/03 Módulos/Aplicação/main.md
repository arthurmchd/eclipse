---
tipo: módulo
arquivo: src/main/index.js
camada: aplicação
testes: test/main/mainStartup.test.js
tags: [módulo]
---

# main

> Processo principal do Electron: cria a janela, registra os canais IPC, agenda a atualização de elos e coordena a integração com o Riot Client.

## Responsabilidade

- Garante uma única instância do app (`app.requestSingleInstanceLock`).
- Quando o Electron fica pronto, cria o [[store]], o [[privateClient]] e o serviço de login ([[signInService]]).
- Registra os handlers `ipcMain.handle` consumidos pelo [[preload]].
- Atualiza elos em lote e no intervalo configurado, usando [[rankApi]].
- Liga a integração com o Riot Client: bandeja, [[bridgeServer]] e cópia privada no modo `--riot-login`.
- **Não** faz login nem fala com a API da Riot diretamente. Delega a [[signInService]] e [[riotClient]].

## API pública

Não exporta nada. A interface é o conjunto de canais IPC, os eventos enviados à janela e a flag de linha de comando.

| Canal / evento | Tipo | Descrição |
|---|---|---|
| `init` | IPC | Contas públicas, configurações mascaradas, `regions`, `valRegions`, `lastRefresh`, `nextRefresh`, versão, operação atual, `nativeIntegration` (com `requested`) e `clientFound` |
| `account:save` | IPC | `store.upsertAccount` e dispara `refreshAll([id])` em segundo plano |
| `account:delete` | IPC | `store.deleteAccount` |
| `account:patch` | IPC | Altera só `note`, `ban`, `lastSeason` e `pinned` |
| `account:forget-session` | IPC | Apaga a sessão salva e devolve a conta pública |
| `copy` | IPC | Copia `password`, `riotId` ou, por padrão, `username` |
| `refresh` | IPC | `refreshAll(ids)` |
| `running-games` | IPC | `riotClient.runningGames()` |
| `show-riot-client` | IPC | Mostra o cliente certo (ver decisões); devolve `{ ok, error? }` |
| `cancel-sign-in` | IPC | `launchService.cancel()` |
| `sign-in` | IPC | `launchService.signIn(id, game)`; espera o fim do login |
| `settings:save` | IPC | `store.updateSettings`, reagenda o refresh e devolve `nextRefresh` e `clientFound` |
| `pick-client-path` | IPC | Diálogo para escolher `RiotClientServices.exe` |
| `open-data-folder` | IPC | Abre `store.dir` no Explorer |
| `account-updated`, `refresh-progress`, `next-refresh`, `sign-in-status`, `sign-in-operation` | evento | Enviados por `send()` só se a janela existir |
| `--riot-login` | argumento | Liga `riotLoginMode`: janela começa oculta e abre a interface integrada |

## Dependências

- Usa: [[paths]] (`RENDERER_DIR`, `APP_ICON`), [[store]], [[rankApi]], [[riotClient]], [[signInService]], [[bridgeServer]], [[status]] (`inspectClientIntegration`), [[privateClient]] (`createPrivateClient`, `inspectPrivateClient`), [[windowsDpapi]] (`protectString`, usado como `encodeToken`).
- Usado por: Electron (`main` do `package.json`). Carrega o [[preload]] e o [[renderer]].

## Invariantes e decisões

- **Uma instância só.** Mantém um único armazenamento de credenciais e um único dono dos lançamentos, não importa qual interface pede. A segunda instância só repassa `--riot-login` ou traz o gerenciador para frente.
- **Pedido antes do `ready` não se perde.** `second-instance` com `--riot-login` liga `riotLoginMode` mesmo antes de `startupComplete`. A abertura acontece no fim da inicialização.
- **Janela isolada.** `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, sem menu. Controles da janela ficam com o Windows (`titleBarOverlay`).
- **Links abrem fora do app.** Links (como as páginas das chaves de API) abrem no navegador padrão, nunca dentro do app. Só `https://` vai para `shell.openExternal`; toda janela nova é negada.
- **Salvar a sessão de quem sai.** Antes de trocar, `saveLeavingSession` guarda o login mais recente da conta que estava conectada: o cliente renova esse login durante o uso e grava no disco quando fecha. Só salva se `hasPersistedLogin(yaml)` e se o Riot ID bater com a conta atual (`sameRiotId`). Sem confirmação de identidade, registra no log e não salva.
- **Log de login sem credenciais.** Os passos do login vão para `sign-in.log` na pasta de dados, nunca credenciais. O arquivo vira `.old` acima de 200 KB. Erros de escrita são ignorados.
- **Elos logo após salvar.** Conta nova ou alterada tem os elos buscados na hora; erro é ignorado.
- **Um refresh por vez.** `refreshAll` reaproveita a promessa em andamento. `lastRefresh` só é gravado num refresh completo (sem `ids`). O timer nunca dispara em menos de 5 s.
- **Sem edição durante o login.** `account:save` (conta existente), `account:delete` e `account:forget-session` recusam a conta de `activeAccountId()`.
- **`account:patch` com lista branca.** Credenciais e estatísticas não passam por esse canal.
- **Senha some da área de transferência.** Depois de 20 s a senha é apagada, se ainda for o conteúdo atual.
- **Desafio nativo fica com o renderer original.** CAPTCHA/MFA pertence ao renderer que enviou as credenciais. Abrir um renderer privado nesse momento perderia o contexto da verificação. Se `nativeChallengePending()` (operação `running` com `needsAttention` e `nativeClient`), `openRiotLogin` esconde a cópia privada e `show-riot-client` e `openRiotLogin` chamam `riotClient.openClient` com o caminho configurado.
- **Falha visível, sem substituto.** Um balão sozinho passa despercebido, principalmente com as notificações do Windows desligadas. `reportIntegrationError` mostra o gerenciador e um diálogo de erro, sem abrir a interface original da Riot como substituta.
- **Aberturas serializadas.** `ensureClientIntegration` e `openRiotLogin` guardam a promessa em andamento (`integrationStarting`, `riotLoginOpening`). Pedidos repetidos do atalho compartilham uma abertura.
- **Ordem de detecção.** Primeiro `inspectClientIntegration` (cliente oficial modificado). Só em `riotLoginMode`, se não estiver ativo, tenta `inspectPrivateClient` (cópia privada, `mode: 'private'`).
- **Falha da ponte desfaz tudo.** Se `start()` da ponte falhar, a ponte é parada, a bandeja destruída e `nativeIntegration.active` vira `false` com mensagem em português.
- **Fechar só esconde com ponte ativa.** Com ponte e bandeja, fechar a janela a esconde; sair é pelo menu da bandeja. `window-all-closed` só encerra sem bandeja.
- **Saída ordenada.** `before-quit` cancela o login e espera `privateClient.stop()`, `riotClient.dispose()` e `clientBridge.stop()` antes de sair.
- **Login esconde a cópia privada.** Em modo `private`, operação `running` chama `privateClient.hide()`. Falha mostra balão com até 240 caracteres; `needsAttention` mostra outro balão.
- **Refresh na abertura.** Após `did-finish-load`, se o próximo refresh já venceu e há contas, atualiza tudo; senão só agenda.

## Testes

`test/main/mainStartup.test.js` executa o arquivo em `vm` com dependências falsas. Cobre: atalho promovendo um gerenciador já aberto, pedido antes do `ready`, cópia privada desatualizada e falha do host privado (diálogo, sem abrir a interface original), aberturas repetidas compartilhadas, falha da ponte com limpeza, recuperação do desafio nativo nos dois modos e a condição exata de `nativeChallengePending`.

Fora: handlers de contas, `copy`, refresh de elos, bandeja e `before-quit`.

## Pontos de atenção

- O teste resolve `require` por nome exato (`../paths`, `../core/store`…). Um `require` novo em `index.js` quebra o teste com `Unexpected dependency`.
- `refreshAll(ids)` durante um refresh completo devolve a promessa em andamento e ignora `ids`. Conta recém-salva só ganha elo no ciclo seguinte.
- Se `refreshAll` falhar no meio (por exemplo, `store.getKeys()` sem conseguir descriptografar), `scheduleRefresh` não roda e o refresh automático para. O `setTimeout` não trata a rejeição.
- Conta apagada durante o refresh faz `updateAccountFields` devolver `null`, e `account-updated` sai com `null`.
- `show-riot-client` em modo `private` usa `riotClientPath || detectClientPath()`; `openRiotLogin` usa `detectClientPath(riotClientPath)`.
- O item "Open Riot Client" da bandeja passa o `MenuItem` do Electron como opções de `openRiotLogin`. Funciona porque o objeto não tem `reportFailure`.
- Ver [[Integração com o Riot Client]], [[Fluxo de login]], [[Limitações conhecidas]] e [[Backlog]].
