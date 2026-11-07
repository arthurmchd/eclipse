---
tipo: decisão
status: revertida
data: 2026-11-05
tags: [adr, interface, janelas, segurança]
---

# ADR-018 Arte da Riot desfocada atrás dos cartões

## Revertida

Em 2026-11-06, a pedido do usuário: "pode reverter e colocar o fundo branco novamente e retirar o blur". Todo o código saiu: o comando `backdrop` e a cópia por `PrintWindow` no helper do [[riotWindowObserver]], o pedido no [[riotOverlay]], o canal no [[managerHost]] e no [[manager-preload]], o canvas nos [[cards]] e o `backdrop.js` do [[renderer]]. O fundo voltou ao `#f2f2f2` da [[ADR-011 Cartões sobre a arte do Riot]], e a [[Segurança e privacidade]] voltou a uma só leitura visual, o quadrado da [[ADR-017 Cartões cedem a vez aos avisos da Riot]]. O resto desta nota fica como registro do que foi testado, caso a ideia volte.

## Contexto

Pedido do usuário em 2026-11-05, depois dos cartões no visual de cada jogo: trocar o fundo branco `#f2f2f2` ([[ADR-011 Cartões sobre a arte do Riot]]) por um desfoque, "mostraria a imagem de fundo porém com blur, pode colocar um blur bem agressivo".

A arte é desenhada pela própria Riot dentro da janela dela (imagens grandes por jogo e, às vezes, vídeo). A sobreposição é outra janela, transparente, por cima ([[ADR-012 Sobreposição presa à janela do Riot]]).

Testado em 2026-11-05 numa janela Electron de teste, sem tocar no Riot:

- **Desfoque do Windows atrás da janela** (`SetWindowCompositionAttribute` com blur ou acrílico): numa janela Electron transparente, pinta cinza sólido no lugar do desfoque e ignora a região da janela (`setShape`).
- **Material acrílico do Electron** (`backgroundMaterial: 'acrylic'`): também cinza sólido, também ignora a região e ainda arredonda os cantos. Cobriria a coluna de login da Riot.
- **`PrintWindow` da janela de baixo, coberta por outra:** devolve a imagem da janela de baixo sem a de cima, em 21 a 26 ms para 1000 × 560.

## Decisão

- **Miniatura sob pedido.** Enquanto os cartões estão visíveis, o [[riotOverlay]] pede uma miniatura ao helper do [[riotWindowObserver]] pelo comando `backdrop`: ao aparecer, quando a janela da Riot muda de tamanho ou de janela, e a cada 4 s.
- **O helper lê só a arte, já reduzida.**
  - Copia a área cliente da janela da Riot escolhida (a mesma oficial de sempre) com `PrintWindow` (`PW_CLIENTONLY | PW_RENDERFULLCONTENT`), num bitmap em memória. Se a cópia vier toda preta, tenta só `PW_CLIENTONLY`, que serve para janelas GDI. Não copia uma janela que o Windows dá como travada (`IsHungAppWindow`), porque `PrintWindow` espera a janela desenhar.
  - Reduz só a região da arte, à direita de 400/1536 da largura (o início dos cartões), para 32 × 24 px, com média de cores (`HALFTONE`).
  - Devolve 768 cores em hexadecimal numa linha `{"backdrop":{"id","width","height","rgb"}}` e descarta a cópia.
  - A coluna de login nunca entra na miniatura. Imagem toda preta, janela minimizada ou não oficial dá `{"backdrop":null}`.
- **Só em memória.** O main valida a linha e passa a miniatura para a página dos [[cards]] pelo [[managerHost]], por IPC (`ram-manager:backdrop`, validada de novo no [[manager-preload]]). O [[riotOverlay]] ignora `null` e miniaturas de outra janela; ao trocar de janela, limpa o fundo. Nada é gravado, registrado em log ou enviado para a rede.
- **A página desfoca.** Os [[cards]] desenham a miniatura num `canvas` atrás de tudo, esticado e com `filter: blur(…)` forte. O fundo `#f2f2f2` continua embaixo e clareia a arte. Sem miniatura, a página fica como antes.
- **Regra de segurança revista.** Além do quadrado de 7 × 7 px do [[ADR-017 Cartões cedem a vez aos avisos da Riot]], o helper agora lê uma miniatura de 32 × 24 px da região da arte. Em 32 × 24 não cabe texto legível. Continua sem ler título, texto, campos ou credenciais.

## Alternativas consideradas

- **Desfoque do Windows ou acrílico do Electron:** não funcionaram na janela transparente com região (ver Contexto). Também não leriam nada, o que seria melhor, mas o acrílico some com a janela inativa.
- **`desktopCapturer` do Electron:** tira miniatura de todas as janelas abertas para achar a da Riot.
- **Copiar a tela (`BitBlt`) na região da arte:** pegaria os próprios cartões por cima, e não a arte.
- **Usar uma arte própria** (banner ou cartão da conta selecionada, desfocado): não é a imagem que o usuário pediu para ver.
- **Arte local da Riot** (`login-splash-*`, `*-smarturl-splash-fallback` na interface): a Riot escolhe a arte por configuração remota e às vezes usa vídeo; a imagem local é só reserva.

## Consequências

- O fundo dos cartões passa a ter as cores da arte que a Riot mostra naquele momento. Com vídeo, muda devagar, a cada miniatura.
- O helper faz um `PrintWindow` da Riot a cada 4 s enquanto os cartões estão à mostra. Cada um leva cerca de 25 ms na linha principal do helper e atrasa um retrato em no máximo isso.
- Com a Riot escurecida, minimizada ou sem login, os cartões estão escondidos e nada é pedido.
- Se a Riot mudar o lugar da arte, o fundo pode trazer cores da coluna de login. Mesmo assim, 32 × 24 px desfocados não mostram texto.
- Não foi conferido com a Riot real: o teste usou uma janela Electron de teste. A prévia foi conferida com miniaturas feitas das artes locais da interface da Riot (só leitura, fora do repositório).
- Fora da tela, a cópia completa de uma janela GDI sai preta; o autoteste do helper usa uma janela assim e cobre a cópia simples.

## Relacionado

- [[riotWindowObserver]]
- [[riotOverlay]]
- [[cards]]
- [[managerHost]]
- [[manager-preload]]
- [[renderer]]
- [[Segurança e privacidade]]
