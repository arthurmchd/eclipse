---
tipo: módulo
arquivo: [src-tauri/src/integration/overlay/overlay_window.rs, src/integration/overlay/cover.html]
camada: integração
testes: src-tauri/tests/integration/overlay/riot_overlay.rs
tags: [módulo, interface]
---

# overlayCover

> Cobre a coluna de login da Riot com um painel vazio e um carregamento enquanto o Eclipse faz o login, para o [[riotOverlay]]. A caixa "Ocultar contas" some junto.

## Responsabilidade

É a webview `cover` da janela da sobreposição, criada em `overlay_window.rs`, com a página `src/integration/overlay/cover.html` (`cover.css`). A página tem o fundo do painel de login da Riot e um único carregamento. Pedido e decisão: [[ADR-024 Coluna de login coberta durante o login]].

**Não faz:**

- não decide quando cobrir; o [[riotOverlay]] chama `set_cover_visible` e põe a coluna na região da janela;
- não tem script nem comando;
- não lê nem mexe na janela da Riot.

## API pública

Não tem API própria. A janela da sobreposição (`TauriOverlayWindow`) implementa, para o [[riotOverlay]]:

| Item | Tipo | Descrição |
|---|---|---|
| `COVER_LABEL` | constante | `cover`, o rótulo da webview |
| `set_cover_visible(visível)` | método | Mostra ou esconde a webview |
| `set_size(tamanho)` | método | Reposiciona as três webviews; a cobertura vai para o `cover_rect` do [[riotOverlay]] |

## Dependências

- Usa: [[assetProtocol]] (a página, por lista fechada) e o `cover_rect` do [[riotOverlay]].
- Usado por: [[riotOverlay]].

## Invariantes e decisões

- **Sozinha na coluna.** A janela cria a cobertura depois dos cartões e antes da caixa do [[overlayToggle]], mas o [[riotOverlay]] esconde a caixa enquanto cobre. Na primeira versão a caixa ficava à vista sobre a cobertura; testando, o usuário pediu que ela também sumisse ("o botao continuou ali... continua aparecendo").
- **Mesma cor do painel da Riot.** Fundo `#fcfcfc`, na página e na própria webview, para nada piscar enquanto a página carrega. É a cor medida do painel de login da Riot, a mesma do fundo da caixa ([[overlayToggle]]), então o furo no ponto do observador não aparece como mancha.
- **Carregamento no centro.** Um anel de 36 px com traço de 3 px, cinza `rgba(126, 126, 126, .15)` com o arco vermelho `#d53235` da Riot, girando a cada 1 s, no centro da coluna. A primeira versão o punha a 34% da altura só para não bater na caixa. A página usa a unidade `100vw / 400`, então ele escala com a coluna (1 px a 1536 de largura). Com "reduzir movimento" do Windows, o anel fica parado, como nos [[cards]].
- **Sem script.** A webview roda com JavaScript desligado e perfil anônimo, sem nenhum comando liberado. A CSP da página só permite a folha de estilo local. Navegação para fora, janelas novas, downloads e permissões são recusados.
- **Começa escondida.** A webview é escondida logo ao ser criada. A região da janela também só inclui a coluna enquanto o [[riotOverlay]] cobre; esconder a webview evita pintar à toa.

## Testes

`src-tauri/tests/integration/overlay/riot_overlay.rs` confere a área da cobertura (a coluna de login, menos o ponto onde o observador lê o painel da Riot) e quando ela aparece: durante um login, até a Riot precisar do usuário ou o login terminar. A página e a webview em si não têm teste automático.

Fora dos testes: a aparência sobre a Riot real.

## Pontos de atenção

- Se a Riot mudar a cor do painel de login, a cobertura e a caixa precisam acompanhar.
