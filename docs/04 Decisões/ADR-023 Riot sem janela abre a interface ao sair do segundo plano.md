---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, processos, interface]
---

# ADR-023 Riot sem janela abre a interface ao sair do segundo plano

Complementa [[ADR-019 Sessão salva por conta no modo cartões]].

## Contexto

Pedido do usuário em 2026-11-06:

> sempre que vou abir o riot client pela barra de tarefas sempre tenho que abrir duas vezes, na primeira vez quando eu clico para abrir ele some a aparece rapidamente e nao acontece nada dele abrir, na segunda vez ele abre normalmente

O clique é no ícone da Riot na bandeja do Windows. O log da Riot v142 mostra a causa.

- **O login em segundo plano inicia a Riot com `--headless`.** Com sessão salva, o login sobe só os serviços da Riot, sem interface, para nenhuma janela aparecer ([[signInFlow]]).
- **Depois do jogo, a Riot vai para o segundo plano.** Ela continua com o ícone na bandeja.
- **Ao voltar, ela mantém o `--headless`.** O primeiro clique no ícone tira a Riot do segundo plano ("We are now in AppFull"), e o ícone é recriado: ele some e volta. Como a Riot foi iniciada com `--headless`, ela volta sem abrir a janela. Uma Riot iniciada normalmente abre a janela nesse momento ("launch default product").
- **Só o segundo clique abre a janela** ("SystemTrayPlugin Show").
- **O atalho da área de trabalho também falha.** Às 14:31, duas aberturas por ele só repassaram o pedido para a Riot sem janela, e nada apareceu.

Riots abertas normalmente (14:13) abriram no primeiro clique.

## Decisão

- **Novo módulo [[riotWakeup]] no modo cartões.** Ele observa o `lockfile` da Riot (`Config\lockfile`), que a Riot regrava ao entrar e ao sair do segundo plano.
- **Como reconhece cada modo.**
  - **Segundo plano:** `RiotClientServices` rodando, sem janela, sem jogo e sem resposta da rota de autenticação (`sessionState()` nulo). Em segundo plano, a API local só responde `/help`; as rotas de conta dão 404 `RESOURCE_NOT_FOUND`.
  - **Aberta sem janela:** mesmas condições, mas a rota de autenticação responde.
- **Quando pede a janela.** Se a Riot estava em segundo plano e, depois de uma regravação do `lockfile`, aparece aberta sem janela, o módulo espera 2 s. Nesse tempo, uma Riot normal abriria a própria janela, ou um jogo começaria a abrir. Se continua sem janela e sem jogo, o módulo pede a janela com `POST /riot-client-lifecycle/v1/show`, o mesmo pedido do segundo clique e do "Abrir Riot" do Eclipse.
- **Quando nunca age.**
  - durante um login do Eclipse;
  - com jogo aberto;
  - com a janela da Riot aberta;
  - quando a Riot entra no segundo plano (fechar a janela nunca a reabre);
  - quando a Riot é aberta sem ter passado pelo segundo plano.
- **Sem plano B que reinicie a Riot.** Se o pedido falhar, só o log registra. Reiniciar poderia derrubar um jogo que estivesse começando.

## Alternativas consideradas

- **Iniciar a Riot sem `--headless`:** ela abriria a janela no login em segundo plano, e o usuário veria a Riot antes do jogo.
- **Encerrar a Riot sem janela quando ela entra no segundo plano:** o ícone da bandeja sumiria, e o usuário perderia o jeito como abre a Riot.
- **Ler a linha de comando do processo para saber se tem `--headless`:** exige WMI e leria parâmetros sensíveis da Riot (o token da API local). A espera de 2 s cobre os dois casos sem isso.

## Consequências

- **Um clique no ícone da bandeja abre a Riot.** A janela aparece uns 3 a 5 s depois, porque o Eclipse espera a Riot terminar de sair do segundo plano e mais 2 s.
- **O atalho da área de trabalho também passa a abrir a Riot nesse estado.**
- **Abrir o LoL pelo atalho dele, com a Riot sem janela em segundo plano,** pode mostrar a Riot ao lado do jogo, se o LoL demorar mais de 2 s para aparecer.
- **O Eclipse fechado não ajuda:** a Riot sem janela volta a precisar de dois cliques.
- **Não mexe na instalação da Riot nem em processos.** Só faz leituras na API local e o pedido de mostrar a janela.

## Relacionado

- [[riotWakeup]]
- [[riotClient]]
- [[riotInterface]]
- [[main]]
