---
tipo: memória
categoria: projeto
criada: 2026-11-21
atualizada: 2026-11-21
tags: [memória, login, desempenho]
---

# Laboratório de velocidade do login

Na madrugada de 2026-11-21 (01:33 a 02:04) o agente mediu o login na Riot real com um programa à parte (`speedlab`, fora do repositório), três rodadas, só contas sem 2FA. A digitação foi aplicada na 2.18.0; a troca de conta por logout foi descartada (ADR-020).

**Por quê:** o usuário quer acelerar o login; a autorização para usar a Riot real valeu só para essa medição ([[Testes sem o usuário]]).

**Como aplicar:** antes de mexer na velocidade do login, partir destes números em vez de medir de novo. Uma nova medição na Riot real precisa de nova autorização.

## Resultados (medianas, até o Eclipse ver o League)

| Cenário | Total |
|---|---|
| Riot aberta na tela de login, senha digitada | 34,7 s |
| Sessão salva | 30,9 s |
| Riot fechada, senha digitada | 40,1 s |
| Conta já logada | 25,6 s (1 de 3; 2 estouraram o prazo de 180 s) |

Etapas do login com senha: 7,8 s até enviar a senha, 2 s até a Riot autorizar, cerca de 13 s até o pedido do jogo responder, cerca de 10,5 s até a janela do League aparecer e 1,4 s até o Eclipse perceber.

- **Digitação da senha:** o script antigo enviava em 6,9 s. Por UI Automation com Enter, envia em 0,3 s; com a caixa "Stay signed in" e o clique, em 1,1 s. A autorização da Riot depois do envio fica em torno de 2,5 s em todas as variantes. Aplicado na 2.18.0 com o clique e a caixa mantidos ([[ADR-043 Preenchimento do login por UI Automation]]); o Enter ficou de fora. Conferido na Riot real em 2026-11-21: a 2.18.0 caía sempre em `input:keys` (valor assíncrono no Chromium e campo de busca do Eclipse dentro da janela da Riot); a 2.18.1 corrigiu, 6 de 6 com `input:uia`. Ganho real de cerca de 4 s por login (37,5 s contra 42 s no mesmo dia, Riot na tela de login). Os totais do mesmo dia saíram cerca de 3 s acima dos da madrugada também na parte depois do envio, então só vale comparar medições da mesma sessão.
- **Troca de conta:** sair pela API de logout deixa o formulário pronto em 0,9 s; reiniciar a Riot leva 10 s. Não aplicado: a "API de logout" do laboratório era `DELETE /rso-auth/v1/session`, que encerra no servidor a sessão de quem sai e mata a sessão guardada dela, exatamente o que a [[ADR-020 Riot conectada é encerrada quando fica sem jogo]] proíbe. Verificado em 2026-11-21; não propor de novo sem uma saída que não encerre a sessão no servidor.
- **Pedido do jogo:** pular a checagem de elegibilidade faz o pedido responder em 4 s, mas o `LeagueClient.exe` começa no mesmo segundo 13. Sem ganho.
- **Abrir o jogo pela linha de comando:** falhou nas três tentativas em 5 ms, sem conclusão.
- **Da janela do League em diante:** é tempo do próprio jogo.
- **Conta já logada:** o fluxo real estourou o prazo em 2 de 3 tentativas. Investigado em 2026-11-21: é defeito do Eclipse. Com a conta reaproveitada, `run` em `sign_in_flow.rs` ainda lê o estado de autenticação; veio `challenge` 0,3 s depois e ficou assim por 180 s, enquanto a Riot dizia autorizado com o Riot ID certo. Esse `challenge` pode vir do autenticador (formulário com objeto `captcha`) ou de um `loginState` fora de `NON_BLOCKING_SESSION_STATES`; o laboratório não guardou qual. O `sign-in.log` real não tem nenhum reaproveitamento, então ainda não atingiu o usuário. Desde a 2.17.1 o `sign-in.log` grava a fonte ("Riot reported an unfinished sign-in (…)"). Reproduzido em 2026-11-21 às 11:34 (1 trava em 2 tentativas): o log disse "authenticator captcha: hcaptcha". Com a conta conectada, o autenticador primeiro respondeu `auth` sem CAPTCHA e, cerca de 1 s depois, `auth` com `hcaptcha`, enquanto `/rso-auth/v1/authorization` dava 200 e o `loginState` era `pendingproductcontext`, que é liberado. O autenticador descreve o formulário do próximo login, não a sessão atual. Corrigido na 2.17.2 ([[ADR-042 CAPTCHA do formulário não bloqueia conta autorizada]]). A digitação foi aplicada na 2.18.0. A troca de conta por logout ficou de fora por causa da ADR-020.

## Relacionado

- [[Memória]]
- [[signInFlow]]
