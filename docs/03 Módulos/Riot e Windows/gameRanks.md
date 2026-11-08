---
tipo: módulo
arquivo: src/riot/gameRanks.js
camada: riot
testes: test/riot/gameRanks.test.js
tags: [módulo]
---

# gameRanks

> Lê o elo da conta que está no jogo aberto, pelo cliente do LoL e pela API local do Riot Client, sem chave de API.

## Responsabilidade

- Acha o `lockfile` do cliente do LoL pelas pastas que a Riot lista no `RiotClientInstalls.json`.
- Pergunta ao cliente do LoL o Riot ID, o nível, o ícone e as filas ranqueadas (Solo/Duo, Flex, TFT, Double Up).
- Pergunta ao Riot Client quem está conectado e lê da presença da própria conta no VALORANT o elo, o nível e o cartão.
- Confere formato e faixa de tudo e devolve no mesmo formato que o [[rankApi]] grava nos `stats`.
- **Não** decide quando ler, de quem é a conta nem grava nada: isso é do [[rankWatcher]].
- **Não** faz `POST`, `PUT` ou `DELETE`, e não escreve na pasta do jogo.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createGameRanks({ leagueApi, riotApi })` | fábrica | Recebe dois transportes do [[riotTransport]]: um para o cliente do LoL, outro para o Riot Client. Devolve `{ league, valorant }`. |
| `league()` | método async | `GET /lol-summoner/v1/current-summoner` e `GET /lol-ranked/v1/current-ranked-stats`. Devolve `{ riotId, lol: { level, iconId, solo, flex }, tft: { ranked, doubleUp } }` ou `null`. |
| `valorant()` | método async | `GET /chat/v1/session` e `GET /chat/v4/presences`. Devolve `{ riotId, val: { tier, tierName, level, card } }` ou `null`. |
| `leagueFolders(options)` | função | As pastas do League of Legends e do Teamfight Tactics em `associated_client`, só caminhos absolutos. |
| `readLeagueLockfile(options)` | função | `{ pid, port, token }` do primeiro `lockfile` dessas pastas, pelo `parseBackendLockfile` do [[backend]]. Sem nenhum, lança "The League client is not running". |
| `parseLeague`, `parseValorant`, `valTierName` | funções | Conferência das respostas, exportadas para os testes. |

## Dependências

- Usa: [[backend]] (`parseBackendLockfile`). Os transportes vêm do [[riotClient]], montados com o [[riotTransport]].
- Usado por: [[riotClient]], que exporta a instância como `gameRanks`, lida pelo [[rankWatcher]].

## Invariantes e decisões

- **Elo sem chave.** Criado em 2026-11-08 ([[ADR-031 Elo lido do próprio jogo, sem chave]]), para um amigo usar o Eclipse sem criar chave de API.
- **Mesmo certificado, validação ligada.** O cliente do LoL usa a mesma raiz da Riot que o Riot Client ("LoL Game Engineering Certificate Authority", conferida em 2026-11-08 no `app.asar` oficial). O transporte do LoL só troca a conexão (`connection: readLeagueLockfile`); o certificado e a validação são os do [[riotTransport]].
- **Só pastas listadas pela Riot.** O `lockfile` do LoL só é procurado nas pastas de `associated_client` cujo nome tem "League of Legends" ou "Teamfight Tactics". A pasta do VALORANT e caminhos relativos ficam de fora.
- **Resposta estranha não apaga elo.** Sem `gameName` e `tagLine` válidos (até 64 e 16 caracteres, sem controle), ou sem a lista de filas (`queues` ou `queueMap`), a leitura devolve `null` e o cartão fica como estava. Uma fila com elo, divisão ou números fora da faixa vira `null` (sem elo), como o [[rankApi]] faz com uma fila ausente.
- **Divisão como a da API pública.** Mestre ou acima vem sem divisão; abaixo, só `I` a `IV`. `hotStreak` só vale com `true`.
- **Presenças dos amigos descartadas.** `/chat/v4/presences` traz a presença de todos os amigos. Só a da própria conta (mesmo `puuid` de `/chat/v1/session`, produto `valorant`) é lida; as outras não são guardadas, devolvidas nem registradas. O transporte do chat aceita até 8 MiB, porque a lista cresce com os amigos.
- **Presença em duas formas.** O VALORANT já mandou os campos no topo do JSON da presença e, nas versões novas, dentro de `playerPresenceData`. As duas são aceitas. O JSON tem no máximo 64 KiB em base64.
- **Nome do elo igual ao da HenrikDev.** `valTierName` dá "Iron 1" … "Immortal 3" e "Radiant", que os [[cards]] já traduzem. O cartão só entra como UUID, montado na mesma URL do [[rankApi]].
- **O que o jogo não dá.** Sem RR, última partida, pico e temporada passada no VALORANT, e sem os cortes de Mestre+ no LoL. O [[rankWatcher]] mantém os que vieram de uma chave.

## Testes

`test/riot/gameRanks.test.js`, com respostas sintéticas: o formato dos cartões a partir do LoL (lista `queues` e `queueMap`); respostas estranhas devolvendo `null` ou filas sem elo; os nomes dos elos do VALORANT; a presença própria nas duas formas, ignorando amigos e outros produtos; presença ausente, estranha ou grande demais; o `lockfile` só das pastas do League e do TFT; e só `GET`, parando na primeira resposta ruim.

## Pontos de atenção

- **Nada disso foi conferido na Riot real.** Os nomes das rotas e dos campos vêm da documentação da comunidade. Falta ver, com o jogo aberto e só lendo, se o cliente do LoL aceita o certificado e devolve esses campos, e se o chat responde com o VALORANT aberto. Se não, o `data.log` mostra "could not read the ranks" ([[Backlog]]).
- Uma atualização da Riot pode mudar essas rotas ([[Atualização do Riot Client]]).
