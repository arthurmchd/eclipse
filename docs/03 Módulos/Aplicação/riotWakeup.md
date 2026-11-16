---
tipo: módulo
arquivo: src-tauri/src/application/riot_wakeup.rs
camada: aplicação
testes: src-tauri/tests/application/riot_wakeup.rs
tags: [módulo]
---

# riotWakeup

> Pede a janela da Riot quando ela sai do segundo plano sem abrir nenhuma, para o ícone da bandeja e os atalhos da Riot abrirem no primeiro clique.

## Responsabilidade

O login em segundo plano inicia a Riot com `--headless` ([[signInFlow]]). Depois do jogo, a Riot vai para o segundo plano e, ao voltar, mantém o `--headless`: o primeiro clique no ícone dela na bandeja não abre a janela. Este módulo:

1. observa o `lockfile` da Riot, que ela regrava ao entrar e ao sair do segundo plano;
2. lembra se a Riot estava em segundo plano;
3. quando ela volta sem janela, espera 2 s e, se continua sem janela e sem jogo, pede a janela (`show_interface`).

**Não faz:**

- não age durante um login do Eclipse;
- não age com jogo aberto ou com a janela da Riot aberta;
- não reabre a Riot quando ela entra no segundo plano (o usuário fechou a janela);
- não age numa Riot que não passou pelo segundo plano;
- não reinicia nem encerra a Riot, nem mexe em sessões.

Decisão em [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]].

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `RiotWakeup::new(riot, busy, log, timers, timing)` | construtor | `riot` é a trait `WakeupRiot` (observar o `lockfile`, olhar o modo e pedir a janela), que o [[riotClient]] implementa; `busy` diz se há login; `log` grava no `sign-in.log`; os prazos vêm do [[timers]] |
| `start()` | método | Começa a observar o `lockfile` e confere uma vez em que modo a Riot está. Só vale uma vez |
| `stop()` | método | Solta o observador e cancela a conferência pendente. Depois disso nada mais roda |
| `WakeupTiming` | struct | `settle` 1 s depois da mudança no `lockfile`, `retry` 1 s entre conferências enquanto a Riot carrega, até 8 `attempts`, e `grace` 2 s para a Riot abrir a própria janela ou um jogo começar |

## Dependências

- Usa: [[riotClient]].
- Usado por: [[main]].

## Invariantes e decisões

- **Estados pelo [[riotState]].** Desde 2026-11-07 ([[ADR-029 Estado da Riot definido num lugar só]]), cada conferência pede o modo a uma olhada do [[riotState]]. Antes o módulo tinha os próprios modos `closed`, `shown`, `hidden` e `background`; agora são os do [[riotState]], com as mesmas consultas na mesma ordem.
  - **Fechada (`closed`):** sem processo da Riot.
  - **Com janela ou jogo (`window`, `game`):** `Riot Client.exe` ou um jogo rodando. Para o wakeup, as duas valem igual.
  - **Aberta sem janela (`hidden`):** o serviço roda e a rota de autenticação responde (estado da sessão não nulo).
  - **Em segundo plano (`background`):** o serviço roda e a rota de autenticação não responde. Conferido em 2026-11-06 na Riot v142: em segundo plano, a API local só responde `/help`, e as rotas de conta dão 404 `RESOURCE_NOT_FOUND`.
- **Só age na volta do segundo plano.**
  - A cada mudança no `lockfile`, o módulo guarda se a Riot estava em segundo plano antes dela.
  - Se não estava e agora está, só anota.
  - Se estava e agora aparece aberta sem janela, a Riot acabou de sair do segundo plano sem janela.
  - Fechar a janela da Riot leva ao segundo plano e nunca a reabre.
- **A Riot leva alguns segundos para carregar.** Logo depois da mudança no `lockfile`, a Riot que está saindo do segundo plano ainda parece estar nele. O módulo confere de novo a cada 1 s, até 8 vezes.
- **2 s de tolerância antes de pedir.** Uma Riot iniciada normalmente abre a própria janela uns 1,6 s depois de sair do segundo plano. Um jogo aberto pelo atalho dele também precisa de um momento para aparecer. Só sem janela e sem jogo depois disso o módulo pede a janela. Pedir a uma Riot que já está abrindo a janela não faz mal: ela só traz a janela para a frente.
- **Pedido sem plano B.** O pedido é o `POST /riot-client-lifecycle/v1/show`, o mesmo do "Show" da bandeja da Riot e do "Abrir Riot" do Eclipse ([[riotInterface]]). Se falhar, só o log registra. Diferente da abertura completa da interface, nada reinicia a Riot, porque isso poderia derrubar um jogo começando.
- **Mudanças seguidas no `lockfile`** substituem a conferência pendente. Uma conferência antiga que termina depois de uma nova mudança é descartada.
- **Login do Eclipse tem prioridade.** O login em curso é conferido antes e depois de cada consulta à Riot. Um login em andamento zera a lembrança do segundo plano, porque ele mesmo fecha e reinicia a Riot.
- **Observador sem prender o serviço.** O observador do `lockfile` guarda só uma referência fraca ao serviço, para não prendê-lo na memória; parar é soltar o observador.

## Testes

`src-tauri/tests/application/riot_wakeup.rs`, com Riot e relógio falsos, cobre:

- janela pedida depois da tolerância quando a Riot sai do segundo plano sem janela;
- novas conferências enquanto a Riot carrega, e desistência depois do limite;
- nenhum pedido quando a Riot abre a própria janela, um jogo começa ou um login está em curso;
- nenhum pedido ao entrar no segundo plano ou numa Riot que não passou por ele;
- login que começa durante a conferência, pedido que falha e falha ao listar processos, só com log;
- mudança nova substituindo a pendente, e `stop` soltando o observador e cancelando o que estava pendente.

Fora dos testes: o observador real do `lockfile` e o tempo real da Riot para sair do segundo plano.

## Pontos de atenção

- **A janela aparece uns 3 a 5 s depois do clique,** por causa da carga da Riot e da tolerância.
- **Com o Eclipse fechado,** a Riot iniciada sem janela volta a precisar de dois cliques.
- **Depende de a Riot regravar o `lockfile` ao trocar de modo** e de a rota de autenticação não existir no segundo plano. Se uma versão nova mudar isso, o módulo para de agir (falha segura: volta ao comportamento da Riot).
- **Abrir o LoL pelo atalho dele** com a Riot sem janela em segundo plano pode mostrar a Riot ao lado do jogo, se o LoL demorar mais de 2 s para aparecer.
