---
tipo: decisão
status: aceita
data: 2026-11-04
tags: [adr, arquitetura, interface, janelas, segurança]
---

# ADR-016 Riot sem animação de minimizar e cartões com os cantos dela

## Contexto

Em 2026-11-04 a área dos cartões ganhou fundo branco no lugar da arte da Riot ([[ADR-011 Cartões sobre a arte do Riot]]). O usuário quer ver a arte só quando ele mesmo ocultar as contas. Dois problemas apareceram com a Riot real:

- **A arte pisca ao minimizar.** A sobreposição pertence à janela da Riot ([[ADR-012 Sobreposição presa à janela do Riot]]). Ao minimizar, o Windows esconde a sobreposição na hora e anima a janela da Riot sozinha até a barra de tarefas, com a arte à mostra. Ao restaurar, a animação volta com a arte, e os cartões só reaparecem quando o retrato do helper chega ao [[riotOverlay]].
- **O fundo sai da janela.** Medido na Riot aberta, sem alterar nada: área cliente 1536 × 864; borda visível do DWM 1 px além dela à esquerda, à direita e embaixo; preferência de cantos `DWMWCP_ROUND` (raio de 8 px a 100%). A sobreposição tem cantos retos e cobre a área cliente, então as pontas superior e inferior direitas passam do arredondado. Com o fundo transparente isso não aparecia.

## Decisão

- **Sem animação de minimizar e restaurar na janela da Riot.** Enquanto acompanha uma janela, o helper do [[riotWindowObserver]] liga `DWMWA_TRANSITIONS_FORCEDISABLED` nela. Minimizar e restaurar ficam instantâneos, sem a arte em movimento. Ao trocar de janela, quando o gerenciador fecha (fim da entrada padrão) ou quando o processo dono termina, o helper desliga o atributo de volta. Se o helper for encerrado à força, a Riot fica sem animação até a janela fechar; nada é gravado em disco.
- **A volta dos cartões continua pelo Electron.** O `hide` explícito com a Riot minimizada e o `showInactive` no primeiro retrato restaurado não mudam ([[riotOverlay]]).
- **Chromium sem animação de janela.** Revisão do mesmo dia: o usuário ainda via a arte por menos de 1 s ao restaurar a Riot depois de minimizar, e não ao voltar por Alt+Tab. Medido com uma janela de teste e leitura da cor do pixel na tela: numa janela transparente, o Chromium faz a janela surgir aos poucos, em cerca de 200 ms, a cada `show`, e a arte aparece através dela. O modo sobreposto passa a ligar a opção de linha de comando `wm-window-animations-disabled` ([[main]]); com ela, a janela transparente aparece no primeiro quadro (19 a 24 ms) e a região continua recortando.
- **Os cartões seguem os cantos da Riot.** O helper informa no retrato o raio dos cantos da janela em pixels físicos (`corner`), lido de `DWMWA_WINDOW_CORNER_PREFERENCE` e da escala da janela: 8 para arredondado ou padrão, 4 para arredondado pequeno, 0 sem arredondar, maximizada ou sem resposta (Windows 10). O [[riotOverlay]] tira das pontas direitas da região um quarto de círculo de raio `corner − 1` (a borda de 1 px do DWM), linha a linha.
- **Regra do helper.** Além de minimizar e fechar a pedido do usuário ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]), o helper altera um único atributo visual da janela da Riot escolhida e conferida pelo executável oficial. Não muda posição, tamanho, estilo, ordem nem conteúdo, e não lê título, conteúdo ou credenciais.

## Alternativas consideradas

- **O helper mostrar os cartões ao ver a Riot restaurada** (`ShowWindowAsync` na sobreposição, antes do aviso ao Electron): testado em 2026-11-04 com uma janela Electron transparente com view, o Chromium não volta a desenhar quando a janela é mostrada por fora. A página continua oculta e a captura nunca termina, e o `riotOverlay` não chamaria `showInactive` porque a janela já estaria visível. Os cartões poderiam ficar invisíveis.
- **Janela da sobreposição opaca:** também aparece no primeiro quadro, mas o Electron ignora a região ao pintar uma janela opaca. Fora da região a tela fica cinza-escura (`#202020`) em vez de mostrar a Riot, e a coluna de login ficou preta na Riot real (2026-11-04). Vale com e sem `thickFrame` e sombra.
- **Desligar a transição do DWM na janela da sobreposição, `thickFrame: false` ou `backgroundThrottling: false`:** medidos, não mudam o surgimento de 200 ms.
- **Deixar o Windows esconder e mostrar os cartões com a Riot:** já falhou com a Riot real (a Riot voltava sozinha logo depois de minimizar; ver [[riotOverlay]]).
- **Desligar as animações do sistema** (`SPI_SETANIMATION`): muda uma configuração do Windows para todos os programas.
- **Minimizar só pela cópia sem animação** (`SetWindowPlacement`): não cobre a barra de tarefas, Win+↓ nem a restauração.
- **Cantos arredondados no CSS:** a view tem fundo próprio e não recorta a janela; a região (`setShape`) recorta a página, a view e os cliques de uma vez.
- **Medir a borda pelo `DWMWA_EXTENDED_FRAME_BOUNDS`:** mais exato, mas o raio `corner − 1` com o mesmo centro já coincide linha a linha com o arredondado medido a 100%.

## Consequências

- Com o Eclipse aberto, a Riot minimiza e restaura sem animação, também pela barra de tarefas e por atalhos, mesmo depois de entrar na conta.
- Ao restaurar ainda pode aparecer a arte por um ou dois quadros: os cartões voltam pelo retrato do helper, cerca de 15 ms depois da Riot (medido com uma Riot falsa em Electron), e a janela aparece no primeiro quadro, sem o surgimento do Chromium. A arte também aparece antes da primeira leitura do login, quando a Riot abre.
- A janela da sobreposição precisa continuar transparente: só assim a região recorta a pintura. Animações de janela do Chromium ficam desligadas no app inteiro no modo sobreposto.
- A região tem bordas sem suavização; o arredondado do DWM é suavizado. A diferença fica em menos de 1 px.
- O raio vem de valores fixos do Windows 11 (8 e 4 a 96 DPI). Se o Windows mudar o raio, as pontas voltam a sobrar ou faltar alguns pixels.
- Não foi conferido com a Riot real. O autoteste usa janelas próprias do helper; o atributo também foi aceito numa janela de outro processo de teste.

## Relacionado

- [[ADR-011 Cartões sobre a arte do Riot]]
- [[ADR-012 Sobreposição presa à janela do Riot]]
- [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]
- [[riotWindowObserver]]
- [[riotOverlay]]
- [[Segurança e privacidade]]
