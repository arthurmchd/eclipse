---
tipo: módulo
arquivo: src-tauri/src/riot/riot_interface.rs
camada: riot
testes: src-tauri/tests/riot/riot_interface.rs
tags: [módulo]
---

# riotInterface

> Garante que exista uma janela da interface oficial do Riot antes do preenchimento nativo do formulário ([[login.ps1]]).

## Responsabilidade

- Abre a interface oficial do Riot (`Riot Client.exe` / `RiotClientUx.exe`) quando o [[signInFlow]] precisa do formulário nativo, sempre visível desde 2026-11-07.
- Não digita nada, não lê credenciais e não decide quando o formulário nativo é usado. Quem decide é o [[signInFlow]], e quem digita é o [[login.ps1]].

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `InterfaceOpener` | struct | Recebe processos abertos (`running_games`), a API local do [[riotTransport]], parada, início e espera como funções, e os prazos `show_timeout_ms` e `stop_timeout_ms` (10 s) |
| `open(exe, cancel, log)` | método | Devolve `Opened::Existing`, `Shown` ou `Launched`. Erro se os serviços não pararem |
| `wait_for(sonda, prazo, intervalo)` | função | Repete uma sonda até dar certo ou o prazo acabar |
| `SHOW_INTERFACE` | constante | `/riot-client-lifecycle/v1/show` |

## Sequência

1. Já existe janela de interface → `'existing'`, nada muda.
2. Serviços rodando sem janela (o caso normal: o [[signInFlow]] sobe os serviços com `--headless`):
   1. `POST /riot-client-lifecycle/v1/show` pela API local autenticada.
   2. Espera a janela por até 10 s → `'shown'`.
   3. Sem resposta 2xx ou sem janela: encerra os serviços (`taskkill` em `CLIENT_PROCESSES`) e espera eles saírem.
3. Inicia `RiotClientServices.exe` **sem** `--headless`, com a janela visível (`visible: true`) → `'launched'`.

Cada caminho escreve uma linha no `sign-in.log` pelo `log` recebido.

## Dependências

- Usa: a API local do [[riotTransport]], `launch_client` do [[riotProcess]], e processos abertos, espera e `taskkill` do [[riotClient]].
- Usado por: [[riotClient]], antes de digitar as credenciais no formulário nativo.

## Invariantes e decisões

- **Uma segunda chamada a `RiotClientServices.exe` não abre interface.** Com os serviços já rodando em `--headless`, a nova chamada é repassada à instância existente, e nenhuma janela aparece. Era a causa do erro "The Riot Client window did not open" (corrigido em 2026-10-26): o [[login.ps1]] esperava 60 s por uma janela que nunca vinha.
- **Pedir antes de reiniciar.** O `show` usa a conexão autenticada que o app já tem, sem token em argumento de processo ([[Segurança e privacidade]]). Lançar `Riot Client.exe` direto exigiria passar `--remotingAuthToken` na linha de comando, por isso não é usado.
- **Reiniciar é seguro neste ponto.** O formulário nativo só é usado antes de qualquer envio de senha (API indisponível ou CAPTCHA antes da submissão, ver [[riotAuthentication]]). Encerrar os serviços não perde credenciais enviadas nem uma sessão autenticada, e o `RiotGamesPrivateSettings.yaml` restaurado continua em disco.
- **Nunca dois clientes.** Se os serviços não saírem em 10 s, a abertura falha em vez de iniciar uma segunda instância.
- **Cancelamento antes de cada efeito.** O `signal` é conferido antes do `show`, do encerramento e do lançamento.
- **A janela nova fica visível.** Desde 2026-11-07 nada a esconde, e a opção de abrir escondida saiu: a interface sempre abre visível. Antes, o [[signInFlow]] escondia as janelas antes de digitar as credenciais, e o monitor do [[windowGuard.ps1]] ocultava a interface assim que ela era criada.

## Testes

`src-tauri/tests/riot/riot_interface.rs`: janela existente reaproveitada sem reiniciar nada; serviços em `--headless` recebendo o `show` antes de qualquer reinício; `show` que não abre janela levando ao reinício com interface visível; serviços parados iniciando direto com interface visível; serviços que não param gerando erro sem segundo cliente; cancelamento antes de mostrar, reiniciar ou iniciar.

## Pontos de atenção

- **Validado numa instalação real (Riot 142, 2026-10-26 23:00).** O `POST /riot-client-lifecycle/v1/show` abriu a interface a partir dos serviços em `--headless` em 0,8 s (`Riot Client.exe` iniciado pelo próprio serviço), e o [[login.ps1]] preencheu o formulário (`remember:on`). O reinício com interface não foi necessário e continua como reserva, **ainda sem validação real**. O `sign-in.log` mostra o caminho usado: "opened the Riot interface through the background service" ou "restarting it with the interface".
- **O login ainda não chegou ao jogo nesse teste.** 0,7 s depois do preenchimento, o fluxo parou com "The background window guard stopped". Era outro problema, do monitor de janelas, que saiu em 2026-11-07 ([[ADR-028 Modo antigo removido]]).
- O endpoint `/riot-client-lifecycle/v1/show` não é contrato público ([[Limitações conhecidas]]).
