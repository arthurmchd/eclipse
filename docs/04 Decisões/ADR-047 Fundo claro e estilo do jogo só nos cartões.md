---
tipo: decisão
status: aceita
data: 2026-11-23
tags: [adr, interface]
---

# ADR-047 Fundo claro e estilo do jogo só nos cartões

## Contexto

Pedido do usuário em 2026-11-23: "quero que cada jogo tenha uma estética diferente em cada página, porém a única coisa que eu quero que mude seja os cards. O fundo quero algo estático, moderno e parecido com a Riot e algum tom de branco."

Até a 2.19, cada aba trocava a página inteira ([[ADR-040 Visual da Riot e sons da interface]]): fundo, campos, caixas, rodapé e o botão Jogar seguiam o jogo, sobre o tema escuro do Riot Client.

> Desde 2026-11-23, o fundo pode ficar escuro por um botão ([[ADR-049 Fundo escuro opcional]]). O claro segue como padrão.

## Decisão

- **Uma página só para todos os jogos.** Fundo branco quente `#f2f1ee`, parado, com um brilho branco suave no canto de cima à esquerda e uma grade de pontos de 22 px a 7% de preto. Busca, filtros, faixa da lista, caixas, avisos e rodapé ficam brancos, com linhas `#e3e1dc` e texto `#141414`, iguais em todas as abas. O destaque, o foco e o botão Jogar usam o vermelho da Riot `#d13639`. O traço da aba escolhida no rodapé é preto, sem a cor do jogo.
- **Só os cartões mudam por jogo.** As placas e as linhas da lista recebem as variáveis `--plate*`, `--card-accent`, `--up`, `--down`, `--pin` e `--win-high` de cada aba. Dentro de um cartão, `--text`, `--muted`, `--line`, `--hover` e `--pressed` passam a valer as do cartão, então botões e textos internos seguem o jogo sem regra própria.
  - **League:** azul-noite em degradê, borda dourada em degradê com um filete interno, cantos retos, elo em dourado.
  - **VALORANT:** `#0f1923`, canto superior direito cortado, marca vermelha no alto à esquerda que cresce até a borda inteira ao passar o mouse, nome em maiúsculas, barra de RR vermelha.
  - **TFT:** roxo em degradê, cantos de 14 px, nível em dourado, elo em dourado claro.
  - **2XKO:** preto, dois cantos cortados, faixa verde-limão à esquerda, nível em limão, nome em itálico e maiúsculas.
  - **Runeterra:** pergaminho claro, borda e filete em bronze, cantos de 6 px.
  - **Riot:** branco com cantos de 12 px e borda vermelha ao passar o mouse.
- A webview dos cartões no Tauri abre com `#f2f1ee`, para não piscar outra cor enquanto a página carrega ([[riotOverlay]]).

## Alternativas consideradas

- **Manter o tema escuro e mudar só os cartões:** o usuário pediu fundo em tom de branco.
- **Branco puro `#ffffff` no fundo:** cartões brancos (Riot) e o pergaminho (Runeterra) sumiriam nele. O branco quente separa os cartões claros e combina com a coluna de login branca da Riot ao lado.
- **Arte ou animação no fundo:** o usuário pediu fundo estático; a arte do jogo já tinha sido recusada na [[ADR-040 Visual da Riot e sons da interface]].

## Consequências

- A página fica igual em todas as abas; a troca de jogo aparece só nos cartões e no ícone do rodapé.
- O botão Jogar não segue mais o jogo, e a aba Riot não tem mais o Jogar em pílula nem o + branco.
- Cartões escuros (League, VALORANT, TFT, 2XKO) sobre o fundo claro: as cores de subida e queda, estrela fixada e winrate têm um valor para cartão escuro e outro para cartão claro.
- Conferido só na prévia, num Edge sem janela a 1136 × 700. Não conferido sobre a Riot real.

## Relacionado

- [[cards]] · [[riotOverlay]] · [[ADR-040 Visual da Riot e sons da interface]] · [[Estudo - Visual da Riot]]
