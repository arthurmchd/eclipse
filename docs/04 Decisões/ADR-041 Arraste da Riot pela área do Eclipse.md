---
tipo: decisão
status: aceita
data: 2026-11-21
tags: [adr, arquitetura, segurança, tauri]
---

# ADR-041 Arraste da Riot pela área do Eclipse

## Contexto

Pedido do usuário em 2026-11-21: "tem como fazer como eu conseguir arrastar o riot client e o eclipse junto pela parte de cima e pelo meio ali onde a area de onde o eclipse ocupa?".

Desde a [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]], os cartões cobrem a arte inteira da Riot, de `cards_left` até a borda direita e de cima a baixo. A barra de arrastar da Riot (`-webkit-app-region: drag`) fica embaixo deles nessa faixa e não recebe cliques. O arraste conjunto da [[ADR-036 Arraste da Riot assumido pelo Eclipse]] só começa pela barra da Riot que sobra à vista, na coluna de login. No `sign-in.log` real, esse arraste já funciona na Riot real ("Eclipse moved the Riot window and the cards together", várias vezes desde 2026-11-15).

## Decisão

**Apertar o botão principal num espaço vazio da página dos cartões começa o mesmo arraste conjunto da ADR-036.** Espaço vazio é a faixa de cima, o fundo em volta dos cartões e as barras sem controle. Botões, campos, listas de opção, rótulos, links, os cartões (que se arrastam para reordenar), os controles de minimizar e fechar, os diálogos e a barra de rolagem continuam como estão.

- **O pedido.** A página dos [[cards]] decide o ponto (`dragSpot` em `windowDrag.js`) e chama `api.dragRiot()`, que vira `windowAction` com `drag` no [[managerHost]]. O [[riotOverlay]] só repassa com os cartões à vista, e a janela posta para si mesma a mensagem `Eclipse.RiotDragStart` com `lParam` 1.
- **Quando assume.** Na thread principal, o [[overlayDrag]] só assume se a sobreposição estiver visível, tiver uma dona (a janela da Riot que o helper conferiu pelo executável oficial) e o botão principal ainda estiver apertado. Um clique rápido, solto antes de o pedido chegar, não faz nada.
- **Como.** A sobreposição toma a captura do mouse e confere que ficou com ela; senão, desiste e registra. Daí em diante é o arraste da ADR-036: ponto agarrado na Riot, as duas janelas num `DeferWindowPos` por movimento, batida de 15 ms, fim com o botão solto.
- **Sem laço da Riot.** Aqui a Riot não começa o próprio arraste, então não há a volta ao ponto inicial nem retomada da captura por causa dela.
- **Registro.** Duas linhas novas no `sign-in.log`, uma vez por execução: arraste pela área do Eclipse e captura que não ficou com o Eclipse.

## Alternativas consideradas

- **Deixar a faixa de cima fora da região de cliques**, para o clique cair na barra da Riot. Só resolve a faixa de cima, não o meio, e mostraria a barra branca da Riot atrás dos cartões escuros.
- **`data-tauri-drag-region` do Tauri.** Move só a janela do Eclipse; a Riot, dona dela, ficaria parada.
- **Mandar `WM_NCLBUTTONDOWN` com `HTCAPTION` para a Riot**, para ela começar o próprio arraste e cair na ADR-036. É mandar evento de mouse para a Riot, o que a ADR-036 recusou.

## Consequências

- O Eclipse passa a mover a janela da Riot também por um gesto do usuário na área dele, não só na barra da Riot. Continua sendo só durante um arraste com o botão apertado, só na janela conferida e sem nenhum evento mandado à Riot.
- A página dos cartões ganha um pedido novo, `windowAction` com `drag`, sem argumentos além do nome.
- O espaço vazio deixa de servir para nada além disso: um clique nele não seleciona texto nem tira o foco de um campo.
- Esses arrastes não têm o encaixe do Windows nas bordas da tela, como os da ADR-036.
- A captura tomada depende de as filas de entrada da janela e da WebView2 estarem juntas. Se não estiverem, o Eclipse desiste, registra e nada se move.
- Não conferido na Riot real: o laço do mouse não pode ser testado sem um mouse de verdade. Quem confere é o usuário.

## Relacionado

- [[ADR-036 Arraste da Riot assumido pelo Eclipse]]
- [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]
- [[overlayDrag]] · [[riotOverlay]] · [[cards]] · [[managerHost]] · [[Segurança e privacidade]]
