---
tipo: decisão
status: aceita
data: 2026-11-21
tags: [adr, segurança, login]
---

# ADR-042 CAPTCHA do formulário não bloqueia conta autorizada

## Contexto

No laboratório de velocidade de 2026-11-21 ([[Laboratório de velocidade do login]]), o login com a conta já conectada na Riot travou em 2 de 3 tentativas: o Eclipse mostrou "A Riot ainda não terminou o login" e expirou em 180 s. Com o diagnóstico da 2.17.1, a reprodução autorizada pelo usuário no mesmo dia mostrou a fonte: `authenticator captcha: hcaptcha`. Nessa hora, `/rso-auth/v1/authorization` respondia 200, o Riot ID era o da conta e o `loginState` da sessão do jogador era `pendingproductcontext`, que já é liberado.

O autenticador (`/rso-authenticator/v1/authentication`) descreve o formulário do próximo login, não a sessão atual. Com a conta conectada, ele respondeu `auth` sem CAPTCHA e, cerca de 1 s depois, `auth` com `hcaptcha`. O [[riotAuthentication]] tratava qualquer CAPTCHA ativo como `challenge` e devolvia esse estado sem olhar a sessão do jogador. O [[signInFlow]] esperava o `challenge` sumir, e ele nunca sumia. A mesma leitura enganosa já tinha aparecido nos cartões: `login_screen_state` só diz `auth` quando a autorização não responde 200.

A regra de falha fechada da [[Segurança e privacidade]] diz que um `challenge` impede o jogo. Esta decisão a estreita num caso.

## Decisão

Em `session_state`, um `challenge` que vem só do objeto `captcha` do autenticador (`ChallengeSource::Captcha`) passa a consultar `GET /rso-auth/v1/authorization`. Com 200, o estado é tratado como autenticado e segue para a sessão do jogador, que decide como antes: só `NON_BLOCKING_SESSION_STATES` liberam, `PendingMultifactor` vira `multifactor` e qualquer outro estado vira `challenge`.

Continuam bloqueando como antes: CAPTCHA recusado pela Riot (`captcha_not_allowed`), tipo desconhecido do autenticador, 2FA, autorização diferente de 200, autorização que falha ao responder e clientes antigos (`/rso-auth/v1/session`).

## Alternativas consideradas

- **Pular a releitura do estado quando o fluxo reaproveita a conta:** resolveria só o reaproveitamento. Deixaria passar uma verificação real da sessão do jogador (consentimento, idade), que o fluxo hoje espera de propósito.
- **Ignorar o autenticador sempre que a conta estiver autorizada:** também soltaria `captcha_not_allowed` e telas desconhecidas do autenticador, que podem ser verificações reais.
- **Tolerância de tempo para o CAPTCHA, como os 12 s depois do envio da senha:** o CAPTCHA do formulário não some com o tempo; o login só expiraria mais tarde.
- **Deixar como está:** o login com a conta conectada continuaria expirando conforme o momento da leitura.

## Consequências

- Clicar em Jogar com a conta já conectada abre o jogo sem esperar um CAPTCHA que ninguém precisa resolver.
- Uma requisição a mais (`GET /rso-auth/v1/authorization`), só quando o autenticador mostra CAPTCHA.
- O CAPTCHA do formulário deixa de bloquear quando a conta está autorizada. Se a Riot passar a exigir CAPTCHA de uma conta já autorizada sem refletir isso na sessão do jogador, o Eclipse pediria o jogo assim mesmo, e a Riot recusaria o pedido. Hoje nada indica esse caso.
- Login com senha não muda: até a autorização responder 200, o CAPTCHA continua sendo `challenge`, com a tolerância de 12 s do [[signInFlow]].

## Relacionado

- [[riotAuthentication]]
- [[signInFlow]]
- [[Segurança e privacidade]]
- [[Laboratório de velocidade do login]]
