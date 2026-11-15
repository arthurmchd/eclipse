---
tipo: módulo
arquivo: src-tauri/src/application/sign_in_service.rs
camada: aplicação
testes: src-tauri/tests/application/sign_in_service.rs
tags: [módulo]
---

# signInService

> Dono único das operações de login: valida a conta, serializa os pedidos, chama o [[riotClient]] e publica o progresso sem expor credenciais.

## Responsabilidade

- Uma operação de login por vez, pedida pelos cartões (`start_from_manager`).
- Descriptografa a senha só no momento de chamar o login do [[riotClient]].
- No fim, atualiza no [[store]] a sessão salva, a conta atual, o Riot ID e `lastPlayed`.
- Roda o login numa thread própria (pelo [[timers]]), porque a camada da Riot bloqueia quem chama.
- Remove usuário e senha de toda mensagem que sai.
- **Não** pergunta nada ao usuário (os [[cards]] confirmam antes) e não abre janelas.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `SignInService::new(store, riot, timers, observers)` | construtor | `store` é o `ServiceStore`; `riot` é a trait `SignInRunner`, que o [[riotClient]] implementa; `observers` (`SignInObservers`) traz status, operação e conta atualizadas, log, sessão de quem sai, jogo aberto e tradutor |
| `start_from_manager(id, jogo)` | método | Devolve na hora `{ ok: true, operationId }`; erro se a conta for inválida ou já houver login. As confirmações de jogo aberto ficam nos [[cards]] |
| `cancel()` | método | Aborta a operação atual; sempre `{ ok: true }` |
| `get_state()` | método | Cópia da última operação, ou `null` |
| `is_busy()` | método | Há operação pendente |
| `active_account_id()` | método | Conta em login, ou `None` |
| `ALREADY_RUNNING`, `CREDENTIALS_CHANGED`, `KEEP_LEAVING_FAILED` | constantes | Os textos fixos de erro |

Operação: `{ id, operationId, accountId, game, status, text, needsAttention, nativeClient, signedIn, startedAt, finishedAt?, error?, cancelled? }`. `status` é `running`, `succeeded`, `failed` ou `cancelled`.

## Dependências

- Usa: [[store]] pelo `ServiceStore` (conta, senha, sessões, conta atual, campos, conta pública e "Manter login"), [[riotClient]] pelo `SignInRunner`, [[timers]] e `uuid`.
- Usado por: [[main]], que liga os observadores à sobreposição, à bandeja e às notificações, e [[appPorts]], que chama `start_from_manager` a pedido do [[managerService]].

## Invariantes e decisões

- **Sucesso sem jogo só para `riot`.** Desde 2026-11-04, `riot` é aceito junto de `lol`, `tft` e `val`. A operação só termina `succeeded` com `gameStarted`, ou, para `riot`, com `clientOpened` (texto "Riot Client opened"). `clientOpened` num jogo não conta como sucesso. Sem jogo aberto, `lastPlayed` e `lastGame` não mudam; sessão, conta atual e Riot ID são gravados normalmente. Ver [[signInFlow]].
- **`remember` vem de `staySignedIn`** (ausente conta como ligado). A operação pública ganhou `signedIn`, que começa `false` e vira `true` no primeiro status com `signedIn` do [[signInFlow]]; nunca volta a `false` na mesma operação. Adicionado em 2026-11-04.
- **Login sempre visível.** Publica o estado da operação para o carregamento sobre a coluna de login.
- **Sem opções de janela.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), o serviço não repassa `hide`, `closeClient`, `releaseAfterLaunch` nem `visibleLogin` ao [[signInFlow]], que só tem o login visível. As preferências `hideRiotClient` e `closeRiotClient` da janela antiga saíram, junto com a entrada da ponte local, e a recusa com LoL ou VALORANT abertos que só ela fazia (`requireIdle`).

- **Lançamento fora de qualquer interface.** O serviço é dono dos lançamentos, fora de toda UI. A janela da Riot pode sumir durante a troca sem interromper a operação, e os cartões nunca recebem as credenciais guardadas.
- **Um login por vez.** Um login em curso recusa um segundo pedido (`A sign-in is already in progress`).
- **Sessão de quem sai, ou nada.** O aviso de Riot fechada repassado ao [[signInFlow]] embrulha o `save_leaving_session` do [[appPorts]]. Se ele falhar, o log recebe uma linha fixa ("could not keep the session of the account that was signed in") e o login para com "Could not keep the session of the account that was signed in. Try Play again", traduzido pelo [[language]]. O texto da exceção não vai ao log nem à tela, porque um erro de disco traz caminhos do sistema. Engolir a falha deixaria o [[signInFlow]] seguir e tirar da Riot o login lembrado da conta que saiu sem guardá-lo, contra a regra de dono da sessão do [[Fluxo de login]]. Parando ali, a Riot fica fechada com o YAML intacto, e a conta que saiu continua lembrada na própria Riot. Desde 2026-11-07.
- **Só a entrada dos cartões.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) não existe mais a forma que esperava o fim do login; o app sempre usou `start_from_manager`. Os testes esperam o fim pelo aviso de operação com `finishedAt`.
- **Validar antes de criar a operação.** Jogo precisa ser `lol`, `tft`, `val` ou `riot`; a conta precisa existir e ter usuário e senha. Falha aqui não cria operação.
- **Execução adiada.** O trabalho começa numa tarefa do [[timers]] com espera zero, para os cartões receberem o identificador da operação antes de o login mexer na Riot. Com o temporizador real, a tarefa roda numa thread própria.
- **Cancelamento cedo não toca em nada.** O sinal é checado antes de qualquer trabalho. Cancelado ali, não há chamada ao cliente nem descriptografia.
- **Jogo aberto é confirmado nos cartões.** O serviço não consulta jogos abertos; os [[cards]] confirmam antes de chamar `start_from_manager`.
- **Credenciais não se misturam.** Antes de descriptografar, compara usuário e senha criptografada atuais com os do início. Se mudaram, falha com `Account credentials changed. Start sign-in again`.
- **Senha vive pouco.** A senha é descriptografada logo antes do login do [[riotClient]] e só vive durante essa chamada.
- **Redação de segredos.** Usuário e senha são trocados por `[redacted]` em status, log, erro e estado. Se um segredo com menos de 4 caracteres aparecer no texto, a mensagem inteira vira `Sign-in failed`. Erro sem texto também vira `Sign-in failed`.
- **Observadores não derrubam o login.** Os observadores são funções sem resultado de erro; o que eles fazem por dentro (gravar, publicar) não volta ao login.
- **Sessão rejeitada sai antes da nova.** Com `sessionRejected` no resultado, a sessão antiga é apagada antes de salvar a nova. Num erro com `sessionRejected`, a sessão é apagada; falha ao apagar só é registrada. Desde 2026-11-06, o [[signInFlow]] também avisa assim que descobre que a sessão restaurada é de outra conta, e a cópia é apagada na hora, antes de a Riot fechar. Assim a sessão renovada é guardada na dona certa, em vez de achar a conta errada pelo `sub` da cópia. Falha ao apagar só é registrada ("could not forget the rejected session").
- **Sucesso só se o jogo abriu.** Sem `gameStarted`, a operação falha com `The game did not open…`; o aviso de jogo aberto não roda e `lastPlayed`/`lastGame` não são gravados. Conta atual e Riot ID devolvido são gravados mesmo assim.
- **Cancelado é decidido pelo sinal.** Qualquer erro depois do cancelamento vira `cancelled`.
- **Recuperação após timeout.** Cada `status` redefine `needsAttention` e `nativeClient`. Uma falha preserva somente as flags explícitas devolvidas pelo erro do fluxo, sem deduzir verificação pendente de avisos genéricos. Sucesso e cancelamento limpam ambas. A operação terminada libera o mutex, mas mantém a recuperação da verificação nativa disponível.
- **Progresso tardio não reabre operação.** Os avisos do pedido ao [[signInFlow]] só vivem durante a chamada, então nenhum status chega depois do fim para apagar a recuperação pendente ou trocar a mensagem final.
- **Estado é cópia.** `get_state` devolve cópia; mudar o objeto recebido não afeta a operação.
- **Texto traduzido só na saída.** O tradutor (padrão: devolve igual) é aplicado aos textos publicados: `text` e `error` da operação no aviso de operação e em `get_state`, e o texto do status. A operação guardada e o log continuam em inglês, e `get_state` traduz na hora de ler, então mudar o idioma no meio de um login já vale para a próxima leitura. O [[main]] passa o `localize` do [[language]]. Adicionado em 2026-11-04 ([[ADR-014 Interface em português e inglês]]).

## Testes

`src-tauri/tests/application/sign_in_service.rs`, com store, Riot e relógio falsos, cobre: senha descriptografada só para a Riot e ausente de estado, log e status; `start_from_manager` devolvendo antes de executar; segundo login recusado; cancelamento antes e durante, liberando o serviço; ordem apagar/salvar de sessão rejeitada; erro de autenticação com falha ao apagar; sessão de outra conta apagada assim que achada, antes de a Riot fechar, e falha ao apagar só no log; sessão de quem sai chegando antes de o fluxo seguir, e uma falha ao guardá-la parando o login sem detalhes do sistema; progresso público e `get_state` independente; contexto da verificação nativa publicado, mantido numa falha e limpo pelo progresso seguinte, por erros comuns e pelo cancelamento; credenciais editadas antes da execução; redação, inclusive de segredo curto demais; jogo e conta inválidos; jogo que não abriu; `riot` só com a Riot conectada, sem gravar jogo; jogo jogado gravando quando, qual e o Riot ID devolvido; erro sem texto; "Manter login" e a etapa `signedIn`; textos no idioma escolhido com o log em inglês; falha do store depois do login; e, com o temporizador real, o login saindo da thread de quem pediu.

## Pontos de atenção

- Ver [[Fluxo de login]] e [[Segurança e privacidade]].
