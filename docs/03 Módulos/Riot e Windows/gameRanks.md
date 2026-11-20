---
tipo: módulo
arquivo: src-tauri/src/riot/game_ranks.rs
camada: riot
testes: src-tauri/tests/riot/game_ranks.rs
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

| Item | Tipo | Descrição |
|---|---|---|
| `GameRanks::new(league_api, riot_api)` | construtor | Dois transportes do [[riotTransport]]: um para o cliente do LoL, outro para o Riot Client |
| `league()` | método | `GET /lol-summoner/v1/current-summoner`, `GET /lol-ranked/v1/current-ranked-stats` e `GET /lol-regalia/v2/current-summoner/regalia`. Devolve um `Reading` com o Riot ID e `lol` (`level`, `iconId`, `solo`, `flex` e, se a terceira respondeu, `border`) e `tft` (`ranked`, `doubleUp`), ou `None` |
| `valorant()` | método | `GET /chat/v1/session` e `GET /chat/v4/presences`. Devolve um `Reading` com o Riot ID e `val` (`tier`, `tierName`, `level`, `card` e, se a presença disser, `border`), ou `None` |
| `league_border(regalia, nível)`, `prestige_theme(nível)` | funções | A borda equipada no League a partir da resposta do `lol-regalia`, e o tema da borda de nível (1 a 21) pelas faixas do jogo |
| `league_folders_with(leitura, arquivo)` | função | As pastas do League of Legends e do Teamfight Tactics em `associated_client` do `RiotClientInstalls.json` (`INSTALLS_FILE`), só caminhos absolutos |
| `read_league_lockfile()` | função | O `Backend` do primeiro `lockfile` dessas pastas, pelo `parse_backend_lockfile` do [[backend]]. Sem nenhum, falha com "The League client is not running". `read_league_lockfile_with` troca a leitura para os testes |
| `parse_league`, `parse_valorant`, `val_tier_name`, `reading_to_map` | funções | Conferência das respostas e conversão, públicas para os testes |

## Dependências

- Usa: [[backend]] (`parse_backend_lockfile`). Os transportes vêm do [[riotClient]], montados com o [[riotTransport]].
- Usado por: [[riotClient]], que entrega as leituras ao [[rankWatcher]].

## Invariantes e decisões

- **Borda equipada.** 2026-11-20, pedido do usuário: "por padrão fique sem borda nenhuma, após eu entrar na conta você pega a borda que estou usando". No League, uma terceira leitura (`lol-regalia`, só `GET`) dá `lol.border`: `{ kind: "level", theme }` quando `crestType` é `prestige` (`selectedPrestigeCrest` de 1 a 21; fora disso, o tema do nível pelas faixas 1, 30, 50, 75 … 500), `{ kind: "ranked", tier }` quando é `ranked` (`lastSeasonHighestRank`, senão `highestRankedEntry.tier`, só elos conhecidos) e `null` para qualquer outro tipo. Se o `lol-regalia` não responde, a leitura sai sem `border` e o elo continua valendo. No VALORANT, `preferredLevelBorderId` da presença vira `val.border`: o UUID em minúsculas, ou `"level"` (borda do nível) quando vem vazio, zerado ou estranho; sem o campo, nada.

- **Elo sem chave.** Criado em 2026-11-08 ([[ADR-031 Elo lido do próprio jogo, sem chave]]), para um amigo usar o Eclipse sem criar chave de API.
- **Mesmo certificado, validação ligada.** O cliente do LoL usa a mesma raiz da Riot que o Riot Client ("LoL Game Engineering Certificate Authority", conferida em 2026-11-08 no `app.asar` oficial). O transporte do LoL só troca a conexão (`read_league_lockfile`); o certificado e a validação são os do [[riotTransport]].
- **Só pastas listadas pela Riot.** O `lockfile` do LoL só é procurado nas pastas de `associated_client` cujo nome tem "League of Legends" ou "Teamfight Tactics". A pasta do VALORANT e caminhos relativos ficam de fora.
- **Resposta estranha não apaga elo.** Sem `gameName` e `tagLine` válidos (até 64 e 16 caracteres, sem controle), ou sem a lista de filas (`queues` ou `queueMap`), a leitura devolve `None` e o cartão fica como estava. Uma fila com elo, divisão ou números fora da faixa vira `null` (sem elo), como o [[rankApi]] faz com uma fila ausente.
- **Divisão como a da API pública.** Mestre ou acima vem sem divisão; abaixo, só `I` a `IV`. `hotStreak` só vale com `true`. O cliente do LoL não manda esse campo (conferido em 2026-11-08), então a leitura sempre dá `false`, e o [[rankWatcher]] mantém o que veio de uma chave.
- **Presenças dos amigos descartadas.** `/chat/v4/presences` traz a presença de todos os amigos. Só a da própria conta (mesmo `puuid` de `/chat/v1/session`, produto `valorant`) é lida; as outras não são guardadas, devolvidas nem registradas. O transporte do chat aceita até 8 MiB, porque a lista cresce com os amigos.
- **Presença em duas formas.** O VALORANT já mandou os campos no topo do JSON da presença e, nas versões novas, dentro de `playerPresenceData`. As duas são aceitas. O JSON tem no máximo 64 KiB em base64.
- **Conferido no LoL real em 2026-11-08.** Com o LoL aberto e só `GET`, o certificado foi aceito com a validação ligada. `current-summoner` trouxe `gameName`, `tagLine`, `summonerLevel` e `profileIconId`. `current-ranked-stats` trouxe `queues` e `queueMap` juntos, com filas a mais (`JADE_RANKED_SOLO_5x5`, `RANKED_PREMADE_5x5`) que são ignoradas. Uma fila sem elo vem com `tier` vazio e `division` `"NA"` e vira `null`. O TFT em jogos provisórios já vem com elo. O Eclipse em Electron gravou a leitura numa conta salva sozinho ("updated a saved account from the League client").
- **Nome do elo igual ao da HenrikDev.** `val_tier_name` dá "Iron 1" … "Immortal 3" e "Radiant", que os [[cards]] já traduzem. O cartão só entra como UUID, montado na mesma URL do [[rankApi]].
- **O que o jogo não dá.** Sem RR, última partida, pico e temporada passada no VALORANT, e sem os cortes de Mestre+ no LoL. O [[rankWatcher]] mantém os que vieram de uma chave.
- **Leitura no formato dos cartões.** O resultado é a struct `Reading`, com o Riot ID e os elos como JSON no formato que os [[cards]] já leem.

## Testes

`src-tauri/tests/riot/game_ranks.rs`, com respostas sintéticas: o formato dos cartões a partir do LoL; respostas estranhas sem leitura, para os elos salvos ficarem; os nomes dos elos do VALORANT; a presença própria nas duas formas, ignorando as outras; presença ausente, estranha ou grande demais; o `lockfile` só das pastas do League e do TFT listadas pela Riot; só `GET`, parando na primeira resposta ruim e lendo cada jogo do próprio serviço; e, com valores fictícios, o formato que o cliente do LoL mandou em 2026-11-08, com `queues` e `queueMap` juntos.

## Pontos de atenção

- **Borda de nível conferida no LoL real em 2026-11-20.** Uma conta do usuário gravou `{ kind: "level", theme: 15 }` cerca de 4 minutos depois de o jogo abrir, e a placa mostrou a borda; o usuário confirmou ("funcionou"). Faltam a borda de elo e o VALORANT.
- **Borda não conferida por inteiro.** Os campos do `lol-regalia` (`crestType`, `selectedPrestigeCrest`, `lastSeasonHighestRank`, `highestRankedEntry`) e o `preferredLevelBorderId` do VALORANT vêm da documentação da comunidade, não de uma resposta real. Conferir na primeira entrada do usuário com o jogo aberto, principalmente se `selectedPrestigeCrest` é o tema de 1 a 21 ([[Backlog]]).
- **O VALORANT ainda não foi conferido.** O LoL foi conferido em 2026-11-08 (acima). Do chat, `/chat/v1/session` e `/chat/v4/presences` responderam no formato esperado, mas só com o LoL aberto: a presença do LoL tem outro conteúdo no `private`, e a do VALORANT só aparece com ele aberto. As presenças também têm os campos `privateJwt` e `packedData`. Se o VALORANT passar a mandar o elo por um deles, a leitura não dá nada e o `data.log` mostra "could not read the ranks from the Riot Client" ([[Backlog]]).
- Uma atualização da Riot pode mudar essas rotas ([[Atualização do Riot Client]]).
