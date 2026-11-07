---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, login, sessão, processos]
---

# ADR-020 Riot conectada é encerrada quando fica sem jogo

Complementa [[ADR-019 Sessão salva por conta no modo cartões]].

## Contexto

Pedido do usuário em 2026-11-06, depois de testar a ADR-019:

> faça com que apenas o primeiro login seja visual em todas as contas, a partir do segundo login deve tudo ocorrer em segundo plano, meu objetivo principal é que visualmente o usuario clique em jogar lol por exemplo, e apos clicar em jogar a unica e proxima tela que ele vai ver sera o lol e mais nada

O `sign-in.log` real mostra por que a sessão salva "funcionou uma vez e parou":

- **Funcionou duas vezes.** A sessão restaurada entrou em segundo plano às 13:54:36 e às 13:56:05.
- **Depois foi recusada.** Às 13:57:40, a sessão salva da mesma conta foi recusada.
- **No meio, a Riot saiu da conta.** A Riot tinha ficado aberta e conectada. Para ver os cartões de novo, ela precisou voltar à tela de login. **Sair da conta pela Riot encerra a sessão no servidor da Riot**, e a cópia guardada pelo Eclipse morre junto.
- **Uma segunda fragilidade.** O `refresh_token` do arquivo da Riot é de uso único: cada restauração o troca por outro (`refresh_token_write_count`). A cópia guardada só continua válida se o Eclipse guardar a versão que a Riot regravou. Até aqui, isso só acontecia quando a Riot saía.
- **Um terceiro ponto.** No modo cartões, o login visível fazia `DELETE /rso-auth/v1/session` se outra conta estivesse conectada. Isso também encerra a sessão dessa outra conta no servidor.

## Decisão

- **A Riot não fica conectada sem uso.** O [[sessionKeeper]] olha os processos da Riot a cada 4 s, só com "Manter login" ligado e sem login em andamento. Ele pede à Riot a saída normal (`POST /process-control/v1/process/quit`), a mesma do menu "Sair", quando ela está conectada e:
  - um jogo esteve aberto e fechou; ou
  - ela ficou sem janela e sem jogo (por exemplo, o X da Riot em modo segundo plano).

  A condição precisa aparecer em duas leituras seguidas. Ao sair, a Riot grava o login, e o guardião o guarda na conta e limpa o arquivo, como na ADR-019. Da próxima vez, a Riot abre na tela de login com os cartões, e o usuário nunca precisa sair da conta pela Riot.
- **A cópia guardada acompanha a Riot.**
  - Toda vez que a Riot regrava o arquivo com o login de uma conta conhecida, o guardião guarda essa versão, mesmo com a Riot aberta. Só limpa o arquivo depois que ela sai.
  - O fim de cada login pede uma conferência, para pegar o que a Riot gravou durante o login.
  - Logo depois de restaurar, o [[signInFlow]] só aceita como sessão nova um arquivo diferente do que ele mesmo escreveu, porque o escrito já foi consumido.
- **Trocar de conta nunca encerra a sessão de quem sai.**
  - O login visível do modo cartões, com outra conta conectada, fecha a Riot com a saída normal em vez de `DELETE`. O login dessa conta é guardado e limpo do arquivo antes de a interface abrir.
  - O `onClosed` de qualquer fechamento usa a mesma identificação do guardião (o `sub` ou um Riot ID único) para guardar a sessão de quem sai, não só a da última conta usada.
- **O primeiro login de cada conta continua visível**, porque é ele que cria a sessão e pode precisar da verificação de segurança. A partir do segundo, Jogar mostra só o jogo. "Manter login" desligado mantém todos os logins visíveis.

## Alternativas consideradas

- **Mostrar os cartões também com a Riot conectada:** exigiria desenhar sobre a página inicial da Riot. O usuário ainda poderia sair da conta pela Riot e perder a sessão.
- **Guardar a sessão só na saída da Riot:** foi o desenho da ADR-019. Perde a versão nova sempre que a Riot é derrubada, e não impede o usuário de sair da conta pela Riot.
- **Sair da conta pelo Eclipse (`DELETE`):** encerra a sessão no servidor, exatamente o que se quer evitar.

## Consequências

- **Clicar em Jogar numa conta com sessão mostra só o jogo.** A janela da Riot fecha e o League (ou o VALORANT) abre alguns segundos depois. Quando o jogo fecha, a Riot também sai em poucos segundos.
- **Abrir a Riot logo depois de fechar o jogo** pode mostrar a página inicial conectada por alguns segundos, até o Eclipse encerrá-la. Desde a [[ADR-026 Riot fechada depois do jogo reabre na tela de login]], ela volta sozinha na tela de login.
- **O Eclipse passa a consultar os processos a cada 4 s** enquanto está aberto (`tasklist`, como o resto do projeto). A API local só é consultada quando a Riot roda sem jogo.
- **Uma atualização que a Riot baixa em segundo plano, sem janela e sem jogo, é interrompida** pela saída normal e continua quando a Riot abrir de novo.
- **Sair da conta pela própria Riot continua encerrando a sessão.** O Eclipse não tem como impedir. A conta volta ao login visível uma vez. Desde a [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]], sem reiniciar a Riot.
- **Este ADR não mexe na instalação da Riot**, nem em processos fora de `RiotClientServices` e da interface dela. Jogos só são fechados no caminho que já existia, antes de um login.

## Revisão de 2026-11-06: modo segundo plano

- **O teste real mostrou outro caminho.** Quando o jogo fecha, a Riot v142 não fica conectada: ela passa ao modo segundo plano, solta a conta da memória e mantém o login no arquivo. A saída normal desta ADR nunca disparava, e a Riot abria conectada a partir do arquivo.
- **O que mudou.** A limpeza do arquivo passou a acontecer sempre que a Riot não segura a conta, sem esperar ela sair. A saída normal da Riot conectada sem jogo continua valendo.
- Desenho atual em [[ADR-021 Riot sempre abre desconectada]].

## Relacionado

- [[sessionKeeper]]
- [[signInFlow]]
- [[main]]
- [[riotClient]]
- [[Fluxo de login]]
- [[Segurança e privacidade]]
