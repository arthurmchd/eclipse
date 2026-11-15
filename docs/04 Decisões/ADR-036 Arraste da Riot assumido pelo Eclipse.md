---
tipo: decisão
status: aceita
data: 2026-11-14
tags: [adr, arquitetura, segurança, tauri]
---

# ADR-036 Arraste da Riot assumido pelo Eclipse

## Contexto

Depois da [[ADR-035 Posição da sobreposição movida pelo helper]], o usuário conferiu na Riot real e disse que continuava igual: arrastando a Riot rápido, os cartões não acompanham na hora. Ele pediu outra lógica.

Encurtar o caminho não resolve. Enquanto a Riot se move sozinha e o Eclipse corre atrás, a sobreposição só é movida depois de a Riot já ter se movido, e a tela pode ser desenhada entre os dois movimentos. A distância que aparece é o atraso vezes a velocidade do arraste, então ela cresce justamente quando o usuário arrasta rápido. Para sumir, as duas janelas precisam mudar de lugar na mesma operação do Windows.

Conferido em 2026-11-14:

- **Como a Riot é arrastada.** O `app.asar` oficial (só leitura) marca a barra de cima com `-webkit-app-region: drag` (`.app-controls-draggable-region`). No Windows, isso faz o próprio sistema rodar o laço de arraste dentro do processo da Riot, e ele avisa o começo com `EVENT_SYSTEM_MOVESIZESTART`.
- **Duas janelas, uma operação.** Com duas janelas de teste fora da tela, em dois processos, um `DeferWindowPos` moveu as duas juntas, 0,38 ms por movimento.
- **Captura do mouse.** Com as mesmas janelas: quando uma vira dona da outra por `GWLP_HWNDPARENT`, como o helper já faz entre a Riot e a sobreposição ([[ADR-012 Sobreposição presa à janela do Riot]]), o Windows junta as filas de entrada das duas threads. A captura do mouse tomada por uma passa a valer para as duas, e sai da outra. Sem a relação de dona, cada uma tem a sua.

## Decisão

Quando o usuário começa a arrastar a Riot com a sobreposição à vista, **o Eclipse assume o arraste** e move a Riot e a sobreposição juntas, num único `DeferWindowPos` por movimento do mouse. Só no Tauri.

- **Aviso do começo.** O helper do [[riotWindowObserver]] ganha um segundo gancho, `EVENT_SYSTEM_MOVESIZESTART`, só para o processo da janela escolhida e só com `follow`. No aviso, ele posta na janela da sobreposição a mensagem registrada `Eclipse.RiotDragStart`, com o identificador da janela da Riot.
- **Quando assume.** Na thread principal, a janela da sobreposição só assume se estiver visível, se a janela avisada for a dona dela (a que o helper conferiu pelo executável oficial), se o botão principal do mouse estiver apertado e se a Riot responder `HTCAPTION` ao `WM_NCHITTEST` no ponto do cursor. Mover pelo teclado e redimensionar ficam com a Riot.
- **Como assume.** A sobreposição toma a captura do mouse (`SetCapture`). O laço de arraste da Riot perde a captura e termina; o Windows trata isso como um Esc, e a janela volta para onde o arraste começou. A partir daí cada movimento do mouse chega à sobreposição, que calcula a posição das duas janelas pelo ponto em que a Riot foi agarrada e as move juntas.
- **Captura devolvida.** Ao terminar o próprio laço, a Riot solta a captura da fila, que já era da sobreposição. A sobreposição a toma de novo, no máximo 3 vezes por arraste.
- **Fim.** Botão solto, captura tomada por outra janela ou botão que deixou de estar apertado. A Riot fica onde foi deixada.
- **Rede de segurança.** Um temporizador de 15 ms, só durante o arraste, repete a posição (corrige a volta da Riot ao ponto inicial), encerra se o botão já estiver solto e desiste se a Riot ainda estiver no próprio laço depois de 3 batidas.
- **Quando não dá.** Se a Riot continuar com a captura depois do `SetCapture`, as filas não estão juntas: o Eclipse solta a sua e não mexe em nada. O arraste segue com a Riot, e a sobreposição a acompanha como na [[ADR-035 Posição da sobreposição movida pelo helper]].
- **O helper não puxa durante o arraste.** Enquanto a sobreposição tem a captura, o helper não a move; senão, uma medida de instantes atrás a puxaria de volta.
- **Registro.** O `sign-in.log` ganha uma linha, uma vez por execução, para cada desfecho: arraste assumido, captura que ficou com a Riot, Riot que continuou no próprio laço e ponto agarrado que não era a barra.

## Alternativas consideradas

- **Sobreposição como janela filha da Riot (`SetParent`).** O Windows moveria as duas juntas em qualquer movimento, não só no arraste. Mas a janela do Eclipse passaria a morrer junto com a da Riot (ela fecha a janela ao ir para o segundo plano e abre uma pequena antes da principal), teria de ser recriada com as três webviews a cada vez, ficaria dentro da árvore de janelas da Riot e mudaria o jeito de a caixa transparente se misturar com a tela dela. É uma reescrita da sobreposição que só a Riot real pode conferir.
- **Encerrar o laço da Riot com um botão solto de mentira (`WM_LBUTTONUP`).** Evitaria a volta ao ponto inicial, mas é mandar um evento de mouse para a Riot. A captura não manda nada: é o Windows que avisa a Riot.
- **Faixa própria por cima da barra da Riot**, para o arraste já começar no Eclipse. Exigiria saber a forma exata da barra e pôr mais área do Eclipse na coluna de login, contra a regra de que ali só a caixa recebe cliques ([[ADR-013 Caixa para ocultar as contas na coluna de login]]).
- **Esconder os cartões enquanto a Riot é arrastada.** Simples e seguro, mas os cartões somem a cada arraste. Fica como saída se o arraste assumido não funcionar na Riot real.

## Consequências

- Nesse arraste, e só nele, o Eclipse move a janela da Riot. É a terceira ação dele na janela da Riot, depois de minimizar e fechar ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]), e também só acontece por um gesto do usuário na própria Riot.
- Durante o arraste, o Eclipse lê a posição do cursor e o estado do botão principal do mouse. Não há gancho de mouse nem de teclado, nada é gravado e nenhum evento é enviado à Riot.
- No começo do arraste, a Riot volta alguns pixels, até o ponto onde foi agarrada, por no máximo um quadro, e segue dali.
- Esses arrastes não têm o encaixe do Windows nas bordas da tela.
- Cada movimento espera a Riot responder. Se a Riot travar no meio de um arraste, a thread principal do Eclipse espera junto com ela.
- A captura tomada de outra thread depende de as filas de entrada estarem juntas. Isso vem da relação de dona, que o helper já confere a cada leitura; sem ela, o Eclipse desiste e nada muda.
- No Electron nada muda.
- Não conferido na Riot real: o laço de arraste do Windows não pode ser testado sem um mouse de verdade. Quem confere é o usuário.

## Relacionado

- [[ADR-035 Posição da sobreposição movida pelo helper]]
- [[ADR-012 Sobreposição presa à janela do Riot]]
- [[ADR-033 Sobreposição no Tauri]]
- [[riotOverlay]] · [[riotWindowObserver]] · [[Segurança e privacidade]]
