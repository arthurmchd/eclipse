---
tipo: módulo
arquivo: [src-tauri/src/integration/overlay/overlay_toggle.rs, src/integration/overlay/toggle.html]
camada: integração
testes: src-tauri/tests/integration/overlay/overlay_toggle.rs
tags: [módulo, interface]
---

# overlayToggle

> Desenha a caixa "Ocultar contas" ao lado do "Stay signed in" da Riot e avisa o [[riotOverlay]] quando ela muda.

## Responsabilidade

É a webview `toggle` da janela da sobreposição, criada em `overlay_window.rs`, com a página `src/integration/overlay/toggle.html` (`toggle.css`, `toggle.js`, `toggle-check.svg`). `overlay_toggle.rs` tem o retângulo da caixa, o script de inicialização que cria o `window.toggle` e os scripts fixos de idioma. A página copia a caixa "Stay signed in" da Riot (ver "Visual igual ao da Riot"). Não guarda o estado nem decide o que esconder; isso é do [[riotOverlay]]. Pedido e decisão: [[ADR-013 Caixa para ocultar as contas na coluna de login]].

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `toggle_rect(tamanho)` | função | Retângulo da caixa em coordenadas da área cliente da Riot (`TOGGLE_AREA`, em frações) |
| `INIT_SCRIPT` | constante | Cria o `window.toggle` da página: `setHidden(oculto)` chama o comando; `onLanguage` e `onHidden` recebem os avisos |
| `language_script(idioma)` | função | Um de dois textos fixos, para `pt` ou `en` |
| `hidden_script(oculto)` | função | Um de dois textos fixos, para marcar ou desmarcar a caixa |
| `COMMAND` | constante | `overlay_toggle`, o comando que a página chama a cada clique |
| `TOGGLE_LABEL` | constante | `toggle`, o rótulo da webview (em `overlay_window.rs`) |

## Dependências

- Usa: [[assetProtocol]] (a página, por lista fechada) e as fontes Inter do projeto.
- Usado por: [[riotOverlay]] (posição, visibilidade e idioma) e [[main]] (o comando `overlay_toggle`, que repassa o clique ao [[riotOverlay]]).

## Invariantes e decisões

- **Posição medida no Riot Client v142.** O retângulo vai de `200/1536` a `344/1536` da largura e de `418/864` a `450/864` da altura: começa depois do texto "Stay signed in" (que termina em 177 px), acaba na borda direita do formulário (344 px) e cobre a linha da caixa da Riot (426 a 441 px). Medido numa captura de 1536×864, em 2026-11-04, com a mesma base em frações de [[loginForm]] (`$REMEMBER` 0.0417, 0.5023). A página usa a unidade `100vw / 144` para tudo, então a caixa escala junto com a janela.
- **Visual igual ao da Riot.** Revisão de 2026-11-04, a pedido do usuário ("tamanho, arredondamento, cor, tudo"). Valores tirados da regra `.mobile-checkbox` do CSS da tela de login (lido na cópia privada, sem alterar nada) e conferidos pixel a pixel numa captura: quadrado de 16 px, `border-radius: 20%`, cinza `rgba(126,126,126,.15)` (`.25` com o mouse em cima), marcada `#d53235` (medido na tela; `#bc252a` com o mouse) com visto branco `#f9f9f9` desenhado no mesmo traço da Riot (SVG de 19 px, traço 3, 60% do quadrado, centrado a 35% da altura). Texto Inter (`@fontsource/inter`) de 14 px, `line-height` 120%, cor `#292929`, `#333` marcada e `#111` marcada com o mouse. A Riot declara peso 500, mas o Inter dela é de outra versão e desenha mais fino; com o Inter do projeto, o peso 400 com `letter-spacing` de 0,3 px e o texto 2 px mais perto da caixa que `.75em` deram a mesma largura (33 a 128 px a partir do retângulo), a mesma altura (10 a 23 px) e quase a mesma quantidade de tinta (55,4 mil contra 56,5 mil). `will-change: transform` no rótulo força suavização em tons de cinza, como a da Riot; sem isso o texto saía com franjas coloridas e parecia mais escuro.
- **Fundo opaco `#fcfcfc`.** É a cor medida do painel de login da Riot. Fundo opaco deixa o texto nítido; se a Riot mudar a cor do painel, a caixa precisa acompanhar.
- **Começa desmarcada.** A página não lê estado salvo. Cada início do Eclipse cria a página de novo, desmarcada, como foi pedido.
- **Comando mínimo.** A página só chama `overlay_toggle` com um booleano. A capacidade do Tauri libera o comando só para a webview `toggle`, e o [[main]] ainda confere o rótulo e o endereço. A webview não tem permissões, navegação para fora, downloads nem janelas novas. Até a 2.28.4 usava perfil anônimo; desde a 2.29.0 usa o perfil dos cartões e divide um processo de renderização com a cobertura; os cartões ficaram noutro ([[ADR-052 Webviews da sobreposição num processo só]]). A página não guarda nada no navegador.
- **Falha volta a caixa.** Se o aviso ao Eclipse falhar, a página desfaz a marcação para não mostrar um estado que não vale.
- **Texto no idioma salvo.** Revisão de 2026-11-04 ([[ADR-014 Interface em português e inglês]]): a página mostra "Ocultar contas" ou "Hide accounts". O idioma chega por `eval` de um de dois textos fixos (`language_script`), nunca montado com o valor recebido; qualquer valor diferente de `en` vira `pt`. O script de inicialização guarda o último valor e o entrega a quem se inscrever depois, e a janela manda o idioma de novo quando a página termina de carregar, para ele não se perder antes do `toggle.js` rodar. A página troca o texto, o `lang` e o título. Antes do aviso chegar, o HTML já mostra o português.
- **Marcada de fora, sem uso.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): a cópia do perfil da Riot ocultava as contas e marcava a caixa sem clique. Desde 2026-11-06 a cópia saiu dos [[cards]], e nada mais marca a caixa de fora. O `hidden_script` e o `onHidden` da página continuam, sem uso.
- **Some durante o login.** Desde 2026-11-06 ([[ADR-024 Coluna de login coberta durante o login]]), enquanto o [[overlayCover]] cobre a coluna, o [[riotOverlay]] esconde a webview da caixa (`set_toggle_visible`) e depois a traz de volta, com a marcação que tinha. A página não sabe disso e não guarda nada. Desde a [[ADR-025 Caixa some junto com o formulário da Riot]], o [[riotOverlay]] também a esconde enquanto a caixa "Stay signed in" da Riot está fora da tela, como depois do clique em entrar no login manual.

## Testes

`src-tauri/tests/integration/overlay/overlay_toggle.rs` confere o retângulo à direita do "Stay signed in" em dois tamanhos, escalando com a janela, e que a página só manda um booleano e recebe só os textos fixos de idioma e de marcação. `tests/integration/overlay/riot_overlay.rs` confere quando a caixa aparece e some. O visual da página (Inter, 16 px, cantos de 20%, cores da Riot) foi conferido com o Electron, numa captura, e não tem teste automático no Tauri. Não abre a Riot.

## Pontos de atenção

- Uma atualização da tela de login da Riot pode mover o "Stay signed in" ou pôr algo no retângulo. Reveja as frações junto com as de [[loginForm]].
