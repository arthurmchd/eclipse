---
tipo: decisão
status: aceita
data: 2026-11-08
tags: [adr, elos, riot, segurança]
---

# ADR-031 Elo lido do próprio jogo, sem chave

Pedido do usuário em 2026-11-08, ao pensar em passar o Eclipse para um amigo: cada pessoa ter de criar a própria chave de API é ruim. Das alternativas avaliadas, o usuário escolheu ler o elo do próprio jogo.

## Contexto

Até aqui os elos vinham só de chaves que o usuário cola no ⚙ ([[rankApi]]): a da Riot para LoL e TFT, e a da HenrikDev para VALORANT. Para outra pessoa usar o Eclipse, ela precisa criar as duas. A chave de desenvolvimento da Riot expira a cada 24 h. A chave pessoal da Riot é para o próprio desenvolvedor ou um grupo pequeno, e não pode ir dentro do app: qualquer um a tiraria do `app.asar`, e a Riot cancela chave exposta.

Uma conta do próprio usuário só muda de elo quando joga, com duas exceções: a perda de PDL por inatividade no Diamante ou acima e a virada de temporada. Na hora em que ela joga, o jogo está aberto no PC com essa conta e sabe o elo.

## Decisão

O Eclipse lê o elo do jogo aberto, no próprio PC, sem chave. As chaves continuam opcionais no ⚙.

- **LoL e TFT, pelo cliente do LoL.** O cliente do LoL (`LeagueClientUx`) tem uma API local. A pasta do jogo vem do `RiotClientInstalls.json` da Riot (`associated_client`, as pastas do League of Legends e do Teamfight Tactics), e o `lockfile` dela dá a porta e a senha. O certificado é o mesmo raiz da Riot que o [[backend]] já lê do `app.asar` oficial (conferido em 2026-11-08: "LoL Game Engineering Certificate Authority"), com validação ligada. Só dois `GET`:
  - `/lol-summoner/v1/current-summoner`: Riot ID, nível e ícone;
  - `/lol-ranked/v1/current-ranked-stats`: Solo/Duo, Flex, TFT e Double Up, com elo, PDL, vitórias e derrotas.
- **VALORANT, pela API local do Riot Client.** Dois `GET` na mesma API que o [[riotClient]] já usa:
  - `/chat/v1/session`: quem está conectado;
  - `/chat/v4/presences`: a presença da própria conta no VALORANT traz o elo (`competitiveTier`), o nível e o cartão.
  A lista também traz a presença dos amigos. Ela é lida só em memória para achar a da própria conta e descartada: nada dela é guardado nem vai ao log.
- **Quando.** A cada 60 s, só com o LoL ou o VALORANT aberto, e nunca durante um login. Também quando o usuário pede ↻ sem nenhuma chave salva.
- **De quem.** A conta é reconhecida pelo Riot ID, e só se uma única conta salva tiver esse Riot ID, a mesma regra do [[sessionKeeper]]. Jogo aberto com uma conta que não está no Eclipse não muda nada.
- **O que não vem do jogo.** RR, última partida, pico e temporada passada do VALORANT, e os cortes de Grão-Mestre e Desafiante do LoL. Ficam os anteriores, vindos de uma chave, enquanto o elo for o mesmo. Com elo diferente, o RR e a última partida somem até a próxima atualização com chave.
- **Com chave.** A atualização de sempre continua no intervalo do ⚙ e escreve por cima da leitura do jogo, e vice-versa: vale a mais recente.
- **Sem chave.** O intervalo e o ↻ continuam marcando a atualização, mas só pedem a leitura do jogo aberto. Não há erro de "falta chave" nem consulta a servidores.

O módulo novo [[gameRanks]] (camada Riot) lê e confere os dados; o [[rankWatcher]] (aplicação) decide quando ler, acha a conta e grava. O [[main]] cria o watcher junto com o guardião.

## Segurança

- Só `GET`, só em `127.0.0.1`, com o certificado raiz da Riot e validação ligada. Nenhum `POST`, `PUT` ou `DELETE` no cliente do LoL ou no chat.
- A senha do `lockfile` do LoL fica só no main, como a do Riot Client, e nunca vai ao log. A pasta do jogo só é lida.
- Respostas são não confiáveis: o Riot ID, os números e o elo são conferidos por formato e faixa; o cartão do VALORANT só entra como UUID.
- O log registra só linhas fixas e só quando o resultado muda, sem nome de conta.

## Não conferido

Os formatos foram tirados de documentação da comunidade, não da Riot real, e nada foi testado com o jogo aberto:

- os campos de `current-summoner` (`gameName`, `tagLine`, `summonerLevel`, `profileIconId`) e de `current-ranked-stats` (`queues[].queueType`, `tier`, `division`, `leaguePoints`, `wins`, `losses`);
- se o certificado do cliente do LoL é aceito pela mesma raiz;
- se a API de chat responde com o VALORANT aberto e se a presença traz `competitiveTier` no topo ou em `playerPresenceData` (as duas formas são aceitas);
- a pasta do Teamfight Tactics separado.

Se um formato não bater, a leitura devolve nada e o cartão fica como estava. O `data.log` mostra "could not read" para conferir.

## Alternativas consideradas

- **Servidor do usuário com a chave pessoal.** Funciona para todas as contas a qualquer hora, mas exige registrar o app na Riot, manter o servidor, dividir o limite de consultas entre todos e mostrar ao servidor os Riot IDs dos amigos. Fica para se o grupo crescer.
- **Chave embutida no app.** Extraível do `app.asar`, contra as regras da Riot e cancelável.
- **Ler páginas de sites de estatística.** Quebra a cada mudança deles e vai contra os termos.
- **Ler o VALORANT pela API remota da Riot com o token da sessão.** Daria RR e partidas, mas usaria o token de acesso do jogador fora do PC. Fora do escopo.

## Consequências

- Um amigo usa o Eclipse sem criar chave. A conta ganha elo na primeira vez em que joga com o jogo aberto.
- Conta nunca jogada desde a instalação fica sem elo; conta parada pode ficar velha (inatividade, nova temporada).
- O RR do VALORANT só aparece para quem tem chave da HenrikDev.
- O Eclipse passa a abrir conexões locais com o cliente do LoL. Uma mudança de API da Riot exige revisar o [[gameRanks]] ([[Atualização do Riot Client]]).

## Relacionado

- [[rankApi]]
- [[Segurança e privacidade]]
- [[ADR-029 Estado da Riot definido num lugar só]]
- [[ADR-030 Eclipse instalado por um Setup próprio]]
