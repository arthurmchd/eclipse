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
| `lolCrest(tierId)` | função | Desde 2026-11-15: ícone do elo do League que vem com o app, `assets/rank-<elo>.png`, para os dez elos de Ferro a Desafiante. Sem elo, ou com um elo desconhecido, o símbolo cinza do CommunityDragon (`ranked-mini-crests/unranked.svg`). Até lá, os `ranked-mini-crests/*.svg` do CommunityDragon para todos |
| `lolEmblem`, `valIcon`, `valGroupIcon`, `profileIcon` | funções | URLs no CommunityDragon e no valorant-api |
| `valCardArt(card)` | função | Desde 2026-11-15: URL da arte quadrada (`smallart.png`) do cartão de jogador, o retrato das placas e da lista; de 2026-11-05 até lá, a arte larga (`wideart.png`). Tira o UUID de `card` (URL ou UUID puro); sem UUID, o cartão padrão do VALORANT |

## Dependências

- Usa: nada além de constantes próprias.
- Usado por: [[cards]], pelo `cardView.js` (`rankOf`, `lolCrest`, `profileIcon`, `valCardArt`).

## Invariantes e decisões

- **Ícones do elo dentro do app.** Pedido do usuário em 2026-11-15: os ícones antigos "não são bons". Ele baixou o pacote "Rank Icon Pack" do emoji.gg (`6401-rank-icon-pack-league-of-legends-emojigg-pack`), com nove emblemas de 130 × 130 px (Ferro a Desafiante, sem Esmeralda), em WebP com nome `.png`. Eles viraram PNG de verdade em `src/renderer/assets/`, que o Setup já leva e o [[assetProtocol]] já serve. O de Esmeralda foi feito do emblema oficial (`ranked-emblem/emblem-emerald.png`, 2560 × 1440) com o mesmo recorte do pacote, medido em Platina, Diamante e Ouro (escala 0,417 da arte de 1280 px, deslocamento −202, −81); refeito assim, o de Platina cai a 1 px do original do pacote. O pacote não tem "sem elo", por isso esse continua o do CommunityDragon. São a arte da Riot, no mesmo uso pessoal das imagens que o app já buscava.
- **Cartão só por ID.** `valCardArt` só aproveita um UUID. O `lolBanner`, que montava a URL do banner do League a partir do nome salvo, saiu em 2026-11-15 com o visual de placas, que não mostra banner. O host e o caminho são sempre montados aqui, então um valor salvo estranho não vira outra URL.
- **VALORANT sem RR.** Desde 2026-11-08 ([[ADR-031 Elo lido do próprio jogo, sem chave]]), um elo lido do jogo pode vir com `rr: null`. O `rankOf` mostra o elo sem a linha de RR, com a barra vazia, e pontua só pelo tier. Antes aparecia "null RR".
- **Pontuação.** LoL/TFT: índice do tier × 1000 + divisão × 100 + LP; Master+ sem divisão, barra até 1500 LP. VALORANT: tier × 1000 + RR, ranqueado a partir do tier 3, Radiant (27) com barra até 1000 RR. Sem elo na fila (ou VALORANT abaixo do tier 3): `score = -1`.
- **Emblemas de LoL.** Os arquivos têm 1280×720 com o emblema no meio; quem desenha precisa ampliar a imagem para passar do preenchimento.

## Testes

`test/renderer/ranks.test.js` cobre `climbOf` (Mestre para Grão-Mestre, Grão-Mestre e Desafiante contra o corte do Desafiante, sem corte ou abaixo de Mestre), `valCardArt` (UUID salvo ou cartão padrão), o VALORANT sem RR e os ícones do elo: cada elo do League aponta para um arquivo que existe em `src/renderer/assets/`, e só o sem elo continua remoto. `rankOf` também é exercitado pelo `test/renderer/cardView.test.js` dos [[cards]].

## Pontos de atenção

- `distributionGroups`, `QUEUES` e várias URLs eram usadas pela janela antiga e hoje não têm chamador nos cartões. Ficaram porque fazem parte das mesmas tabelas.
- As URLs dependem do layout do CommunityDragon e do valorant-api; uma mudança neles some com imagens, sem quebrar o resto.
