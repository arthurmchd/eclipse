---
tipo: decisão
status: aceita
data: 2026-11-04
tags: [adr, arquitetura, interface, janelas]
---

# ADR-013 Caixa para ocultar as contas na coluna de login

## Contexto

O usuário pediu, em 2026-11-04, uma cópia da caixa "Stay signed in" da Riot, posta à direita dela. Marcada, a cópia esconde o gerenciador inteiro; desmarcada, ele volta. Ao abrir o gerenciador, ela começa sempre desmarcada.

A caixa precisa ficar fora dos cartões, senão sumiria junto com eles e não daria para desmarcar. Até aqui a sobreposição começava à direita da coluna de login (`400/1536` da largura) e nunca pintava nem capturava cliques nessa coluna ([[ADR-011 Cartões sobre a arte do Riot]], [[ADR-012 Sobreposição presa à janela do Riot]]).

## Decisão

- **A janela da sobreposição cobre toda a área da Riot.** A região (`setShape`) continua decidindo onde ela pinta e recebe cliques. A visualização dos cartões fica à direita da coluna de login, no mesmo lugar e tamanho de antes (o [[managerHost]] recebe um recuo à esquerda).
- **A caixa é uma segunda visualização na mesma janela.** É uma página local pequena, com um preload que só manda um booleano, e fica num retângulo medido à direita do texto "Stay signed in" no Riot Client v142 (frações da área cliente). Ver [[overlayToggle]].
- **Na coluna de login, a região inclui só esse retângulo.** Campos, botões, a caixa da Riot e o resto da coluna continuam fora da captura de cliques.
- **Ocultar só tira os cartões da região.** Com a caixa marcada, a região fica só com a caixa. O estado vive na memória do main e começa desmarcado a cada início; nada é salvo.

## Alternativas consideradas

- **Segunda janela própria para a caixa.** Exigiria que o helper do [[riotWindowObserver]] prendesse e reordenasse duas janelas, e repetiria o cuidado com a oclusão do Chromium. Uma janela com duas visualizações reaproveita tudo isso.
- **Caixa no rodapé dos cartões.** Não esconderia "todo o gerenciador" e não ficaria ao lado da caixa da Riot, como foi pedido.
- **Lembrar o estado entre aberturas.** Descartado porque o pedido foi começar sempre desmarcado.

## Consequências

- A regra "a sobreposição não toca a coluna de login" passa a ter uma exceção: um retângulo de `144×32` em `1536×864`, sem nenhum controle da Riot embaixo. Se um layout futuro da Riot puser algo nesse ponto, a caixa cobre esse controle. As frações estão em [[overlayToggle]] e precisam de nova medida quando a Riot mudar a tela de login, como as de [[login.ps1]].
- A caixa só aparece quando os cartões apareceriam: na tela de login, com a Riot visível e sem login em andamento.
- O teste de geometria agora confere que, na coluna de login, a região contém só o retângulo da caixa.
- Nenhuma janela ou arquivo da Riot é alterado. O preload da caixa só aceita um booleano e confere o remetente.

## Relacionado

- [[riotOverlay]]
- [[overlayToggle]]
- [[managerHost]]
- [[ADR-012 Sobreposição presa à janela do Riot]]
