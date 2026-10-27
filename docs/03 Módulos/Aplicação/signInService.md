---
tipo: módulo
arquivo: src/core/signInService.js
camada: aplicação
testes: test/core/signInService.test.js
tags: [módulo]
---

# signInService

> Dono único das operações de login: valida a conta, serializa pedidos da janela e da ponte local, chama o [[riotClient]] e publica o progresso sem expor credenciais.

## Responsabilidade

- Uma operação de login por vez, venha da janela (`signIn`) ou da ponte local (`start`).
- Descriptografa a senha só no momento de chamar `riotClient.signIn`.
- No fim, atualiza no [[store]] a sessão salva, a conta atual, o Riot ID e `lastPlayed`.
- Remove usuário e senha de toda mensagem que sai.
- **Não** pergunta nada ao usuário (na janela, o [[renderer]] confirma antes) e não abre janelas.

## API pública

`createSignInService(options)`. Opções: `store`, `riotClient` e os observadores opcionais `status`, `operationUpdated`, `accountUpdated`, `log`, `onClosed`, `onLaunched`.

| Export | Tipo | Descrição |
|---|---|---|
| `createSignInService` | função | Fábrica do serviço |
| `signIn(id, game)` | método assíncrono | Fluxo da janela. Espera o fim, nunca lança e devolve `{ ok, gameStarted?, error?, cancelled? }` |
| `start(id, game)` | método | Fluxo da ponte. Devolve na hora `{ ok: true, operationId }`; lança se a conta for inválida ou já houver login |
| `cancel()` | método | Aborta a operação atual; sempre `{ ok: true }` |
| `getState()` | método | Cópia rasa da última operação, ou `null` |
| `isBusy()` | método | Há operação pendente |
| `activeAccountId()` | método | Conta em login, ou `null` |

Operação: `{ id, operationId, accountId, game, status, text, needsAttention, nativeClient, startedAt, finishedAt?, error?, cancelled? }`. `status` é `running`, `succeeded`, `failed` ou `cancelled`.

## Dependências

- Usa: [[store]] (`getAccount`, `getPassword`, `loadSession`, `hasSession`, `saveSession`, `forgetSession`, `setCurrentAccount`, `updateAccountFields`, `publicAccount`, `data.settings`), [[riotClient]] (`signIn`, `runningGames`), `crypto.randomUUID`.
- Usado por: [[main]], que liga os observadores à janela e à bandeja e repassa `start`, `cancel` e `getState` ao [[bridgeServer]].

## Invariantes e decisões

- **Lançamento fora de qualquer interface.** O serviço é dono dos lançamentos, fora de toda UI. Um renderer da Riot pode sumir durante a troca sem interromper a operação e sem ganhar acesso às credenciais guardadas.
- **Mutex compartilhado.** `pending` recusa um segundo pedido, da janela ou da ponte (`A sign-in is already in progress`).
- **Validar antes de criar a operação.** Jogo precisa ser `lol`, `tft` ou `val`; a conta precisa existir e ter usuário e senha. Falha aqui não cria operação.
- **Execução adiada.** O trabalho começa em `setImmediate`, para a ponte local confirmar a operação antes de a interface da Riot fechar.
- **Cancelamento cedo não toca em nada.** O sinal é checado antes e depois de `runningGames`. Cancelado ali, não há chamada ao cliente nem descriptografia.
- **Integração não fecha jogo aberto.** Em `start` (`requireIdle`), LoL ou VALORANT abertos recusam a troca. Na janela, essa confirmação é do [[renderer]].
- **Credenciais não se misturam.** Antes de descriptografar, compara usuário e senha criptografada atuais com os do início. Se mudaram, falha com `Account credentials changed. Start sign-in again`.
- **Senha vive pouco.** `getPassword` roda logo antes de `riotClient.signIn`; `decryptedPassword` é zerado no `finally`.
- **Integração sempre oculta.** Em `start`, `hide` e `closeClient` são sempre `true`, ignorando preferências antigas. Na janela valem `hideRiotClient` e `closeRiotClient`.
- **Redação de segredos.** `safeText` troca usuário e senha por `[redacted]` em status, log, erro e estado. Se um segredo com menos de 4 caracteres aparecer no texto, a mensagem inteira vira `Sign-in failed`. Valor que não é string também vira `Sign-in failed`.
- **Observadores não derrubam o login.** `notify` e `writeLog` engolem exceções e promessas rejeitadas. Falha de observador vira só uma linha de log.
- **Sessão rejeitada sai antes da nova.** Com `sessionRejected` no resultado, a sessão antiga é apagada antes de salvar a nova. Num erro com `sessionRejected`, a sessão é apagada; falha ao apagar só é registrada.
- **Sucesso só se o jogo abriu.** Sem `gameStarted`, a operação falha com `The game did not open…`; `onLaunched` não roda e `lastPlayed`/`lastGame` não são gravados. Conta atual e Riot ID devolvido são gravados mesmo assim.
- **Cancelado é decidido pelo sinal.** Qualquer erro depois de `abort()` vira `cancelled`.
- **Atenção termina desligada.** Cada `status` redefine `needsAttention` e `nativeClient`. No fim de toda operação, `needsAttention` volta a `false`.
- **Estado é cópia.** `getState` devolve cópia; mudar o objeto recebido não afeta a operação.

## Testes

`test/core/signInService.test.js` cobre: senha descriptografada só para o [[riotClient]] e ausente de estado, log e status; `start` devolvendo antes de executar e a operação sobrevivendo; mutex entre janela e ponte; recusa com LoL ou VALORANT abertos só no fluxo da ponte; `hide`/`closeClient` forçados na ponte e respeitados na janela; cancelamento antes e durante; ordem apagar/salvar de sessão rejeitada; erro de autenticação com falha ao apagar; `nativeClient` publicado e limpo pelo progresso seguinte; observadores que falham; credenciais trocadas no meio; redação; jogo e conta inválidos; jogo que não abriu; erro que não é `Error`.

## Pontos de atenção

- `onClosed` vai direto ao [[signInFlow]], sem `notify`. Uma exceção em `saveLeavingSession` ([[main]]) aborta o login depois de o cliente já ter sido fechado.
- `nativeClient` não é zerado no `finally`. O [[main]] só confia nele junto com `status === 'running'`.
- Um `status` tardio do cliente, depois do fim, ainda altera a operação e notifica os observadores.
- Ver [[Fluxo de login]] e [[Segurança e privacidade]].
