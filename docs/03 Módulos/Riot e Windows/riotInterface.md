---
tipo: módulo
arquivo: src/riot/riotInterface.js
camada: riot
testes: test/riot/riotInterface.test.js
tags: [módulo]
---

# riotInterface

> Garante que exista uma janela da interface oficial do Riot antes do preenchimento nativo do formulário ([[login.ps1]]).

## Responsabilidade

- Abre a interface oficial do Riot (`Riot Client.exe` / `RiotClientUx.exe`) quando o [[signInFlow]] precisa do formulário nativo escondido.
- Não digita nada, não lê credenciais e não decide quando o formulário nativo é usado. Quem decide é o [[signInFlow]], e quem digita é o [[login.ps1]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createInterfaceOpener({ runningGames, localApi, stopClient, launchClient, waitFor, showTimeoutMs, stopTimeoutMs })` | função | Retorna `openInterface`. Prazos padrão de 10 s. |
| `openInterface({ exe, visible, signal, log })` | função async | Devolve `'existing'`, `'shown'` ou `'launched'`. Lança erro se os serviços não pararem. |
| `SHOW_INTERFACE` | string | `/riot-client-lifecycle/v1/show` |

## Sequência

1. Já existe janela de interface → `'existing'`, nada muda.
2. Serviços rodando sem janela (o caso normal: o [[signInFlow]] sobe os serviços com `--headless`):
   1. `POST /riot-client-lifecycle/v1/show` pela API local autenticada.
   2. Espera a janela por até 10 s → `'shown'`.
   3. Sem resposta 2xx ou sem janela: encerra os serviços (`taskkill` em `CLIENT_PROCESSES`) e espera eles saírem.
3. Inicia `RiotClientServices.exe` **sem** `--headless` (`interfaceRequired: true`), oculto se `visible` for falso → `'launched'`.

Cada caminho escreve uma linha no `sign-in.log` pelo `log` recebido.

## Dependências

- Usa: `localApi` do [[riotTransport]], `launchClient` do [[riotProcess]], `runningGames`, `waitFor` e `taskkill` do [[riotClient]].
- Usado por: [[riotClient]], dentro de `typeCredentials`.

## Invariantes e decisões

- **Uma segunda chamada a `RiotClientServices.exe` não abre interface.** Com os serviços já rodando em `--headless`, a nova chamada é repassada à instância existente, e nenhuma janela aparece. Era a causa do erro "The Riot Client window did not open" (corrigido em 2026-10-26): o [[login.ps1]] esperava 60 s por uma janela que nunca vinha.
- **Pedir antes de reiniciar.** O `show` usa a conexão autenticada que o app já tem, sem token em argumento de processo ([[Segurança e privacidade]]). Lançar `Riot Client.exe` direto exigiria passar `--remotingAuthToken` na linha de comando, por isso não é usado.
- **Reiniciar é seguro neste ponto.** O formulário nativo só é usado antes de qualquer envio de senha (API indisponível ou CAPTCHA antes da submissão, ver [[riotAuthentication]]). Encerrar os serviços não perde credenciais enviadas nem uma sessão autenticada, e o `RiotGamesPrivateSettings.yaml` restaurado continua em disco.
- **Nunca dois clientes.** Se os serviços não saírem em 10 s, a abertura falha em vez de iniciar uma segunda instância.
- **Cancelamento antes de cada efeito.** O `signal` é conferido antes do `show`, do encerramento e do lançamento.
- **A janela nova fica escondida pelo monitor.** O [[signInFlow]] chama `windows.hide()` antes do `typeCredentials`; o [[windowGuard.ps1]] oculta a interface assim que ela é criada.

## Testes

`riotInterface.test.js`: janela existente reaproveitada; `show` funcionando sem reinício; `show` falhando (2xx sem janela, 404 ou erro de rede) leva ao reinício com interface oculta; serviços parados iniciam direto com interface; serviços que não param geram erro sem segundo cliente; cancelamento antes de qualquer efeito.

## Pontos de atenção

- **Validado numa instalação real (Riot 142, 2026-10-26 23:00).** O `POST /riot-client-lifecycle/v1/show` abriu a interface a partir dos serviços em `--headless` em 0,8 s (`Riot Client.exe` iniciado pelo próprio serviço), e o [[login.ps1]] preencheu o formulário (`remember:on`). O reinício com interface não foi necessário e continua como reserva, **ainda sem validação real**. O `sign-in.log` mostra o caminho usado: "opened the Riot interface through the background service" ou "restarting it with the interface".
- **O login ainda não chegou ao jogo nesse teste.** 0,7 s depois do preenchimento, o fluxo parou com "The background window guard stopped". É outro problema, do monitor de janelas; ver [[Backlog]].
- O endpoint `/riot-client-lifecycle/v1/show` não é contrato público ([[Limitações conhecidas]]).
