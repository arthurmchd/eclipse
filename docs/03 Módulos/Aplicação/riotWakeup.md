---
tipo: módulo
arquivo: src/core/riotWakeup.js
camada: aplicação
testes: test/core/riotWakeup.test.js
tags: [módulo]
---

# riotWakeup

> Pede a janela da Riot quando ela sai do segundo plano sem abrir nenhuma, para o ícone da bandeja e os atalhos da Riot abrirem no primeiro clique.

## Responsabilidade

O login em segundo plano inicia a Riot com `--headless` ([[signInFlow]]). Depois do jogo, a Riot vai para o segundo plano e, ao voltar, mantém o `--headless`: o primeiro clique no ícone dela na bandeja não abre a janela. Este módulo:

1. observa o `lockfile` da Riot, que ela regrava ao entrar e ao sair do segundo plano;
2. lembra se a Riot estava em segundo plano;
3. quando ela volta sem janela, espera 2 s e, se continua sem janela e sem jogo, pede a janela (`showInterface`).

**Não faz:**

- não age durante um login do Eclipse;
- não age com jogo aberto ou com a janela da Riot aberta;
- não reabre a Riot quando ela entra no segundo plano (o usuário fechou a janela);
- não age numa Riot que não passou pelo segundo plano;
- não reinicia nem encerra a Riot, nem mexe em sessões.

Decisão em [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createRiotWakeup(options)` | função | Devolve `{ start, stop }`. |
| `start()` | função | Começa a observar o `lockfile` e confere uma vez em que modo a Riot está. |
| `stop()` | função | Fecha o watcher e cancela a conferência pendente. Depois disso nada mais roda. |

**`options`:**

- `riot`: o [[riotClient]], com `watchLockfile`, `runningGames`, `sessionState` e `showInterface`.
- `busy`: diz se há login em andamento.
- `log`: grava no `sign-in.log`.
- `setTimeout` e `clearTimeout`: injetáveis nos testes.
- `settleMs`: padrão 1000. Espera depois da mudança no `lockfile`.
- `retryMs`: padrão 1000. Intervalo entre conferências enquanto a Riot ainda carrega.
- `attempts`: padrão 8. Quantas vezes conferir de novo enquanto a Riot ainda carrega.
- `graceMs`: padrão 2000. Tempo para a Riot abrir a própria janela ou um jogo começar.

## Dependências

- Usa: [[riotClient]].
- Usado por: [[main]], só no modo cartões.

## Invariantes e decisões

- **Quatro estados, pela API e pelos processos.**
  - **Fechada:** sem `RiotClientServices`.
  - **Com janela ou jogo:** `Riot Client.exe` ou um jogo rodando.
  - **Aberta sem janela:** o serviço roda e a rota de autenticação responde (`sessionState()` não nulo).
  - **Em segundo plano:** o serviço roda e a rota de autenticação não responde. Conferido em 2026-11-06 na Riot v142: em segundo plano, a API local só responde `/help`, e as rotas de conta dão 404 `RESOURCE_NOT_FOUND`.
- **Só age na volta do segundo plano.**
  - A cada mudança no `lockfile`, o módulo guarda se a Riot estava em segundo plano antes dela.
  - Se não estava e agora está, só anota.
  - Se estava e agora aparece aberta sem janela, a Riot acabou de sair do segundo plano sem janela.
  - Fechar a janela da Riot leva ao segundo plano e nunca a reabre.
- **A Riot leva alguns segundos para carregar.** Logo depois da mudança no `lockfile`, a Riot que está saindo do segundo plano ainda parece estar nele. O módulo confere de novo a cada 1 s, até 8 vezes.
- **2 s de tolerância antes de pedir.** Uma Riot iniciada normalmente abre a própria janela uns 1,6 s depois de sair do segundo plano. Um jogo aberto pelo atalho dele também precisa de um momento para aparecer. Só sem janela e sem jogo depois disso o módulo pede a janela. Pedir a uma Riot que já está abrindo a janela não faz mal: ela só traz a janela para a frente.
- **Pedido sem plano B.** `showInterface` é o `POST /riot-client-lifecycle/v1/show`, o mesmo do "Show" da bandeja da Riot e do "Abrir Riot" do Eclipse ([[riotInterface]]). Se falhar, só o log registra. Diferente do `openInterface`, nada reinicia a Riot, porque isso poderia derrubar um jogo começando.
- **Mudanças seguidas no `lockfile`** substituem a conferência pendente. Uma conferência antiga que termina depois de uma nova mudança é descartada.
- **Login do Eclipse tem prioridade.** `busy()` é conferido antes e depois de cada consulta à Riot. Um login em andamento zera a lembrança do segundo plano, porque ele mesmo fecha e reinicia a Riot.

## Testes

`test/core/riotWakeup.test.js`, com Riot e relógio falsos, cobre:

- janela pedida depois da tolerância quando a Riot sai do segundo plano sem janela;
- novas conferências enquanto a Riot carrega, e desistência depois do limite;
- nenhum pedido quando a Riot abre a própria janela, um jogo começa, um login começa ou a Riot fecha durante a tolerância;
- nenhum pedido ao entrar no segundo plano ou numa Riot que não passou por ele, e Riot fechada sem consulta à API;
- login que começa durante a conferência, pedido que falha (só log) e falha ao listar processos;
- mudança nova substituindo a pendente, e `stop`.

Fora dos testes: o `fs.watch` real do `lockfile` e o tempo real da Riot para sair do segundo plano.

## Pontos de atenção

- **A janela aparece uns 3 a 5 s depois do clique,** por causa da carga da Riot e da tolerância.
- **Com o Eclipse fechado,** a Riot iniciada sem janela volta a precisar de dois cliques.
- **Depende de a Riot regravar o `lockfile` ao trocar de modo** e de a rota de autenticação não existir no segundo plano. Se uma versão nova mudar isso, o módulo para de agir (falha segura: volta ao comportamento da Riot).
- **Abrir o LoL pelo atalho dele** com a Riot sem janela em segundo plano pode mostrar a Riot ao lado do jogo, se o LoL demorar mais de 2 s para aparecer.
