---
tipo: módulo
arquivo: src/core/rankApi.js
camada: aplicação
testes: nenhum
tags: [módulo]
---

# rankApi

> Busca elos de LoL e TFT na API oficial da Riot e de VALORANT na HenrikDev, e devolve os campos a mesclar em cada conta.

## Responsabilidade

- Resolve o PUUID pelo Riot ID e consulta summoner e league (LoL), league de TFT e MMR de VALORANT.
- Traduz respostas e erros em `stats` e mensagens por jogo.
- Limita o ritmo das requisições e repete depois de `429`.
- **Não** grava nada: o [[main]] aplica o resultado com `store.updateAccountFields`. **Não** lê chaves: recebe de `store.getKeys()`.

Antes se chamava `riotApi` (`src/riotApi.js`); foi renomeado na reorganização ([[Estrutura de pastas]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `REGIONS` | constante | ID de plataforma → `label`, `routing` do account-v1 e região de VALORANT |
| `VAL_REGIONS` | constante | `br`, `na`, `latam`, `eu`, `kr`, `ap` |
| `refreshAccount(acc, keys)` | função assíncrona | Devolve `{ fields, errors }`: campos a mesclar na conta e erros por jogo |

`keys` é `{ riot, tft, henrik }`. `fields` pode ter `stats` (`lol`, `tft`, `val`, `errors`), `puuidCache`, `gameName` e `tagLine`.

## Dependências

- Usa: `fetch` global e `crypto` (SHA-256 da chave). Hosts: `<routing>.api.riotgames.com`, `<plataforma>.api.riotgames.com` e `api.henrikdev.xyz`. Monta URLs de card em `media.valorant-api.com`.
- Usado por: [[main]] (`refreshAll`; `REGIONS` e `VAL_REGIONS` no `init`). O [[renderer]] lê os campos via `rankOf`.

## Invariantes e decisões

- **Duas fontes.** LoL e TFT usam a API oficial da Riot (chave de developer.riotgames.com). VALORANT usa a HenrikDev (não oficial; chave de api.henrikdev.xyz), porque os endpoints ranqueados oficiais de VALORANT só estão abertos a apps de produção aprovados.
- **Fila global com intervalo.** As requisições saem uma por vez, com 80 ms entre elas: a chave de desenvolvimento da Riot permite 20 requisições por segundo e 100 a cada 2 minutos. A fila é a mesma para Riot e HenrikDev.
- **429 com espera.** Até 3 novas tentativas, esperando `retry-after` segundos (padrão 5) dentro da fila. Depois disso vira erro.
- **404 não é exceção.** `getJson` devolve `{ notFound: true }` e cada chamador escolhe a mensagem (`Riot ID … not found`, `No League profile on …`, `No VALORANT profile …`). League e TFT com 404 viram lista vazia.
- **Mensagem do corpo.** Outros erros HTTP usam `status.message`, `errors[0].message` ou `message` do corpo, se houver.
- **401 e 403.** Riot: chave inválida ou expirada (chaves de desenvolvimento expiram a cada 24 h). HenrikDev: `HenrikDev API key is invalid`.
- **Cache de PUUID por chave.** PUUIDs são criptografados por chave de API, então cada chave precisa da própria consulta. O cache mapeia um hash curto da chave (12 hex do SHA-256) para o Riot ID e o PUUID resolvidos. Só vale se o Riot ID ainda for igual. Com a mesma chave e a grafia já igual, o TFT reaproveita o PUUID que o LoL resolveu na mesma chamada.
- **Formato antigo descartado.** Versões antigas guardavam uma entrada única `{ key, riotId, puuid }`. Se `puuidCache.puuid` existe, o cache recomeça vazio.
- **Grafia igual à da Riot.** Quando o LoL resolve o PUUID, `gameName` e `tagLine` devolvidos pela Riot entram em `fields`, para manter a capitalização do Riot ID em sincronia.
- **Chave própria de TFT.** Chaves pessoais são emitidas por jogo, então o TFT pode ter a sua. Sem ela, usa a principal (chaves de desenvolvimento cobrem os dois jogos).
- **Culpar o TFT só com prova.** `This Riot key has no TFT access…` só aparece quando não há chave de TFT, a mesma chave funcionou no LoL e o TFT respondeu 401/403.
- **Apex sem divisão.** Master, Grandmaster e Challenger ficam com `division: ''`.
- **Última temporada de VALORANT.** `seasonal` lista os atos passados do mais antigo ao mais novo. A última entrada com jogos (`end_tier.id > 0`) é o último ato terminado.
- **Região de VALORANT.** `valRegion` da conta; senão `REGIONS[region].val`; senão `na`.
- **Conta HenrikDev é opcional.** Falha em `/v1/account` é ignorada; só faltam nível e card.
- **Card.** Se vier string, vira `media.valorant-api.com/playercards/<id>/smallart.png`; se vier objeto, usa `card.small`.
- **Erro não apaga dado antigo.** `stats` parte de `acc.stats`. Um jogo com erro mantém os valores anteriores e ganha `errors.<jogo>`.
- **Sem Riot ID, nada é buscado.** Devolve só `errors.all`.

## Testes

Nenhum teste automatizado. O preview do [[renderer]] usa `stats` prontos de `scripts/dev/mock-api.js` ([[Desenvolvimento]]).

## Pontos de atenção

- `fetch` não tem timeout. Uma requisição presa trava a fila global e, com ela, o `refreshAll` do [[main]].
- `retry-after` em formato de data HTTP vira `NaN`, e a espera vira zero.
- O intervalo de 80 ms não respeita o limite de 100 a cada 2 minutos. Com muitas contas, o app depende do `429`.
- Se o LoL falhar depois de resolver o PUUID, ou se só houver chave de TFT, o cache guarda a grafia da Riot mas `fields` não atualiza o nome. Com grafia diferente, o PUUID é consultado de novo a cada refresh.
- A HenrikDev é não oficial e pode mudar endpoints ou formato. Ver [[Limitações conhecidas]] e [[Backlog]].
