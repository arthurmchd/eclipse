---
tipo: decisão
status: aceita
data: 2026-11-07
tags: [adr, sessão, login]
---

# ADR-027 Saída da conta pela Riot apaga a sessão guardada

Complementa [[ADR-019 Sessão salva por conta no modo cartões]] e [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]. É o item 6 da análise de remendos de 2026-11-06.

## Contexto

Sair da conta pela Riot (ou pelo "Sign Out" do League) encerra a sessão no servidor. Até aqui, o Eclipse só descobria isso no Jogar seguinte dessa conta: fechava a Riot, tentava a sessão guardada, esperava a recusa e reabria a Riot para o login visível. Para o usuário, "a Riot reiniciou".

Os logs reais da Riot v142 de 2026-11-06 (lidos sem alterar nada) separam os dois jeitos de a Riot ficar sem conta:

- **Saída manual** (`clickSignOut`, duas vezes no log das 16:25). A Riot regrava na hora o login lembrado no arquivo ("Updated private settings … psl.authorization.riot-client"), apaga a autorização (`DeleteAuthorization`) e volta à tela de login (`PendingLoginStrategy`). O processo continua aberto.
- **Fim do jogo em segundo plano.** A Riot também apaga a autorização da memória ("Successfully deleted RSO authorization"), mas **não** regrava o login lembrado no arquivo ([[ADR-021 Riot sempre abre desconectada]]).

A análise sugeria apoiar isso num serviço único de estado da Riot (item 4). O sinal do arquivo já basta para este caso.

## Decisão

- **O guardião lembra qual conta a Riot está segurando.** Quando uma conferência acha no arquivo o login de uma conta do Eclipse e a Riot está conectada, o [[sessionKeeper]] guarda essa versão, como antes, e anota a conta e a versão.
- **O arquivo perde o login com a Riot aberta: foi uma saída.** Se, depois disso, o arquivo aparece sem login, o guardião confirma duas coisas antes de agir:
  - a Riot continua rodando;
  - o serviço local responde "sem conta" (`authorization() === 'no'`).

  Também confere que o arquivo continua sem login e que a sessão guardada da conta ainda é a versão anotada. Aí apaga essa sessão (`store.forgetSession`), avisa o cartão e registra no log, sem dados da conta.
- **A olhada nos processos confere de novo.** Se o aviso do Windows falhar, ou se a resposta da Riot vier desconhecida, a olhada seguinte (a cada 4 s) faz a mesma conferência.
- **A anotação some quando outra coisa pode ter mexido no arquivo.** Isso acontece num login em andamento, no `keep()` chamado pelo fechamento de um login, quando o próprio guardião limpa o arquivo, quando a Riot fecha ou quando ela aparece conectada sem login no arquivo. Sem anotação, nada é apagado.
- **Nada muda na Riot.** O guardião não fecha nem reabre a Riot por causa disso. Ela já está na tela de login, com os cartões.

## Alternativas consideradas

- **Olhar só a API (conectada → sem conta).** O fim do jogo em segundo plano faz a mesma transição e não mata a sessão. A API sozinha apagaria sessões boas.
- **Ler o log da Riot.** Funciona, mas lê o arquivo de outro programa, com dados pessoais, e depende do texto do log.
- **Testar a sessão em segundo plano antes do Jogar.** Exige reiniciar a Riot, o problema que se quer evitar.
- **Fazer agora o serviço único de estado (item 4).** Reescreveria o guardião e o [[riotWakeup]], que acabaram de passar por testes reais, sem trazer um sinal melhor. A base certa para esse serviço é o canal de eventos da API local, se ele existir, e isso ainda precisa ser conferido na Riot real (passo 4 da análise).

## Consequências

- **Depois de uma saída pela Riot, o próximo Jogar dessa conta vai direto ao login visível,** sem fechar e reabrir a Riot. O ⚡ do cartão some na hora.
- **Uma sessão encerrada pelo servidor** (expirada ou revogada) e limpa pela Riot também é apagada.
- **Se a detecção falhar,** o comportamento é o anterior: uma recusa e um reinício no próximo Jogar. Isso acontece com a Riot fechada menos de 1 s depois da saída, com o Eclipse fechado durante a saída ou com a Riot respondendo "desconhecido" até fechar.
- **Uma saída falsa custa um login visível,** com senha e talvez 2FA. Por isso a regra exige o arquivo e a API juntos.

## Revisão de 2026-11-26: jogo aberto

- **O que o log real mostrou.** Desde 2026-11-20, com a Riot 143, todo jogo terminava com "forgot the saved session…" de 30 s a 2 min depois de abrir, sem o usuário sair da conta. A Riot passou a limpar o arquivo e responder "sem conta" com o jogo aberto, o mesmo par de sinais desta regra. Resultado: cada conta voltava à senha (16 pedidos de código no log).
- **O que mudou (2.32.1).** Com um jogo aberto, o [[sessionKeeper]] não apaga a sessão e solta a anotação. A regra continua valendo com a Riot aberta sem jogo.
- **Ainda aberto.** Não foi medido se a Riot encerra essa sessão no servidor. O próximo Jogar responde: entra pela sessão, ou a acha recusada e cai no login visível depois de uns 15 s.

## Relacionado

- [[sessionKeeper]]
- [[riotClient]]
- [[ADR-019 Sessão salva por conta no modo cartões]]
- [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]
- [[ADR-021 Riot sempre abre desconectada]]
- [[Segurança e privacidade]]
