---
tipo: módulo
arquivo: src/integration/overlay/overlayCover.js
camada: integração
testes: test/integration/overlay/overlayCover.test.js
tags: [módulo, interface]
---

# overlayCover

> Cobre a coluna de login da Riot com um painel vazio e um carregamento enquanto o Eclipse faz o login, para o [[riotOverlay]]. A caixa "Ocultar contas" some junto.

## Responsabilidade

Cria uma terceira visualização dentro da janela da sobreposição, com a página `src/integration/overlay/cover.html` (`cover.css`). A página tem o fundo do painel de login da Riot e um único carregamento. Pedido e decisão: [[ADR-024 Coluna de login coberta durante o login]].

**Não faz:**

- não decide quando cobrir; o [[riotOverlay]] chama `setVisible` e põe a coluna na região da janela;
- não tem script, preload nem IPC;
- não lê nem mexe na janela da Riot.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createOverlayCover({ electron, area, file })` | função | Retorna `open(window)`, `setVisible(visível)` e `dispose()`. `area({ width, height })` recebe o tamanho da área cliente da janela e devolve o retângulo da visualização; o [[riotOverlay]] passa `coverRect`. |
| `open(window)` | função async | Cria a visualização uma vez, no tamanho de `area`, refaz o tamanho a cada `resize` e carrega a página. |
| `setVisible(visível)` | função | Mostra ou esconde a visualização. Só `true` mostra. Um pedido feito antes de `open` vale quando ela é criada. Depois de `dispose`, não faz nada. |
| `dispose()` | função | Fecha a página e para de seguir o `resize`. |

## Dependências

- Usa: [[paths]] (`OVERLAY_COVER_FILE`).
- Usado por: [[riotOverlay]].

## Invariantes e decisões

- **Sozinha na coluna.** O [[riotOverlay]] cria a cobertura depois dos cartões e antes da caixa do [[overlayToggle]], mas esconde a caixa enquanto cobre. Na primeira versão do mesmo dia a caixa ficava à vista sobre a cobertura; testando, o usuário pediu que ela também sumisse ("o botao continuou ali... continua aparecendo").
- **Mesma cor do painel da Riot.** Fundo `#fcfcfc`, na página e na própria visualização, para nada piscar enquanto a página carrega. É a cor medida do painel de login da Riot, a mesma do fundo da caixa ([[overlayToggle]]), então o furo no ponto do observador não aparece como mancha.
- **Carregamento no centro.** Um anel de 36 px com traço de 3 px, cinza `rgba(126, 126, 126, .15)` com o arco vermelho `#d53235` da Riot, girando a cada 1 s, no centro da coluna. A primeira versão o punha a 34% da altura só para não bater na caixa. A página usa a unidade `100vw / 400`, então ele escala com a coluna (1 px a 1536 de largura). Com "reduzir movimento" do Windows, o anel fica parado, como nos [[cards]].
- **Sem script.** A visualização roda com `javascript: false`, sandbox, sem Node e sem preload, numa partição própria em memória (`ram-overlay-cover`). A CSP da página só permite a folha de estilo local. Navegação, janelas novas, `webview` e permissões são recusados.
- **Começa escondida.** `setVisible(false)` é aplicado ao criar. A região da janela também só inclui a coluna enquanto o [[riotOverlay]] cobre; esconder a visualização evita pintar à toa.
- **Versão Rust (fase 4 da [[Migração para Tauri]]).** A cobertura é a webview `cover` da janela do [[riotOverlay]] (`overlay_window.rs`), com JavaScript desligado, perfil anônimo, fundo `#fcfcfc` e nenhum comando liberado. A área é o `cover_rect` de `riot_overlay.rs`.

## Testes

`test/integration/overlay/overlayCover.test.js`:

- com fakes: as proteções da visualização, o tamanho vindo de `area` e refeito no `resize`, o começo escondido, o pedido feito antes de `open`, só `true` mostrando, a abertura única e o descarte;
- com Electron real: a página tem só o carregamento e nenhum script; o fundo é `#fcfcfc`; o anel tem 36 px, traço de 3 px, o vermelho e o cinza da Riot e gira sem parar; ele fica no centro da coluna; a página não rola; e a visualização criada pelo módulo recusa script.

Fora dos testes: a aparência sobre a Riot real.

## Pontos de atenção

- Se a Riot mudar a cor do painel de login, a cobertura e a caixa precisam acompanhar.
