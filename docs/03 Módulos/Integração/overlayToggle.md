---
tipo: módulo
arquivo: [src-tauri/src/integration/overlay/overlay_toggle.rs, src/integration/overlay/toggle.html]
camada: integração
testes: src-tauri/tests/integration/overlay/overlay_toggle.rs
tags: [módulo, interface]
---

# overlayToggle

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Desenha a caixa "Ocultar contas" ao lado do "Stay signed in" da Riot e avisa o [[riotOverlay]] quando ela muda.

## Responsabilidade

Cria uma segunda visualização dentro da janela da sobreposição, com a página `src/integration/overlay/toggle.html` (`toggle.css`, `toggle.js`, `toggle-check.svg`) e o preload `toggle-preload.js`. A página copia a caixa "Stay signed in" da Riot (ver "Visual igual ao da Riot"). Não guarda o estado nem decide o que esconder; isso é do [[riotOverlay]]. Pedido e decisão: [[ADR-013 Caixa para ocultar as contas na coluna de login]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createOverlayToggle({ electron, onChange, language, file, preload })` | função | Retorna `open(window)`, `setLanguage(idioma)`, `setHidden(oculto)`, `setVisible(visível)` e `dispose()`. `onChange(oculto)` recebe um booleano a cada clique. |
| `LANGUAGE_CHANNEL` | texto | Canal `ram-overlay:language`, do main para a página. |
| `HIDDEN_CHANNEL` | texto | Canal `ram-overlay:hidden`, do main para a página. |
| `toggleRect({ width, height })` | função | Retângulo da caixa em coordenadas da área cliente da Riot. |
| `CHANNEL` | texto | Canal IPC `ram-overlay:hide-accounts`. |

## Dependências

- Usa: [[paths]] (`OVERLAY_TOGGLE_FILE`, `OVERLAY_TOGGLE_PRELOAD_FILE`), [[language]].
- Usado por: [[riotOverlay]].

## Invariantes e decisões

- **Posição medida no Riot Client v142.** O retângulo vai de `200/1536` a `344/1536` da largura e de `418/864` a `450/864` da altura: começa depois do texto "Stay signed in" (que termina em 177 px), acaba na borda direita do formulário (344 px) e cobre a linha da caixa da Riot (426 a 441 px). Medido numa captura de 1536×864, em 2026-11-04, com a mesma base em frações de [[login.ps1]] (`$REMEMBER` 0.0417, 0.5023). A página usa a unidade `100vw / 144` para tudo, então a caixa escala junto com a janela.
- **Visual igual ao da Riot.** Revisão de 2026-11-04, a pedido do usuário ("tamanho, arredondamento, cor, tudo"). Valores tirados da regra `.mobile-checkbox` do CSS da tela de login (lido na cópia privada, sem alterar nada) e conferidos pixel a pixel numa captura: quadrado de 16 px, `border-radius: 20%`, cinza `rgba(126,126,126,.15)` (`.25` com o mouse em cima), marcada `#d53235` (medido na tela; `#bc252a` com o mouse) com visto branco `#f9f9f9` desenhado no mesmo traço da Riot (SVG de 19 px, traço 3, 60% do quadrado, centrado a 35% da altura). Texto Inter (`@fontsource/inter`, já dependência do projeto) de 14 px, `line-height` 120%, cor `#292929`, `#333` marcada e `#111` marcada com o mouse. A Riot declara peso 500, mas o Inter dela é de outra versão e desenha mais fino; com o Inter do projeto, o peso 400 com `letter-spacing` de 0,3 px e o texto 2 px mais perto da caixa que `.75em` deram a mesma largura (33 a 128 px a partir do retângulo), a mesma altura (10 a 23 px) e quase a mesma quantidade de tinta (55,4 mil contra 56,5 mil). `will-change: transform` no rótulo força suavização em tons de cinza, como a da Riot; sem isso o texto saía com franjas coloridas e parecia mais escuro.
- **Fundo opaco `#fcfcfc`.** É a cor medida do painel de login da Riot. Fundo opaco deixa o texto nítido; se a Riot mudar a cor do painel, a caixa precisa acompanhar.
- **Começa desmarcada.** A página não lê estado salvo. Cada início do gerenciador cria a página de novo, desmarcada, como foi pedido.
- **IPC mínimo.** O preload expõe só `toggle.setHidden(oculto)`, que manda `true` ou `false`. O main recusa qualquer outro valor e qualquer remetente que não seja o frame principal desta visualização com a URL local exata. A visualização é `sandbox`, sem Node, sem permissões, sem navegação e sem janelas novas, numa partição própria em memória.
- **Falha volta a caixa.** Se o aviso ao main falhar, a página desfaz a marcação para não mostrar um estado que não vale.
- **Texto no idioma salvo.** Revisão de 2026-11-04 ([[ADR-014 Interface em português e inglês]]): a página mostra "Ocultar contas" ou "Hide accounts". O main manda o idioma pelo canal `ram-overlay:language` (só do main para a página) depois que a página carrega e a cada `setLanguage`. O preload expõe `toggle.onLanguage(callback)`, que só entrega `'pt'` ou `'en'`. A página troca o texto, o `lang` e o título. Antes da mensagem chegar, o HTML já mostra o português.
- **Marcada pelo main.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): a cópia do perfil do Riot oculta as contas sem clique na caixa. `setHidden(valor)` guarda o estado (só `true` conta como oculto) e manda pelo canal `ram-overlay:hidden`, só do main para a página e só depois de carregar. O preload expõe `toggle.onHidden(callback)`, que só entrega booleano, e a página só marca ou desmarca a caixa. Isso não chama `onChange`; o [[riotOverlay]] já mudou a região. Um clique do usuário na caixa também atualiza o estado guardado. Desde 2026-11-06 o [[riotOverlay]] não chama mais `setHidden`, porque a cópia do perfil saiu dos [[cards]]; o método e o canal continuam, sem uso.
- **Some durante o login.** Desde 2026-11-06 ([[ADR-024 Coluna de login coberta durante o login]]), enquanto o [[overlayCover]] cobre a coluna, o [[riotOverlay]] chama `setVisible(false)` e a visualização da caixa fica escondida; `setVisible(true)` a traz de volta, com a marcação que tinha. Só `true` mostra. Um pedido feito antes de `open` vale quando a visualização é criada, e depois de `dispose` nada muda. A página não sabe disso e não guarda nada. Desde a [[ADR-025 Caixa some junto com o formulário da Riot]], o [[riotOverlay]] também a esconde enquanto a caixa "Stay signed in" da Riot está fora da tela, como depois do clique em entrar no login manual.
- **Versão Rust (fase 4 da [[Migração para Tauri]]).** `src-tauri/src/integration/overlay/overlay_toggle.rs`: `toggle_rect`, o script que faz o papel do `toggle-preload.js` e os scripts de idioma. O `window.toggle` é o mesmo para o `toggle.js`; `setHidden` chama o comando `overlay_toggle`, que só a webview `toggle` pode chamar (capacidade do Tauri, mais a conferência do rótulo e do endereço no [[main]]). O idioma chega por `eval` de um de dois textos fixos (`'pt'` ou `'en'`), nunca montado com o valor recebido. O script guarda o último valor e o entrega a quem se inscrever depois, e a janela manda o idioma de novo quando a página termina de carregar, para ele não se perder antes do `toggle.js` rodar.

## Testes

Fakes conferem a posição em dois tamanhos, o reposicionamento ao redimensionar, as proteções da visualização, o IPC só com booleano e só do próprio frame, a abertura única e o descarte. Um teste com Electron real carrega a página com o preload, confere que o Inter carrega, que a caixa tem 16 px, cantos de 20% e o cinza da Riot, e que marcada fica `#d53235` com o visto, que ela começa desmarcada, que clicar no texto marca e avisa `true`, que o segundo clique desmarca e avisa `false`, que a página não tem `require` e que, depois de `setLanguage('en')`, a página fica com `lang` `en`, título e texto "Hide accounts", sem passar da largura. Depois, `setHidden(true)` marca a caixa sem novo aviso. Um teste com fakes confere que o idioma só é mandado depois do carregamento, que valores estranhos viram `pt` e que nada é mandado depois do descarte. Outro confere `setVisible` antes e depois de abrir, só `true` mostrando e nada depois do descarte. Outro confere que `setHidden` só chega à página depois de carregar, que valores diferentes de `true` viram `false`, que não chama `onChange` e que nada é mandado depois do descarte. Não abre a Riot.

## Pontos de atenção

- Uma atualização da tela de login da Riot pode mover o "Stay signed in" ou pôr algo no retângulo. Reveja as frações junto com as de [[login.ps1]].
