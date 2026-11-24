---
tipo: módulo
arquivo: src-tauri/src/application/rank_api.rs
camada: aplicação
testes: src-tauri/tests/application/rank_api.rs
tags: [módulo]
---

# rankApi

> Busca elos de LoL e TFT na API oficial da Riot, de LoL no OP.GG e de VALORANT na HenrikDev, e devolve os campos a mesclar em cada conta.

## Responsabilidade

- Resolve o PUUID pelo Riot ID, confere pelo PUUID salvo se o Riot ID mudou e consulta summoner e league (LoL), league de TFT e MMR de VALORANT.
- Em Mestre, Grão-Mestre e Desafiante, estima os cortes de Grão-Mestre e Desafiante da fila e da região.
- Traduz respostas e erros em `stats` e mensagens por jogo.
- Limita o ritmo das requisições e repete depois de `429`.
- **Não** grava nada: o [[refresher]] aplica o resultado com `update_account_fields` do [[store]]. **Não** lê chaves: recebe de `get_keys()`.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `REGIONS`, `regions_json()` | constante e função | ID de plataforma → nome, `routing` do account-v1 e região de VALORANT; em JSON para o estado inicial dos [[cards]] |
| `VAL_REGIONS` | constante | `br`, `na`, `latam`, `eu`, `kr`, `ap` |
| `RankApi::new(http, hooks)` | construtor | Instância com fila, cache de cortes e relógio próprios; `RankHttp` é a rede e `ApiHooks` o tempo |
| `RankApi::live()` | construtor | A instância real, com o `UreqHttp` |
| `refresh_account(conta, chaves)` | método | Devolve `Refresh { fields, errors }`: campos a mesclar na conta e erros por jogo |
| `ladder_cutoffs(challenger, grandmaster, master)` | função | PdL do corte de Desafiante e de Grão-Mestre a partir das três listas |
| `retry_delay`, `key_hash`, `encode_component`, `map_entry` | funções | Espera do `retry-after`, hash da chave, codificação de URL e entrada de elo, públicas para os testes |
| `TIMEOUT_MS`, `TOO_SLOW` | constantes | 15 s e o texto do prazo estourado |

As chaves são `ApiKeys { riot, tft, henrik }` do [[store]]. `fields` pode ter `stats` (`lol`, `tft`, `val`, `errors`), `puuidCache`, `gameName` e `tagLine`. Em Mestre+, `stats.lol.solo` e `stats.lol.flex` ganham `cutoffs: { challenger, grandmaster }`.

## Dependências

- Usa: a trait `RankHttp` (o `UreqHttp` real usa o TLS do Windows com os certificados do sistema) e `sha2` (SHA-256 da chave). Hosts: `<routing>.api.riotgames.com`, `<plataforma>.api.riotgames.com` e `api.henrikdev.xyz`. Monta URLs de card em `media.valorant-api.com`.
- Usado por: [[refresher]] (atualização de elos) e [[appPorts]] (`REGIONS` e `VAL_REGIONS` no estado inicial). Os [[cards]] leem os campos via `rankOf` ([[ranks]]).

## Invariantes e decisões

- **Borda e banner ficam.** 2026-11-20: a chave e o OP.GG trocam o `stats.lol` e o `stats.val` inteiros, então `keep_look` (antes `keep_border`) copia o `border` lido do jogo ([[gameRanks]]) para o objeto novo. Desde a 2.22.4 copia também o `banner`: da 2.22.2 à 2.22.3 cada atualização pela chave ou pelo OP.GG apagava o banner lido, e a placa voltava ao padrão até a próxima leitura do jogo. A chave nunca dá borda nem banner. Desde a 2.27.0 copia também o `splash` e o `companion` dos novos cartões.

- **Chaves opcionais.** Desde 2026-11-08 ([[ADR-031 Elo lido do próprio jogo, sem chave]]), o elo também vem do jogo aberto, sem chave ([[rankWatcher]], [[gameRanks]]). Com chave, este módulo continua escrevendo os `stats` inteiros, e uma leitura do jogo depois escreve por cima: vale a mais recente.
- **League pelo OP.GG.** Desde 2026-11-15 ([[ADR-037 Elo do League pelo OP.GG]]), o [[refresher]] chama este módulo também sem chave. Para o League, a ordem é: a API oficial, se houver chave da Riot; o [[opgg]], se não houver chave ou se a API oficial falhar. O bloco do OP.GG só substitui o `stats.lol` salvo se for mais novo (`is_newer`), e um erro da API oficial fica em `errors.lol` só se o OP.GG também falhar. O pedido é um `POST` a `mcp-api.op.gg`, com o servidor pelo rótulo (`BR`, `EUW`…), 1 s entre contas (separado dos 80 ms da Riot) e sem nova tentativa: 429 e erro 5xx viram "OP.GG is busy, try again later", e o prazo estourado vira "OP.GG took too long to answer". O TFT e o VALORANT continuam como antes, com os erros de falta de chave guardados (os cartões não mostram `stats.errors`).
- **Cliente HTTP.** `RankHttp` ganhou `post`, com uma versão padrão que recusa, para as redes falsas dos testes. O `UreqHttp` usa o mesmo agente e a mesma leitura de resposta no `get` e no `post`, e aceita corpo em `text/event-stream` (junta as linhas `data:`).
- **Duas fontes.** LoL e TFT usam a API oficial da Riot (chave de developer.riotgames.com). VALORANT usa a HenrikDev (não oficial; chave de api.henrikdev.xyz), porque os endpoints ranqueados oficiais de VALORANT só estão abertos a apps de produção aprovados.
- **Fila com intervalo.** As requisições saem uma por vez, em sequência, com 80 ms entre duas próximas: a chave de desenvolvimento da Riot permite 20 requisições por segundo e 100 a cada 2 minutos. A fila é a mesma para Riot e HenrikDev.
- **429 com espera.** Até 3 novas tentativas, esperando dentro da fila o que o `retry-after` pede. Desde 2026-11-07 o cabeçalho vale em segundos ou como data HTTP (a espera é a diferença até a data, nunca negativa). Sem cabeçalho ou com valor ilegível, espera 5 s. Se o pedido passa de 60 s, não espera: vira erro na hora, para não travar a fila de todas as contas. Depois das 3 tentativas também vira erro.
- **Prazo por consulta.** Desde 2026-11-07 cada consulta tem `TIMEOUT_MS` (15 s), contado do pedido até o fim da leitura do corpo. Estourado o prazo, a consulta falha com "The rank service took too long to answer". O erro fica só naquele jogo da conta, como os outros, e a fila segue. Assim uma conexão presa não trava a fila nem a atualização do [[refresher]].
- **404 não é exceção.** A leitura devolve "não encontrado" e cada chamador escolhe a mensagem (`Riot ID … not found`, `No League profile on …`, `No VALORANT profile …`). League e TFT com 404 viram lista vazia.
- **Mensagem do corpo.** Outros erros HTTP usam `status.message`, `errors[0].message` ou `message` do corpo, se houver.
- **401 e 403.** Riot: chave inválida ou expirada (chaves de desenvolvimento expiram a cada 24 h). HenrikDev: `HenrikDev API key is invalid`.
- **Cache de PUUID por chave.** PUUIDs são criptografados por chave de API, então cada chave precisa da própria consulta. O cache mapeia um hash curto da chave (12 hex do SHA-256) para o Riot ID e o PUUID resolvidos. Só vale se o Riot ID ainda for igual. Com a mesma chave e a grafia já igual, o TFT reaproveita o PUUID que o LoL resolveu na mesma chamada.
- **Formato antigo descartado.** Versões antigas guardavam uma entrada única `{ key, riotId, puuid }`. Se `puuidCache.puuid` existe, o cache recomeça vazio.
- **Grafia igual à da Riot.** O nome devolvido pelo account-v1, por Riot ID ou por PUUID e com qualquer das chaves, entra em `fields` (`gameName`, `tagLine`) quando difere do salvo. Mantém a capitalização e as renomeações em sincronia.
- **Rede e tempo trocáveis.** A rede entra pela trait `RankHttp` e o tempo pelos `ApiHooks`, para os testes trocarem os dois. A fila, o cache de cortes e o relógio ficam na instância.
- **Riot ID trocado no site da Riot.** Revisão de 2026-11-05, pedido do usuário. Com o PUUID em cache e o Riot ID salvo igual ao do cache, cada atualização consulta `account-v1 /accounts/by-puuid` e devolve o nome atual quando mudou.
  - Uma consulta de conta por atualização: qualquer resposta do account-v1 na mesma atualização marca o nome como conferido (conferido uma vez por atualização).
  - Falha nessa conferência não vira erro: o PUUID salvo continua valendo. Um 404 cai na busca pelo Riot ID salvo.
  - TFT (inclusive com chave própria) e VALORANT da mesma atualização já usam o nome novo.
  - Riot ID editado no Eclipse, diferente do cache, continua buscando pelo nome digitado, para não ficar preso ao PUUID da conta anterior.
  - PUUIDs mudam com a chave. Com chave nova, a primeira busca é pelo nome salvo; uma conta renomeada antes disso dá "não encontrado" até o usuário corrigir o nome.
- **Cortes de Grão-Mestre e Desafiante.** Revisão de 2026-11-05, pedido do usuário. Quando Solo/Duo ou Flex está em Mestre+, baixa `challengerleagues`, `grandmasterleagues` e `masterleagues` daquela fila e região e grava `cutoffs` na entrada.
  - `ladder_cutoffs` junta as três listas, ordena por PdL e pega o PdL da posição igual ao tamanho atual de Desafiante (corte de Desafiante) e de Desafiante + Grão-Mestre (corte de Grão-Mestre). Assim conta os Mestres acima dos últimos Grão-Mestres, que sobem na próxima atualização diária.
  - É uma estimativa: supõe as vagas iguais ao tamanho atual das listas e ignora o PdL mínimo e o desempate da Riot. Lista vazia dá corte `null`; sem nenhum corte, a entrada fica sem `cutoffs`.
  - Cache por região e fila durante 10 min, compartilhado entre as contas da mesma atualização. Uma falha não fica em cache e não vira erro da conta.
  - Contas abaixo de Mestre não baixam as listas. TFT não tem cortes, porque o painel não mostra TFT.
- **Chave própria de TFT.** Chaves pessoais são emitidas por jogo, então o TFT pode ter a sua. Sem ela, usa a principal (chaves de desenvolvimento cobrem os dois jogos).
- **Culpar o TFT só com prova.** `This Riot key has no TFT access…` só aparece quando não há chave de TFT, a mesma chave funcionou no LoL e o TFT respondeu 401/403.
- **Apex sem divisão.** Master, Grandmaster e Challenger ficam com `division: ''`.
- **Última temporada de VALORANT.** `seasonal` lista os atos passados do mais antigo ao mais novo. A última entrada com jogos (`end_tier.id > 0`) é o último ato terminado.
- **Região de VALORANT.** `valRegion` da conta; senão `REGIONS[region].val`; senão `na`.
- **Conta HenrikDev é opcional.** Falha em `/v1/account` é ignorada; só faltam nível e card.
- **Card.** Se vier string, vira `media.valorant-api.com/playercards/<id>/smallart.png`; se vier objeto, usa `card.small`.
- **Erro não apaga dado antigo.** `stats` parte dos `stats` da conta. Um jogo com erro mantém os valores anteriores e ganha `errors.<jogo>`.
- **Sem Riot ID, nada é buscado.** Devolve só `errors.all`.
- **Resposta que não é JSON.** Uma resposta 2xx que não é JSON vira "The rank service sent an invalid answer", sem tradução. O hash da chave e a codificação da URL são os mesmos que o Electron usava, conferidos por teste, para o `puuidCache` gravado por ele continuar valendo.

## Testes

`src-tauri/tests/application/rank_api.rs`, com rede falsa, e dois testes do cliente real contra servidores locais. Cobre: hash da chave e codificação da URL iguais aos do Electron; conta renomeada seguindo o PUUID e uma só consulta de conta com o nome igual; conferência que falha sem perder o elo; Riot ID editado no Eclipse; cache antigo de PUUID único descartado; chave própria de TFT usando o nome novo achado pela chave do LoL; cálculo dos cortes e listas baixadas uma vez por região e fila, nada baixado abaixo de Mestre e falha das listas sem erro na conta; prazo estourado com texto fixo; `retry-after` em segundos, como data e longo demais; 80 ms entre pedidos; Riot ID ou chaves ausentes e chaves recusadas como erros fixos; VALORANT com pico, temporada passada e card; e o cliente real desistindo de uma resposta ou corpo que não chega e lendo status, `retry-after` e corpo de um erro. A prévia dos [[cards]] usa `stats` prontos de `scripts/dev/mock-api.js` ([[Desenvolvimento]]), com cortes nas contas de Mestre+.

## Pontos de atenção

- O intervalo de 80 ms não respeita o limite de 100 a cada 2 minutos. Com muitas contas, o app depende do `429`. Desde 2026-11-05 cada atualização gasta um pedido de conta a mais, e cada região e fila com conta em Mestre+ gasta 3 pedidos a cada 10 min (limite do método: 30 a cada 10 s e 500 a cada 10 min). A lista de Mestre pode ter milhares de entradas.
- O OP.GG e a HenrikDev são não oficiais e podem mudar endpoints ou formato ([[opgg]]). Ver [[Limitações conhecidas]] e [[Backlog]].
