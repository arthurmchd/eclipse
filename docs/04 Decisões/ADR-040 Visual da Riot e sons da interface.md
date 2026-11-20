---
tipo: decisão
status: aceita
data: 2026-11-20
tags: [adr, interface, segurança]
---

# ADR-040 Visual da Riot e sons da interface

## Contexto

Pedido do usuário em 2026-11-20: "quero deixar o Eclipse com mais cara de Riot Games". O [[Estudo - Visual da Riot]] levantou nove itens. O usuário os comparou numa página fora do projeto e escolheu "todas as mudanças menos a da arte no fundo": tema escuro do Riot Client, fonte Inter, movimento da Riot, estilo próprio em cada aba, sons de interface (opcionais), cantos e sombras do Riot Client, cores de aviso da Riot e rótulos em maiúsculas.

Duas dessas mudanças tocam regras de [[Segurança e privacidade]]: os sons vêm de fora e o tema escuro substitui o fundo claro de [[ADR-011 Cartões sobre a arte do Riot]].

## Decisão

- Os cartões passam ao tema escuro do Riot Client, com a Inter local (`@fontsource/inter`, pesos 400 a 700), e cada jogo ganha seu estilo.
- Os sons do cliente do League tocam com "Sons da interface" ligado nas configurações, que vem ligado desde a 2.15.1 (na 2.15.0 vinha desligado). Os arquivos `.ogg` vêm da CommunityDragon na hora, como os ícones, e não entram no Setup. A CSP de `cards.html` ganha `media-src https://raw.communitydragon.org`, e só isso.
- A arte do jogo no fundo fica de fora, por escolha do usuário.

## Alternativas consideradas

- **Sons dentro do Setup.** Recusada: são arquivos da Riot, e o Setup é público.
- **Sons desligados por padrão.** Foi a escolha da 2.15.0. Revisão de 2026-11-20, pedido do usuário: "pode deixar o som como ligado como padrão?". Desligar continua nas configurações e fica salvo.
- **Ler os sons da instalação do League.** Recusada: eles vêm dentro de um `.wad`, e o Eclipse teria de ler e extrair um formato da Riot só para isso.

## Consequências

- Com os sons ligados, que é o padrão desde a 2.15.1, a CommunityDragon recebe o IP do usuário e o nome do arquivo de som no primeiro gesto que toca cada som, igual ao que já acontece com os ícones. Com os sons desligados, nenhum pedido é feito.
- A CSP continua sem `connect-src`, sem script de fora e sem `style` inline. O áudio não executa código.
- O fundo escuro destoa da coluna branca de login da Riot ao lado. O usuário escolheu isso vendo a comparação.

## Relacionado

- [[Estudo - Visual da Riot]] · [[cards]] · [[Segurança e privacidade]] · [[ADR-011 Cartões sobre a arte do Riot]]
