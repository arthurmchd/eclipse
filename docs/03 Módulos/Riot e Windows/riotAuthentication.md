---
tipo: módulo
arquivo: src/riot/riotAuthentication.js
camada: riot
testes: test/riot/riotAuthentication.test.js, test/riot/authContextRegression.test.js
tags: [módulo]
---

# riotAuthentication

> Login direto pela API local do Riot Client e leitura do estado de sessão, devolvendo só valores fixos ao [[signInFlow]].

## Responsabilidade

- Envia usuário e senha uma única vez por tentativa à rota `rso-authenticator` do serviço local.
- Normaliza o estado de autenticação em poucos tipos fixos.
- Não espera autorização, não confere o Riot ID e não abre jogo. Isso é do [[signInFlow]].
- Não resolve 2FA nem CAPTCHA: devolve um pedido de atenção ou de formulário nativo.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createRiotAuthentication({ request })` | função | Exige `request` (o `localApi` do [[riotTransport]]). Retorna `{ authenticate, sessionState }`. |
| `authenticate(account, signal)` | função async | Ver resultados abaixo. Lança erros com mensagens fixas. |
| `sessionState(signal)` | função async | `{ type, error? }` normalizado. HTTP 429 vira `{ type: 'error', error: 'rate_limited' }`; outro status diferente de 200 vira `null`. Lança erro se a sessão do jogador não puder ser confirmada. |

Resultados de `authenticate`:

| Resultado | Significado |
|---|---|
| `{ supported: false }` | Rota indisponível (404, 405 ou 501). O fluxo pode usar o formulário nativo. |
| `{ supported: true }` | Pedido aceito ou já autenticado. Não garante a conta certa. |
| `{ supported: true, needsAttention: true, reason }` | `reason` é `multifactor` ou `challenge`. |
| `{ supported: true, requiresNativeForm: true, reason: 'captcha' }` | CAPTCHA antes de qualquer senha enviada. |

Estados normalizados: `auth`, `authenticated`, `multifactor`, `challenge`, `error`. Erros possíveis: `auth_failure`, `rate_limited`, `captcha_not_allowed`, `invalid_request`, `authentication_error`.

## Rotas usadas

| Rota | Uso |
|---|---|
| `GET /rso-authenticator/v1/authentication` | Estado e contexto atual. |
| `DELETE /rso-authenticator/v1/authentication` | Reinicia o autenticador. |
| `POST .../riot-identity/start` | Cria contexto: `{ language: 'en_US', productId: 'riot-client', state: 'auth', intendedProductId: '' }`, 15 s. |
| `POST .../riot-identity/complete` | Envia `{ username, password, remember: true, language: 'en_US', captcha: '' }`, 30 s. |
| `GET /rso-auth/v1/session` | Estado em clientes antigos, só leitura. |
| `GET /player-session-lifecycle/v1/session` | `loginState` da sessão do jogador. |

## Dependências

- Usa: só a função `request` injetada ([[riotTransport]]).
- Usado por: [[riotClient]], que entrega `authenticate` e `sessionState` ao [[signInFlow]].

## Sequência de `authenticate`

1. Valida a conta: strings não vazias, até 256 caracteres, sem CR, LF ou NUL. Senão "Add the username and password first", sem nenhuma requisição.
2. `GET` do estado. 405 ou 501 → sem suporte. 404 → sem estado.
3. Com estado: CAPTCHA, 2FA ou desafio retornam na hora. `authenticated` retorna sucesso sem enviar nada. `rate_limited` e `authentication_error` lançam erro. Um `auth_failure` antigo não lança: leva ao reset.
4. Sem estado, com estado `error` ou sem contexto ativo: `DELETE`. 405/501 → sem suporte; 429 → erro; outra falha (exceto 404) → "Riot could not initialize sign-in". Depois `start`: 404/405/501 → sem suporte. Resposta 202/204 vazia leva a um novo `GET`.
5. Confere de novo CAPTCHA, desafio e falhas. Estado diferente de `auth` lança "Riot needs your attention. Open Riot Client to continue".
6. Checa cancelamento e envia `complete` uma vez. Desafio na resposta vira pedido de atenção; falha lança erro.

## Invariantes e decisões

- **Só valores fixos saem do módulo.** As respostas podem ter tokens, nomes de usuário, dados de desafio e mensagens de erro vindas do usuário. Nada disso passa adiante.
- **Tela de verificação desconhecida vira `challenge`.** Ela não pode receber envio automático de senha. O cliente normal mostra a ação necessária.
- **CAPTCHA antes do envio usa o formulário nativo.** Esta operação ainda não enviou credenciais. O formulário nativo segue o caminho normal de CAPTCHA, em vez de enviar um token vazio.
- **Corpos de erro não são confiáveis.** Só códigos conhecidos (tabela `SAFE_ERRORS`) mudam a mensagem. Diagnósticos do servidor e dados ecoados nunca entram nela.
- **Identidade autenticada não basta.** A sessão do jogador ainda pode pedir consentimento, verificação de idade ou outra tela. Um token de autorização já emitido não pode pular essas ações. Por isso `sessionState` consulta `player-session-lifecycle` quando o estado é `authenticated`.
- **`Initializing` e `PendingProductContext` não são telas de verificação.** O contexto de produto pode vir depois, no pedido de abertura do jogo já verificado.
- **Contexto existe só com `suuid`.** Um `GET` bem-sucedido pode mostrar o objeto `auth` padrão sem contexto de login. Só um `suuid` não vazio (até 256 caracteres, sem controle nem espaço) confirma o contexto. O tipo sozinho não basta depois de um reinício `--headless`.
- **Reiniciar antes de começar, como o formulário nativo.** O backend recusa `start` com o autenticador em estado de erro. Esse `DELETE` acontece antes de qualquer envio de credenciais nesta tentativa.
- **Sucesso de transporte só confirma o pedido.** O [[signInFlow]] espera a autorização e verifica o Riot ID por conta própria.
- **Uma senha por chamada.** `complete` é chamado no máximo uma vez. Falha de senha, limite, rede ou CAPTCHA depois do envio nunca geram nova tentativa.
- **Erros fixos.** Rede: "Could not contact the Riot authentication service". Formato inválido: "The Riot authentication service returned an invalid response". HTTP 429: "Too many attempts, wait a few minutes".
- **Cancelamento antes e depois de cada requisição.** Cancelar após o `DELETE` impede o `start` e o envio da senha.
- **`remember: true` sempre.** O cliente grava o login lembrado que o app guarda por conta ([[Armazenamento e dados]]).

## Testes

- `riotAuthentication.test.js`: envio único; contexto ausente ou antigo; reset com falha; rotas indisponíveis; 2FA e telas humanas sem senha; CAPTCHA antes e depois do envio; limite de tentativas; erros sem eco da resposta; estado já autenticado; estados da sessão do jogador; cancelamento; entradas inválidas.
- `authContextRegression.test.js`: `suuid` vazio ou ausente exige `DELETE` + `start` antes da senha; `invalid_request` inicial é limpo; `invalid_request` após o envio não repete nem reinicia.

## Pontos de atenção

- **Segundo envio possível.** Se `complete` responde 404, 405 ou 501, a senha já foi enviada, mas o retorno é `{ supported: false }`. O [[signInFlow]] então digita a senha no formulário nativo. O teste "unavailable routes" confirma esse retorno.
- **`loginState` desconhecido passa como autenticado.** Em `sessionState`, só `pendingmultifactor` e a lista `HUMAN_SESSION_STEPS` bloqueiam. Um estado novo da Riot passaria. É o oposto do padrão seguro de `normalizeState`.
- **Listas de estados dependem da Riot.** `HUMAN_STEPS`, `HUMAN_SESSION_STEPS` e `SAFE_ERRORS` precisam de revisão a cada versão: [[Atualização do Riot Client]].
- **Idioma fixo.** `language: 'en_US'` em `start` e `complete`.
- Regras gerais: [[Segurança e privacidade]], [[Fluxo de login]].
