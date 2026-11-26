---
tipo: módulo
arquivo: [src-tauri/src/integration/overlay/overlay_cover.rs, src-tauri/src/integration/overlay/overlay_window.rs, src/integration/overlay/cover.html, src/integration/overlay/cover.js]
camada: integração
testes: [src-tauri/tests/integration/overlay/overlay_cover.rs, src-tauri/tests/integration/overlay/riot_overlay.rs, test/integration/overlay/cover.test.js]
tags: [módulo, interface]
---

# overlayCover

> Cobre a coluna de login da Riot enquanto o Eclipse faz o login e mostra nela a lista de etapas até o jogo abrir, para o [[riotOverlay]]. A caixa "Ocultar contas" some junto.

## Responsabilidade

É a webview `cover` da janela da sobreposição, criada em `overlay_window.rs`, com a página `src/integration/overlay/cover.html` (`cover.css`, `cover.js`). A página tem o fundo do painel de login da Riot e a lista de quatro etapas: Preparar a Riot, Entrar na conta, Conferir a conta e Abrir o jogo. Pedidos e decisões: [[ADR-024 Coluna de login coberta durante o login]] (a cobertura) e [[ADR-053 Etapas do login na tela até o jogo abrir]] (a lista).

`overlay_cover.rs` monta o que a página recebe: o `CoverSteps` tirado da operação, o script de início e os scripts de entrega.

**Não faz:**

- não decide quando cobrir; o [[riotOverlay]] chama `set_cover_visible` e põe a coluna na região da janela;
- não tem comando nem preload, e não fala com o Rust;
- não recebe conta, Riot ID, usuário ou senha;
- não lê nem mexe na janela da Riot.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `CoverSteps { step, game, signed_in, detail }` | struct | O que a lista mostra. `from_operation(operação)` só aceita operação `running`; etapa fora de `STEPS` vira `prepare`, jogo fora de `GAMES` vira `lol`, e o texto perde os caracteres de controle e fica em até `DETAIL_LIMIT` (160) caracteres |
| `CoverSteps::script()` | método | `window.__eclipseCover.steps(<json>)`, com os dados em JSON |
| `language_script(idioma)` | função | Só `en` ou `pt` |
| `INIT_SCRIPT` | constante | Expõe `window.cover.onLanguage` e `window.cover.onSteps`, só ouvintes |
| `COVER_LABEL` | constante | `cover`, o rótulo da webview (`overlay_window.rs`) |

A janela da sobreposição (`TauriOverlayWindow`) implementa, para o [[riotOverlay]]: `set_cover_visible(visível)`, `set_cover_steps(etapas)`, que guarda o último script e o roda na página, e `set_language(idioma)`, que vale para a caixa e a cobertura. Quando a página termina de carregar, recebe de novo o idioma e as últimas etapas.

`cover.js` é um módulo ES. Exporta `coverView(etapas, idioma)`, que dá o título, o nome do jogo e as quatro linhas (`done`, `current` ou `next`, rótulo e detalhe); o resto só desenha.

## Dependências

- Usa: [[assetProtocol]] (a página, o módulo e as fontes Inter, por lista fechada, e o logo da Riot do [[riotLogo]] pelo endereço `riot/logo.svg`), o `cover_rect` do [[riotOverlay]] e as listas `STEPS` e `GAMES` do [[signInFlow]].
- Usado por: [[riotOverlay]].

## Invariantes e decisões

- **Linha do tempo e logo da Riot (2026-11-25, 2.31.0, [[ADR-053 Etapas do login na tela até o jogo abrir]]).** O usuário escolheu a opção B do canvas de opções: no topo, o nome do jogo em vermelho e "Entrando na conta"; embaixo, as quatro etapas numeradas e ligadas por uma linha vermelha até a etapa atual. Feitas mostram um resumo fixo ("Riot pronta", "Conta conectada", "Riot ID conferido", "Jogo aberto" ou "Riot aberta"), a atual mostra o texto do status em vermelho com o número pulsando, e as próximas ficam cinza. O logo da Riot, lido da instalação pelo [[riotLogo]], fica onde a Riot o desenha (`left 143.5u`, `top 64u`, `113u × 32u`). Sem logo (404), a imagem some. A CSP ganhou `img-src 'self'`.
- **Lista no lugar do anel (2026-11-25, 2.30.0, [[ADR-053 Etapas do login na tela até o jogo abrir]]).** Pedido do usuário: em vez do anel girando, ver o que está acontecendo, como no LeagueAccounts. Cada etapa aparece feita (círculo vermelho com visto), atual (anel vermelho girando, rótulo em negrito e o texto do status embaixo) ou por vir (círculo cinza). A etapa `done` marca todas como feitas. O título é "Entrando" e, embaixo, o nome do jogo; com o ícone da Riot, a última etapa é "Abrir a Riot". O anel antigo continua na página e só aparece se nenhuma etapa chegar.
- **Script só para receber.** Até a 2.29.2 a webview rodava com JavaScript desligado. Agora segue o modelo da caixa do [[overlayToggle]]: o script de início cria só ouvintes, e o Rust entrega por `eval` o idioma e o JSON das etapas. Nenhum `invoke` sai da página e nenhum comando aceita a cobertura (nenhuma capacidade do Tauri tem o rótulo `cover`). A página escreve tudo por `textContent`. A CSP permite só o script, a folha de estilo e as fontes locais. Navegação para fora, janelas novas, downloads e permissões continuam recusados.
- **Só o texto do status, já traduzido.** O detalhe é o `text` da operação do [[signInService]], que já passou pelo `safe_text` (usuário e senha trocados por `[redacted]`) e pela tradução do [[language]].
- **Os rótulos ficam na página**, em português e inglês, como os textos da caixa.
- **Mesma cor do painel da Riot.** Fundo `#fcfcfc`, na página e na própria webview, para nada piscar enquanto a página carrega.
- **Unidade da coluna.** A página usa `100vw / 400`, então tudo escala com a coluna (1 px a 1536 de largura). Com "reduzir movimento" do Windows, os anéis ficam parados, como nos [[cards]].
- **Começa escondida.** A webview é escondida logo ao ser criada. A região da janela também só inclui a coluna enquanto o [[riotOverlay]] cobre.
- **Descanso.** Desde a 2.29.0, quando o [[riotOverlay]] põe as webviews para descansar, a cobertura também some, e volta só se ainda estiver pedida. Ela divide um processo de renderização com a caixa ([[ADR-052 Webviews da sobreposição num processo só]]).

## Testes

- `src-tauri/tests/integration/overlay/overlay_cover.rs`: só operação `running` vira etapas; valores desconhecidos caem em `prepare` e `lol`; o detalhe fica curto e sem caracteres de controle; o script leva os dados como JSON, mesmo com aspas e `</script>`; o idioma é só `en` ou `pt`; o script de início não tem `invoke` nem `__TAURI`.
- `src-tauri/tests/integration/overlay/riot_overlay.rs`: quando a cobertura aparece e some, a área dela e as etapas entregues uma vez por mudança, também com a janela começando depois.
- `test/integration/overlay/cover.test.js`: a ordem e os números das etapas, os rótulos nos dois idiomas, o status na etapa atual, o resumo nas feitas e nada nas próximas, a CSP, a única imagem (o logo) e um único `<script type="module">`, e nenhum `innerHTML`, `eval` ou `invoke` no módulo.

Conferido em 2026-11-25 num Edge sem janela, com etapas fictícias e o logo lido da instalação, na proporção da coluna (500 × 1080 px, porque o Edge sem janela não abre com menos de 500 px). Fora dos testes: a aparência sobre a Riot real.

## Pontos de atenção

- Se a Riot mudar a cor do painel de login, a cobertura e a caixa precisam acompanhar.
- Um texto de status muito longo quebra em duas ou três linhas embaixo da etapa atual.
