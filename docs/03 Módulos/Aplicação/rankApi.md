---
tipo: módulo
arquivo: src/core/rankApi.js
camada: aplicação
testes: test/core/rankApi.test.js
tags: [módulo]
---

# rankApi

> Busca elos de LoL e TFT na API oficial da Riot e de VALORANT na HenrikDev, e devolve os campos a mesclar em cada conta.

## Responsabilidade

- Resolve o PUUID pelo Riot ID, confere pelo PUUID salvo se o Riot ID mudou e consulta summoner e league (LoL), league de TFT e MMR de VALORANT.
- Em Mestre, Grão-Mestre e Desafiante, estima os cortes de Grão-Mestre e Desafiante da fila e da região.
- Traduz respostas e erros em `stats` e mensagens por jogo.
- Limita o ritmo das requisições e repete depois de `429`.
- **Não** grava nada: o [[main]] aplica o resultado com `store.updateAccountFields`. **Não** lê chaves: recebe de `store.getKeys()`.

Antes se chamava `riotApi` (`src/riotApi.js`); foi renomeado na reorganização ([[Estrutura de pastas]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `REGIONS` | constante | ID de plataforma → `label`, `routing` do account-v1 e região de VALORANT |
| `VAL_REGIONS` | constante | `br`, `na`, `latam`, `eu`, `kr`, `ap` |
| `createRankApi({ fetch, wait, now, timeoutMs })` | fábrica | Instância com fila, cache de cortes e relógio próprios; devolve `{ refreshAccount }` |
| `refreshAccount(acc, keys)` | função assíncrona | Da instância padrão. Devolve `{ fields, errors }`: campos a mesclar na conta e erros por jogo |
| `ladderCutoffs([challenger, grandmaster, master])` | função | PdL do corte de Desafiante e de Grão-Mestre a partir das três listas de entradas |

`keys` é `{ riot, tft, henrik }`. `fields` pode ter `stats` (`lol`, `tft`, `val`, `errors`), `puuidCache`, `gameName` e `tagLine`. Em Mestre+, `stats.lol.solo` e `stats.lol.flex` ganham `cutoffs: { challenger, grandmaster }`.

## Dependências

- Usa: `fetch` (global na instância padrão, injetável na fábrica) e `crypto` (SHA-256 da chave). Hosts: `<routing>.api.riotgames.com`, `<plataforma>.api.riotgames.com` e `api.henrikdev.xyz`. Monta URLs de card em `media.valorant-api.com`.
- Usado por: [[main]] (`refreshAll`; `REGIONS` e `VAL_REGIONS` no `init`). Os [[cards]] leem os campos via `rankOf` ([[ranks]]).

## Invariantes e decisões

- **Chaves opcionais.** Desde 2026-11-08 ([[ADR-031 Elo lido do próprio jogo, sem chave]]), o elo também vem do jogo aberto, sem chave ([[rankWatcher]], [[gameRanks]]). Sem nenhuma chave, o [[main]] nem chama este módulo. Com chave, ele continua escrevendo os `stats` inteiros, e uma leitura do jogo depois escreve por cima: vale a mais recente.
- **Duas fontes.** LoL e TFT usam a API oficial da Riot (chave de developer.riotgames.com). VALORANT usa a HenrikDev (não oficial; chave de api.henrikdev.xyz), porque os endpoints ranqueados oficiais de VALORANT só estão abertos a apps de produção aprovados.
- **Fila global com intervalo.** As requisições saem uma por vez, com 80 ms entre elas: a chave de desenvolvimento da Riot permite 20 requisições por segundo e 100 a cada 2 minutos. A fila é a mesma para Riot e HenrikDev.
- **429 com espera.** Até 3 novas tentativas, esperando dentro da fila o que o `retry-after` pede. Desde 2026-11-07 o cabeçalho vale em segundos ou como data HTTP (a espera é a diferença até a data, nunca negativa). Sem cabeçalho ou com valor ilegível, espera 5 s. Se o pedido passa de 60 s, não espera: vira erro na hora, para não travar a fila de todas as contas. Depois das 3 tentativas também vira erro.
- **Prazo por consulta.** Desde 2026-11-07 cada consulta tem `timeoutMs` (padrão 15 s), contado do pedido até o fim da leitura do corpo. Estourado o prazo, o pedido é abortado pelo `signal` e a consulta falha com "The rank service took too long to answer". O erro fica só naquele jogo da conta, como os outros, e a fila segue. Assim uma conexão presa não trava a fila nem o `refreshAll` do [[main]].
- **404 não é exceção.** `getJson` devolve `{ notFound: true }` e cada chamador escolhe a mensagem (`Riot ID … not found`, `No League profile on …`, `No VALORANT profile …`). League e TFT com 404 viram lista vazia.
- **Mensagem do corpo.** Outros erros HTTP usam `status.message`, `errors[0].message` ou `message` do corpo, se houver.
- **401 e 403.** Riot: chave inválida ou expirada (chaves de desenvolvimento expiram a cada 24 h). HenrikDev: `HenrikDev API key is invalid`.
- **Cache de PUUID por chave.** PUUIDs são criptografados por chave de API, então cada chave precisa da própria consulta. O cache mapeia um hash curto da chave (12 hex do SHA-256) para o Riot ID e o PUUID resolvidos. Só vale se o Riot ID ainda for igual. Com a mesma chave e a grafia já igual, o TFT reaproveita o PUUID que o LoL resolveu na mesma chamada.
- **Formato antigo descartado.** Versões antigas guardavam uma entrada única `{ key, riotId, puuid }`. Se `puuidCache.puuid` existe, o cache recomeça vazio.
- **Grafia igual à da Riot.** O nome devolvido pelo account-v1, por Riot ID ou por PUUID e com qualquer das chaves, entra em `fields` (`gameName`, `tagLine`) quando difere do salvo. Mantém a capitalização e as renomeações em sincronia.
- **Fábrica.** Revisão de 2026-11-05: `createRankApi({ fetch, wait, now, timeoutMs })` guarda a fila, o cache de cortes e o relógio na instância, para os testes trocarem rede e tempo. O módulo exporta o `refreshAccount` de uma instância padrão, que o [[main]] usa.
- **Riot ID trocado no site da Riot.** Revisão de 2026-11-05, pedido do usuário. Com o PUUID em cache e o Riot ID salvo igual ao do cache, cada atualização consulta `account-v1 /accounts/by-puuid` e devolve o nome atual quando mudou.
  - Uma consulta de conta por atualização: qualquer resposta do account-v1 na mesma atualização marca o nome como conferido (`context.checked`).
  - Falha nessa conferência não vira erro: o PUUID salvo continua valendo. Um 404 cai na busca pelo Riot ID salvo.
  - TFT (inclusive com chave própria) e VALORANT da mesma atualização já usam o nome novo.
  - Riot ID editado no Eclipse, diferente do cache, continua buscando pelo nome digitado, para não ficar preso ao PUUID da conta anterior.
  - PUUIDs mudam com a chave. Com chave nova, a primeira busca é pelo nome salvo; uma conta renomeada antes disso dá "não encontrado" até o usuário corrigir o nome.
- **Cortes de Grão-Mestre e Desafiante.** Revisão de 2026-11-05, pedido do usuário. Quando Solo/Duo ou Flex está em Mestre+, baixa `challengerleagues`, `grandmasterleagues` e `masterleagues` daquela fila e região e grava `cutoffs` na entrada.
  - `ladderCutoffs` junta as três listas, ordena por PdL e pega o PdL da posição igual ao tamanho atual de Desafiante (corte de Desafiante) e de Desafiante + Grão-Mestre (corte de Grão-Mestre). Assim conta os Mestres acima dos últimos Grão-Mestres, que sobem na próxima atualização diária.
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
- **Erro não apaga dado antigo.** `stats` parte de `acc.stats`. Um jogo com erro mantém os valores anteriores e ganha `errors.<jogo>`.
- **Sem Riot ID, nada é buscado.** Devolve só `errors.all`.
- **Versão Rust (fase 3 da [[Migração para Tauri]]).** `src-tauri/src/application/rank_api.rs`, testes em `src-tauri/tests/application/rank_api.rs`. O HTTP entra pelo `RankHttp`; o real (`UreqHttp`) usa o TLS do Windows com os certificados do sistema, e o prazo de 15 s cobre também a leitura do corpo, conferido por teste contra um servidor local que nunca responde e outro que para no meio do corpo. As chamadas são em sequência, com 80 ms entre duas próximas, como a fila do JS; as duas chamadas que o JS fazia com `Promise.all` já saíam em fila, então nada ficou mais lento. O hash da chave e a codificação da URL batem com o Node (conferido por teste). Uma resposta 2xx que não é JSON vira "The rank service sent an invalid answer", sem tradução.

## Testes

`test/core/rankApi.test.js`, com `fetch` falso, cobre: conta renomeada seguindo o PUUID (LoL, TFT com chave própria e VALORANT), uma só consulta de conta com o nome igual, conferência que falha sem perder o elo, Riot ID editado no Eclipse, cálculo dos cortes, listas baixadas uma vez por região e fila e de novo depois de 10 min, nada baixado abaixo de Mestre e falha das listas sem erro na conta. Desde 2026-11-07 cobre também o prazo (resposta e corpo que nunca chegam, pedido abortado, fila liberada para o jogo seguinte) e o `retry-after` em segundos, como data futura ou passada, ilegível, ausente e longo demais. O preview do [[renderer]] usa `stats` prontos de `scripts/dev/mock-api.js` ([[Desenvolvimento]]), com cortes nas contas de Mestre+.

## Pontos de atenção

- O intervalo de 80 ms não respeita o limite de 100 a cada 2 minutos. Com muitas contas, o app depende do `429`. Desde 2026-11-05 cada atualização gasta um pedido de conta a mais, e cada região e fila com conta em Mestre+ gasta 3 pedidos a cada 10 min (limite do método: 30 a cada 10 s e 500 a cada 10 min). A lista de Mestre pode ter milhares de entradas.
- A HenrikDev é não oficial e pode mudar endpoints ou formato. Ver [[Limitações conhecidas]] e [[Backlog]].
