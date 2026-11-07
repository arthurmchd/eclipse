---
tipo: módulo
arquivo: src/renderer/ranks.js
camada: interface
testes: test/renderer/ranks.test.js
tags: [módulo]
---

# ranks

> Tabelas de elo, URLs de emblemas e a leitura do elo de uma conta por jogo e fila, para os [[cards]] desenharem.

## Responsabilidade

Transforma os `stats` públicos de uma conta no que um cartão mostra: tier, cor, emblema, divisão, pontos, vitórias, taxa e a distância até o próximo corte. Monta as URLs de imagens do CommunityDragon e do valorant-api.

**Não** faz requisições, não guarda estado e não recebe segredos. Os dados vêm do [[rankApi]], pelo main.

Até 2026-11-07 era documentado na nota da janela antiga ([[renderer]]), que também o usava. Desde a [[ADR-028 Modo antigo removido]], só os [[cards]] o importam.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `LOL_TIERS`, `VAL_GROUPS` | constantes | Tiers com nome e cor; grupos de VALORANT com seus números de tier |
| `QUEUES` | constante | `lol`: `solo`, `flex`; `tft`: `ranked`, `doubleUp`; `val`: `competitive` |
| `rankOf(acc, game, queue)` | função | Tudo que um cartão precisa para mostrar o elo de uma conta num jogo e fila: `group`, `color`, `emblem`, `emblemKind`, `label`, `sub`, `progress`, `score`, `level`, `wins`, `losses`, `winrate`, `hotStreak`, `climb`, `extra`, `lastSeason`, `lastChange`, `updatedAt`, `error` |
| `climbOf(entry)` | função | Desde 2026-11-05: para uma entrada de Mestre+ com `cutoffs`, `{ tier, cutoff, gap, holding }`. Mestre mira Grão-Mestre; Grão-Mestre e Desafiante miram Desafiante (`holding` no Desafiante); `gap` é corte menos PdL. Sem corte, `null` |
| `distributionGroups(game)` | função | Grupos de tiers com ícone, por jogo |
| `lolEmblem`, `lolCrest`, `valIcon`, `valGroupIcon`, `profileIcon` | funções | URLs no CommunityDragon e no valorant-api |
| `lolBanner(lol)` | função | Desde 2026-11-05: URL do banner do League. `lol.banner` (só `[a-z0-9_]`, em minúsculas) ou o banner ranqueado do melhor elo entre `solo` e `flex`; sem elo, `default` |
| `valCardArt(card)` | função | Desde 2026-11-05: URL da arte larga (`wideart.png`) do cartão de jogador. Tira o UUID de `card` (URL ou UUID puro); sem UUID, o cartão padrão do VALORANT |

## Dependências

- Usa: nada além de constantes próprias.
- Usado por: [[cards]] (`rankOf`, `lolCrest`, `profileIcon`, `lolBanner`, `valCardArt`).

## Invariantes e decisões

- **Banner e cartão só por ID.** `lolBanner` aceita só letras minúsculas, números e `_` no nome do banner, e `valCardArt` só aproveita um UUID. O host e o caminho são sempre montados aqui, então um valor salvo estranho não vira outra URL.
- **Pontuação.** LoL/TFT: índice do tier × 1000 + divisão × 100 + LP; Master+ sem divisão, barra até 1500 LP. VALORANT: tier × 1000 + RR, ranqueado a partir do tier 3, Radiant (27) com barra até 1000 RR. Sem elo na fila (ou VALORANT abaixo do tier 3): `score = -1`.
- **Emblemas de LoL.** Os arquivos têm 1280×720 com o emblema no meio; quem desenha precisa ampliar a imagem para passar do preenchimento.

## Testes

`test/renderer/ranks.test.js` cobre `climbOf` (Mestre para Grão-Mestre, Grão-Mestre e Desafiante contra o corte do Desafiante, sem corte ou abaixo de Mestre), `lolBanner` (nome salvo ou banner do melhor elo) e `valCardArt` (UUID salvo ou cartão padrão). `rankOf` é exercitado pelo teste com Electron real dos [[cards]].

## Pontos de atenção

- `distributionGroups`, `QUEUES` e várias URLs eram usadas pela janela antiga e hoje não têm chamador nos cartões. Ficaram porque fazem parte das mesmas tabelas.
- As URLs dependem do layout do CommunityDragon e do valorant-api; uma mudança neles some com imagens, sem quebrar o resto.
