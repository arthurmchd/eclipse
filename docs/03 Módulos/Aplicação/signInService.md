---
tipo: módulo
arquivo: src-tauri/src/application/sign_in_service.rs
camada: aplicação
testes: src-tauri/tests/application/sign_in_service.rs
tags: [módulo]
---

# signInService

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Dono único das operações de login: valida a conta, serializa os pedidos, chama o [[riotClient]] e publica o progresso sem expor credenciais.

## Responsabilidade

- Uma operação de login por vez, venha dos cartões (`startFromManager`) ou da forma que espera o fim (`signIn`).
- Descriptografa a senha só no momento de chamar `riotClient.signIn`.
- No fim, atualiza no [[store]] a sessão salva, a conta atual, o Riot ID e `lastPlayed`.
- Remove usuário e senha de toda mensagem que sai.
- **Não** pergunta nada ao usuário (os [[cards]] confirmam antes) e não abre janelas.

## API pública

`createSignInService(options)`. Opções: `store`, `riotClient`, os observadores opcionais `status`, `operationUpdated`, `accountUpdated`, `log`, `onClosed`, `onLaunched` e `translate`.

| Export | Tipo | Descrição |
|---|---|---|
| `createSignInService` | função | Fábrica do serviço |
| `startFromManager(id, game)` | método | Fluxo dos cartões. Devolve na hora `{ ok: true, operationId }`; lança se a conta for inválida ou já houver login. As confirmações de jogo aberto ficam nos [[cards]] |
| `cancel()` | método | Aborta a operação atual; sempre `{ ok: true }` |
| `getState()` | método | Cópia rasa da última operação, ou `null` |
| `isBusy()` | método | Há operação pendente |
| `activeAccountId()` | método | Conta em login, ou `null` |

Operação: `{ id, operationId, accountId, game, status, text, needsAttention, nativeClient, startedAt, finishedAt?, error?, cancelled? }`. `status` é `running`, `succeeded`, `failed` ou `cancelled`.

## Dependências

- Usa: [[store]] (`getAccount`, `getPassword`, `loadSession`, `hasSession`, `saveSession`, `forgetSession`, `setCurrentAccount`, `updateAccountFields`, `publicAccount`, `data.settings`), [[riotClient]] (`signIn`), `crypto.randomUUID`.
- Usado por: [[main]], que liga os observadores à sobreposição e à bandeja, e [[managerService]], que chama `startFromManager`.

## Invariantes e decisões

- **Sucesso sem jogo só para `riot`.** Desde 2026-11-04, `riot` é aceito junto de `lol`, `tft` e `val`. A operação só termina `succeeded` com `gameStarted`, ou, para `riot`, com `clientOpened` (texto "Riot Client opened"). `clientOpened` num jogo não conta como sucesso. Sem jogo aberto, `lastPlayed` e `lastGame` não mudam; sessão, conta atual e Riot ID são gravados normalmente. Ver [[signInFlow]].
- **`remember` vem de `settings.staySignedIn`** (ausente conta como ligado). A operação pública ganhou `signedIn`, que começa `false` e vira `true` no primeiro status com `signedIn` do [[signInFlow]]; nunca volta a `false` na mesma operação. Adicionado em 2026-11-04.
- **Login sempre visível.** Publica o estado da operação para o carregamento sobre a coluna de login.
- **Sem opções de janela.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), o serviço não repassa `hide`, `closeClient`, `releaseAfterLaunch` nem `visibleLogin` ao [[signInFlow]], que só tem o login visível. As preferências `hideRiotClient` e `closeRiotClient` da janela antiga saíram, junto com `start`, a entrada da ponte local, e a recusa com LoL ou VALORANT abertos que só ela fazia (`requireIdle`).

- **Lançamento fora de qualquer interface.** O serviço é dono dos lançamentos, fora de toda UI. Um renderer da Riot pode sumir durante a troca sem interromper a operação e sem ganhar acesso às credenciais guardadas.
- **Um login por vez.** `busy` recusa um segundo pedido (`A sign-in is already in progress`).
- **Sessão de quem sai, ou nada.** O `onClosed` repassado ao [[signInFlow]] embrulha o do [[main]] (`saveLeavingSession`). Se ele falhar, o log recebe uma linha fixa ("could not keep the session of the account that was signed in") e o login para com "Could not keep the session of the account that was signed in. Try Play again", traduzido pelo [[language]]. O texto da exceção não vai ao log nem à tela, porque um erro de disco traz caminhos do sistema. Engolir a falha deixaria o [[signInFlow]] seguir e tirar da Riot o login lembrado da conta que saiu sem guardá-lo, contra a regra de dono da sessão do [[Fluxo de login]]. Parando ali, a Riot fica fechada com o YAML intacto, e a conta que saiu continua lembrada na própria Riot. Desde 2026-11-07; antes o `onClosed` ia direto, e a exceção crua virava o erro do login.
- **Só a entrada dos cartões.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saiu `signIn(id, game)`, que esperava o fim e devolvia `{ ok, gameStarted?, error?, cancelled? }`. Só os testes o chamavam; o app sempre usou `startFromManager`. Os testes esperam o fim pelo `operationUpdated` com `finishedAt`.
- **Validar antes de criar a operação.** Jogo precisa ser `lol`, `tft` ou `val`; a conta precisa existir e ter usuário e senha. Falha aqui não cria operação.
- **Execução adiada.** O trabalho começa em `setImmediate`, para os cartões receberem o identificador da operação antes de o login mexer na Riot.
- **Cancelamento cedo não toca em nada.** O sinal é checado antes de qualquer trabalho. Cancelado ali, não há chamada ao cliente nem descriptografia.
- **Jogo aberto é confirmado nos cartões.** O serviço não consulta jogos abertos; os [[cards]] confirmam antes de chamar `startFromManager`.
- **Credenciais não se misturam.** Antes de descriptografar, compara usuário e senha criptografada atuais com os do início. Se mudaram, falha com `Account credentials changed. Start sign-in again`.
- **Senha vive pouco.** `getPassword` roda logo antes de `riotClient.signIn`; `decryptedPassword` é zerado no `finally`.
- **Redação de segredos.** `safeText` troca usuário e senha por `[redacted]` em status, log, erro e estado. Se um segredo com menos de 4 caracteres aparecer no texto, a mensagem inteira vira `Sign-in failed`. Valor que não é string também vira `Sign-in failed`.
- **Observadores não derrubam o login.** `notify` e `writeLog` engolem exceções e promessas rejeitadas. Falha de observador vira só uma linha de log.
- **Sessão rejeitada sai antes da nova.** Com `sessionRejected` no resultado, a sessão antiga é apagada antes de salvar a nova. Num erro com `sessionRejected`, a sessão é apagada; falha ao apagar só é registrada. Desde 2026-11-06, o [[signInFlow]] também chama `onRejected` assim que descobre que a sessão restaurada é de outra conta, e a cópia é apagada na hora, antes de a Riot fechar. Assim o `onClosed` guarda a sessão renovada na dona certa, em vez de achar a conta errada pelo `sub` da cópia. Falha ao apagar só é registrada ("could not forget the rejected session").
- **Sucesso só se o jogo abriu.** Sem `gameStarted`, a operação falha com `The game did not open…`; `onLaunched` não roda e `lastPlayed`/`lastGame` não são gravados. Conta atual e Riot ID devolvido são gravados mesmo assim.
- **Cancelado é decidido pelo sinal.** Qualquer erro depois de `abort()` vira `cancelled`.
- **Recuperação após timeout.** Cada `status` redefine `needsAttention` e `nativeClient`. Uma falha preserva somente as flags explícitas devolvidas pelo erro do fluxo, sem deduzir verificação pendente de avisos genéricos. Sucesso e cancelamento limpam ambas. A operação terminada libera o mutex, mas mantém a recuperação da verificação nativa disponível.
- **Progresso tardio não reabre operação.** Status recebido após o fim é ignorado; não pode apagar a recuperação pendente nem substituir a mensagem final.
- **Estado é cópia.** `getState` devolve cópia; mudar o objeto recebido não afeta a operação.
- **Texto traduzido só na saída.** A opção `translate(texto)` (padrão: devolve igual) é aplicada aos textos publicados: `text` e `error` da operação em `operationUpdated` e `getState`, e `text` do `status`. A operação guardada e o log continuam em inglês, e `getState` traduz na hora de ler, então mudar o idioma no meio de um login já vale para a próxima leitura. Se `translate` falhar ou não devolver texto, sai o original. O [[main]] passa o `localize` do [[language]]. Adicionado em 2026-11-04 ([[ADR-014 Interface em português e inglês]]).
- **Versão Rust (fase 3 da [[Migração para Tauri]]).** `src-tauri/src/application/sign_in_service.rs`, testes em `src-tauri/tests/application/sign_in_service.rs`. O trabalho começa num [[timers]] com espera zero, o equivalente do `setImmediate`; com o temporizador real, o login roda numa thread própria, porque a camada da Riot em Rust bloqueia quem chama. `start_from_manager` devolve na hora. O serviço lê o [[store]] pelo `ServiceStore` e chama a Riot por `SignInRunner`, que o [[riotClient]] implementa. Três cenários do JS não existem em Rust: observadores não lançam exceção (são funções sem `Result`), o `translate` sempre devolve texto, e um status depois do fim é impossível, porque as funções do pedido ao [[signInFlow]] vivem só durante a chamada. Erro sem texto vira "Sign-in failed", como o `throw null` do JS. Um teste roda o login com o temporizador real e confere que ele sai da thread de quem pediu.

## Testes

`test/core/signInService.test.js` cobre: senha descriptografada só para o [[riotClient]] e ausente de estado, log e status; o serviço expondo só `startFromManager`, `cancel`, `getState`, `isBusy` e `activeAccountId`; `startFromManager` devolvendo antes de executar e a operação sobrevivendo; segundo login recusado enquanto outro roda; nenhuma consulta a jogos abertos; nenhuma opção de janela repassada; cancelamento antes e durante; ordem apagar/salvar de sessão rejeitada; erro de autenticação com falha ao apagar; `nativeClient` publicado e limpo pelo progresso seguinte; observadores que falham; credenciais trocadas no meio; redação; jogo e conta inválidos; jogo que não abriu; erro que não é `Error`.

Desde 2026-11-06 também cobre o `onRejected`: a sessão da conta escolhida é apagada antes de a Riot fechar a outra conta, e uma falha ao apagar só vai ao log.

Desde 2026-11-07 cobre o `onClosed`: a sessão de quem sai chega ao [[main]] antes de o fluxo seguir; uma falha, síncrona ou assíncrona, para o login antes de o fluxo mexer no YAML, sem salvar sessão nem trocar a conta atual, com o erro fixo traduzível e sem caminho nem texto da exceção no log ou no estado.

## Pontos de atenção

- Ver [[Fluxo de login]] e [[Segurança e privacidade]].
