---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, sessão, processos, janelas]
---

# ADR-026 Riot fechada depois do jogo reabre na tela de login

Complementa [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]. Abre uma segunda exceção à regra de [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]], pela qual o Eclipse não inicia a Riot fora de um login.

## Contexto

Relato do usuário em 2026-11-06:

> apos eu entrar no lol, sair, entrar novamente no riot client apos o fechamento do lol eu ainda estou conectado a minha conta e depois de alguns segundos o riot client e fecha

Os logs reais (lidos sem alterar nada) mostram a sequência duas vezes, às 19:36 e às 19:37 (horário local):

- O usuário clica no ícone da Riot na bandeja (`SystemTrayPlugin`, `Show`) enquanto o League ainda fecha.
- A Riot abre a janela com a conta conectada. Ela só passa ao modo segundo plano, soltando a conta, quando não há janela aberta ([[ADR-021 Riot sempre abre desconectada]]). Com a janela aberta, ela fica conectada ("Other session(s) are still running, so not quitting").
- O [[sessionKeeper]] vê a Riot conectada depois de um jogo e pede a saída normal, como manda a [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]. A Riot some de 6 a 10 s depois de aberta.
- Quando o usuário abre de novo, a Riot aparece desconectada, com os cartões.

A ADR-020 já previa esse fechamento como consequência aceita. Para quem vê, porém, parece que a Riot travou: ele abriu a Riot e ela sumiu sozinha.

## Decisão

- **O guardião marca a reabertura.** Quando o [[sessionKeeper]] pede a saída normal de uma Riot conectada que estava com a interface aberta (`Riot Client.exe` rodando), ele marca uma reabertura. Na prática isso só acontece depois de um jogo, porque antes de um jogo uma Riot com janela nunca é encerrada.
- **Reabre só depois que a Riot fechou e o arquivo foi limpo.** Nas olhadas seguintes (a cada 4 s, no máximo 5), o guardião espera duas coisas: nenhum processo da Riot rodando e nenhum login lembrado no arquivo, já guardado na conta e limpo. Aí ele inicia a Riot com a interface (`startClient`). Ela abre desconectada, na tela de login com os cartões.
- **Nunca mexe numa Riot aberta.** `startClient` só inicia a Riot se nenhum processo dela estiver rodando. Se o usuário já a abriu de novo, ou se ela não saiu, nada acontece. Nunca há `taskkill` nem reinício.
- **Cancela quando outra coisa assume.** Login em andamento, "Manter login" desligado, Eclipse fechando ou um jogo abrindo cancelam a reabertura. Depois de 5 olhadas sem a Riot fechar e o arquivo ficar limpo, o guardião desiste e registra isso no log.
- **Riot fechada sem janela não reabre.** Se a Riot estava em segundo plano ou sem janela, o usuário não a tinha aberto, e ela continua fechada.
- **Log sem dados da conta.** As linhas dizem só que a Riot foi reaberta, que não deu para reabrir ou que o guardião desistiu.

## Alternativas consideradas

- **Deixar a Riot conectada enquanto a janela está aberta.** Os cartões só aparecem na tela de login. Para trocar de conta, o usuário sairia da conta pela Riot, e isso encerra a sessão no servidor, o problema que a ADR-020 resolveu.
- **Sair da conta pelo Eclipse (`DELETE /rso-auth/v1/session`) e manter a Riot aberta.** Também encerra a sessão no servidor.
- **Pedir à Riot que solte a conta sem sair.** Não há pedido conhecido no serviço local que faça isso sem encerrar a sessão. Não foi verificado.
- **Esconder a janela antes da saída e mostrar só a nova.** Mais passos para o mesmo resultado: a Riot ainda some por alguns segundos.
- **Não fazer nada.** É o comportamento da ADR-020: a Riot some e o usuário precisa abri-la de novo.

## Consequências

- **A Riot aberta logo depois do jogo** mostra a conta por alguns segundos, fecha e volta sozinha uns 5 a 10 s depois, desconectada e com os cartões.
- **Nova exceção na regra de processos.** Fora de um login, o Eclipse agora também inicia a Riot, mas só neste caso e só com ela totalmente fechada ([[Segurança e privacidade]]).
- **Nada muda com a Riot sem janela,** nem antes de um jogo, nem com "Manter login" desligado.
- **Se a Riot não for encontrada** (caminho errado), a reabertura falha em silêncio para o usuário e só deixa uma linha no log.

## Relacionado

- [[sessionKeeper]]
- [[riotClient]]
- [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]
- [[ADR-021 Riot sempre abre desconectada]]
- [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]
- [[Segurança e privacidade]]
