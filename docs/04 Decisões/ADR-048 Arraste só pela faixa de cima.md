---
tipo: decisão
status: aceita
data: 2026-11-23
tags: [adr, interface, tauri]
---

# ADR-048 Arraste só pela faixa de cima

## Contexto

Pedido do usuário em 2026-11-23: "eu consigo arrastar o eclipse de qualquer lugar, e gostaria que fosse apenas na parte superior igual a riot client ou qualquer aplicativo". Desde a [[ADR-041 Arraste da Riot pela área do Eclipse]], qualquer espaço vazio da página dos cartões começava o arraste conjunto: a faixa de cima, o fundo em volta dos cartões e as barras sem controle.

## Decisão

**Só a faixa de cima da página dos cartões, os primeiros 30 px (`TOP_STRIP` em `windowDrag.js`), começa o arraste conjunto.** É o espaço acima da busca, no lugar da barra de arrastar da Riot que os cartões cobrem. O resto da [[ADR-041 Arraste da Riot pela área do Eclipse]] não muda: o pedido, quando o [[overlayDrag]] assume, a captura e o registro.

- Dentro da faixa, botões, campos, os controles de minimizar e fechar, diálogos abertos e a barra de rolagem continuam fora, como antes.
- Os avisos (`.status` e `#notice`), que podem subir até a faixa, também ficam fora.
- A barra da Riot que sobra à vista na coluna de login segue arrastando pela [[ADR-036 Arraste da Riot assumido pelo Eclipse]].

## Alternativas consideradas

- **Faixa com a altura dos controles da Riot (`--u` × 24).** Acompanha a escala, mas fica fina em janelas pequenas e não cobre o espaço vazio acima da busca.
- **Medir a altura na hora pelo topo da barra de busca.** Muda quando a barra some ou um aviso aparece; um número fixo, igual à margem da barra, é previsível e testável.

## Consequências

- O fundo em volta dos cartões e a barra de baixo deixam de mover a janela; um clique ali volta a ser um clique comum.
- Mudar a margem de cima da barra de busca (`.toolbar`, 30 px) pede mudar o `TOP_STRIP` junto.
- Não conferido na Riot real: quem confere é o usuário.

## Relacionado

- [[ADR-041 Arraste da Riot pela área do Eclipse]]
- [[ADR-036 Arraste da Riot assumido pelo Eclipse]]
- [[cards]] · [[overlayDrag]]
