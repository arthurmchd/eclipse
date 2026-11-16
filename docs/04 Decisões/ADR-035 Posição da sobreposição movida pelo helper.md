---
tipo: decisão
status: aceita
data: 2026-11-14
tags: [adr, arquitetura, tauri]
---

# ADR-035 Posição da sobreposição movida pelo helper

## Contexto

No primeiro uso do Eclipse em Tauri na Riot real (2026-11-14), o usuário viu os cartões ficarem para trás ao arrastar a Riot. Uma primeira correção (não reposicionar as webviews a cada movimento, [[riotOverlay]]) deixou o atraso "bem menor", mas, arrastando rápido, ele ainda sentia os cartões soltos da janela e pediu "uma espécie de fita".

Cada movimento percorria quatro etapas: o helper do [[riotWindowObserver]] recebia o aviso do Windows, escrevia uma linha de JSON, uma thread do Eclipse lia a linha e mandava uma tarefa à thread principal, que então movia a janela. Com um mouse de 1000 Hz chegam centenas de movimentos por segundo, e cada etapa é um lugar para a posição envelhecer.

## Decisão

No Tauri, **o helper move a sobreposição**. No mesmo instante em que mede a nova posição da Riot, ele chama `SetWindowPos` na janela da sobreposição, só com a posição, e espera a janela aplicar. O Eclipse em Rust deixa de mover a janela: cuida só do tamanho, da região, das webviews e de mostrar e esconder.

- O pedido ao helper leva `follow: true`. Só o Rust manda; o Electron não manda e continua movendo a janela por conta própria, como antes.
- A chamada espera a resposta (sem `SWP_ASYNCWINDOWPOS`). Enquanto a janela aplica uma posição, os avisos seguintes se acumulam no helper, e cada um mede a posição atual da Riot; os repetidos não movem nada. Assim, a sobreposição nunca recebe uma fila de posições velhas.
- A leitura de 180 ms repete a posição, então qualquer desencontro se corrige sozinho.
- Se a chamada falhar, o helper termina com erro, como já faz quando não consegue virar dono da janela, e a sobreposição fica oculta.
- A linha de JSON continua saindo a cada movimento; o Rust a usa para o tamanho, os cantos e as marcas.

## Alternativas consideradas

- **Sobreposição como janela filha da Riot (`SetParent`).** Seria a fita de verdade: o Windows moveria as duas juntas, sem atraso nenhum. Mas põe uma janela nossa dentro da árvore de janelas da Riot, onde o Chromium dela passa a ver uma filha que não criou, e a janela do Eclipse morreria junto com a da Riot a cada vez que ela fecha. Risco alto demais para um app que só deve ficar por cima. (Correção de 2026-11-14: a primeira versão desta nota dizia que só a janela filha juntaria as filas de entrada dos dois processos. Um teste com duas janelas próprias mostrou que a relação de dona, que o helper já usa, também junta; ver a [[ADR-036 Arraste da Riot assumido pelo Eclipse]].)
- **Gancho dentro do processo da Riot (`WINEVENT_INCONTEXT`).** Exige injetar código na Riot. Fora de questão.
- **Gancho de movimento no próprio Eclipse em Rust.** Tiraria o helper do caminho, com um despertar de thread a menos, mas duplicaria no Rust a escolha e a medição da janela, o código mais delicado e já conferido na Riot real. O ganho sobre esta decisão é pequeno.
- **Continuar movendo pelo Rust e só encurtar o caminho.** Já feito na primeira correção; o usuário ainda sentiu o atraso.

## Consequências

- O caminho de um movimento cai de quatro etapas para duas: o aviso do Windows chega ao helper, e o helper move a janela.
- Não existe "atraso zero" para uma janela que segue outra de fora do processo: o aviso do Windows chega depois de a Riot já ter se movido. Arrastando muito rápido, ainda pode aparecer um quadro de diferença.
- A posição passa a ter um dono só, o helper. O Rust nunca chama `SetWindowPos` com posição, senão uma linha velha puxaria a janela de volta.
- Se a thread principal do Eclipse travar, o helper fica esperando nela. Ele não segura a Riot (o gancho é fora de contexto) e é encerrado junto com o Eclipse.
- O helper continua alterando, por conta própria, só a janela da sobreposição ([[riotWindowObserver]]).

## Relacionado

- [[ADR-036 Arraste da Riot assumido pelo Eclipse]]: o que foi feito depois, porque o usuário ainda sentiu o atraso
- [[ADR-012 Sobreposição presa à janela do Riot]]
- [[ADR-033 Sobreposição no Tauri]]
- [[riotOverlay]] · [[riotWindowObserver]]
