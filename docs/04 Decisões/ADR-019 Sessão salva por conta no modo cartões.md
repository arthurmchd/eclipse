---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, login, sessão, segurança]
---

# ADR-019 Sessão salva por conta no modo cartões

Revisa [[ADR-010 Login visível com progresso]] no ponto em que ela dizia que o modo cartões não reinicia o Riot Client para injetar um YAML salvo.

## Contexto

Pedido do usuário em 2026-11-06: escolher a conta, clicar em Jogar e não precisar deixar a Riot nem o Eclipse em primeiro plano durante o login.

- **O formulário nativo não serve em segundo plano.** O preenchimento do [[login.ps1]] manda mensagens para a janela e não exige foco. Mas a verificação automática da Riot (o hCaptcha invisível) não termina com a janela escondida ou atrás de outras. No `sign-in.log` de 2026-11-06, três tentativas pararam em "Riot needs a security check" 12 s depois da senha. Fingir que a janela está visível seria contornar uma verificação da Riot, o que [[ADR-003 Sem contornar CAPTCHA ou 2FA]] proíbe.
- **O "Manter login" da própria Riot é o caminho legítimo.** Com ele, a Riot grava no `RiotGamesPrivateSettings.yaml` os cookies da sessão, e na próxima abertura entra sozinha, sem formulário nem verificação.
- **O usuário tem muitas contas.** Se a Riot lembrar de uma conta, ela abre já conectada e os cartões não aparecem ([[riotOverlay]] só mostra os cartões na tela de login). Para trocar de conta seria preciso sair antes. Era essa a preocupação do usuário.
- **Sessões salvas envelhecem.** No modo antigo, uma sessão restaurada minutos depois de capturada funcionava (2026-10-25, 2026-10-27 02:31). Horas depois, falhava com "saved session is no longer usable" (2026-10-27 14:14, 2026-10-28 14:02 e 21:28). A causa provável: a Riot troca os tokens enquanto está aberta e só grava os novos ao sair.

## Decisão

- **O Eclipse lembra de cada conta; a Riot não lembra de ninguém.**
  - Com "Manter login" ligado, a sessão de cada conta fica no cofre do Eclipse (`sessions/<id>.bin`, criptografada, ver [[store]]).
  - Quando a Riot sai, o [[sessionKeeper]] guarda o YAML recém-gravado na conta dona dele.
  - Depois, tira do arquivo da Riot o login lembrado, mantendo só o `tdid`.
  - Assim a Riot sempre abre na tela de login, com os cartões.
- **Jogar restaura em segundo plano.** No modo cartões, se a conta tem sessão salva, o [[signInFlow]]:
  1. fecha a Riot (saída normal, para ela gravar os tokens novos);
  2. escreve o YAML da conta;
  3. sobe os serviços sem interface;
  4. confere o Riot ID;
  5. pede o jogo.

  Ninguém digita nada, e nenhuma janela precisa de foco.
- **Falhou, cai no formulário visível.** Se a sessão não autorizar em 15 s ou o Riot ID não bater, a sessão é esquecida. Aí a interface da Riot abre e o login visível de [[ADR-010 Login visível com progresso]] segue como antes. Nesse caminho a Riot precisa estar visível para a verificação automática.
- **A dona do login é provada pelo `sub`, com o Riot ID como segunda prova.**
  - O `sub` é o identificador da conta que a própria Riot grava junto da sessão. No Riot Client atual ele está no `id_token` do login lembrado; em formatos antigos, num cookie `sub`.
  - O YAML vai para a conta cuja sessão já guardada tem o mesmo `sub`.
  - Se nenhuma sessão guardada tem esse `sub`, vale o Riot ID que a Riot pôs no mesmo `id_token` (`acct.game_name` e `acct.tag_line`), desde que bata com uma única conta do Eclipse.
  - Do `id_token`, o Eclipse lê só esses campos da parte pública do token. Não confere a assinatura, não guarda nem registra nada dele à parte, e ao Jogar o Riot ID continua sendo conferido pela API local antes de pedir o jogo.
  - Sem dona comprovada, o arquivo da Riot fica como está: o Eclipse não apaga um login que não sabe guardar.
- **O guardião não disputa com o login.**
  - Com um login em andamento, o [[sessionKeeper]] não faz nada.
  - Com a Riot rodando, também não: ele só age com os serviços da Riot parados.
- **"Manter login" desligado desliga tudo isso.** Nesse caso o Eclipse não restaura nem guarda sessões e não mexe no arquivo da Riot fora de um login.

## Alternativas consideradas

- **Formulário nativo com a janela escondida:** a verificação automática da Riot falha. Mascarar a visibilidade para ela passar seria contornar a verificação ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]).
- **Deixar a Riot lembrar da última conta:** a Riot abriria conectada e os cartões sumiriam, o oposto do que o Eclipse promete para quem tem muitas contas.
- **Tirar o "lembrar" logo depois do login:** a Riot guarda a sessão na memória e a regrava ao sair. Só funciona depois que ela sai.
- **Descobrir a dona pelo Riot ID enquanto a Riot roda:** exige consultar a API local o tempo todo e ainda deixa uma janela entre a última consulta e a saída. O `sub` e o Riot ID vêm no próprio arquivo e não dependem de tempo.

## Consequências

- **Com sessão válida, o login não precisa de foco.** Jogar fecha a janela da Riot e o jogo abre sozinho alguns segundos depois. A sobreposição some junto com a janela da Riot. Uma falha aparece no balão da bandeja.
- **A primeira entrada de cada conta continua visível.** É ela que cria a sessão. Uma sessão que a Riot recusar também volta ao formulário visível.
- **Depois do jogo, a Riot continua conectada enquanto os serviços dela estiverem rodando.** Isso já acontecia antes. Os cartões voltam quando a Riot sai ou o jogador sai da conta.
- **Se o Eclipse não estiver aberto quando a Riot sair,** o login lembrado fica no arquivo até o Eclipse abrir com a Riot fechada. Se a Riot abrir antes, entra conectada nessa conta.
- **Se a Riot for derrubada sem sair normalmente,** ela não grava os tokens novos. A sessão guardada pode estar velha e a próxima entrada dessa conta cai no formulário visível.
- **O Eclipse passa a escrever o arquivo da Riot fora de um login.** É o mesmo arquivo de `%LOCALAPPDATA%\Riot Games\Riot Client\Data\` que o fluxo antigo já escrevia, nunca a instalação em `C:\Riot Games\`. A escrita só remove o login lembrado de uma conta cuja sessão acabou de ser guardada.

## Revisão de 2026-11-06: teste com a Riot real

- **O primeiro teste achou um erro.** A conta entrou pelo formulário visível às 13:47:56 e a sessão foi guardada. A Riot saiu às 13:48:13, mas o guardião registrou "matches no saved session" e deixou o login no arquivo. A Riot reabriu já conectada às 13:48:22.
- **Causa: o Riot Client atual (v141) não grava o cookie `sub`.** O login lembrado fica só em `psl.authorization.riot-client` (`refresh_token`, `id_token` e afins). Nos cookies sobra só o `tdid`. O desenho original presumia o cookie, e isso não tinha sido conferido no Riot real.
- **Correção: a identidade passa a vir do `id_token`.** Ele traz o `sub` e o Riot ID (`acct`). Conferido no arquivo real, só em memória e sem mostrar valores: o `sub` tem o formato esperado e o Riot ID bate com uma única conta do Eclipse, a que tinha acabado de entrar.
- **A segunda rodada funcionou de ponta a ponta (13:53 a 13:54 UTC).**
  - A sessão antiga, capturada antes de a Riot trocar os tokens, foi recusada em 15 s ("saved session is no longer usable"). O fluxo caiu no login visível e a conta entrou sem verificação de segurança.
  - Ao sair da Riot, o guardião guardou a sessão na conta e limpou o arquivo ("kept the Riot session for its account and cleared the remembered login").
  - No Jogar seguinte, a Riot fechou, voltou com a sessão restaurada e autorizou em 0,5 s ("signed in with the saved session"), sem digitar nada.

## Revisão de 2026-11-06: a Riot não sai depois do jogo

- **Esperar a Riot sair não basta.** Quando o jogo fecha, a Riot v142 passa ao modo segundo plano em vez de sair, e o guardião nunca limpava o arquivo. Ao ser aberta, ela restaurava a conta a partir dele.
- **O login sem dona comprovada não fica mais intacto.** Ele também é limpo, a pedido do usuário.
- Desenho atual em [[ADR-021 Riot sempre abre desconectada]].

## Relacionado

- [[signInFlow]]
- [[sessionKeeper]]
- [[signInService]]
- [[riotClient]]
- [[Fluxo de login]]
- [[Segurança e privacidade]]
