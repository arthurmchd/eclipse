---
tipo: módulo
arquivo: src-tauri/src/integration/riot_logo.rs
camada: integração
testes: src-tauri/tests/integration/riot_logo.rs
tags: [módulo, interface, segurança]
---

# riotLogo

> Lê o logo vermelho da Riot Games da instalação da própria Riot, para a [[overlayCover]] mostrar no mesmo lugar da tela de login.

## Responsabilidade

Abre o `app.asar` oficial (o mesmo arquivo de onde o [[backend]] tira o certificado), lê `dist/renderer/renderer.js` e acha a variável `riotLogo`, que a Riot usa no topo da coluna de login (`useRiotLogo("red")`). O valor é uma imagem SVG embutida (`data:image/svg+xml,…`, 113 × 32). O módulo decodifica, confere e guarda o SVG na memória.

**Não faz:**

- não grava nada, nem na instalação da Riot nem em disco;
- não leva o logo no Setup nem no repositório;
- não usa o logo fora da cobertura, nem como marca do Eclipse.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `find_logo(pacote)` | função | Acha `riotLogo="data:image/svg+xml,…"` (nome exato, sem prefixo como `altRiotLogo`), decodifica e devolve o SVG se passar na conferência |
| `read_logo(arquivo)` | função | Abre o `app.asar` só para leitura e chama `find_logo` no `BUNDLE` |
| `LogoCache` | struct | Lê o logo uma vez por versão do `app.asar` (tamanho e data, como o certificado); sem logo, só tenta de novo quando o arquivo muda |
| `BUNDLE`, `MARKER`, `LOGO_LIMIT` | constantes | `dist/renderer/renderer.js`, o começo da variável e 64 KiB |

## Dependências

- Usa: [[asar]] e o `certificate_archive`, `archive_stamp`, `Stamp` e os tipos de leitor do [[backend]].
- Usado por: [[main]], que responde o endereço `riot/logo.svg` do [[assetProtocol]] com o que o `LogoCache` tem, a partir do caminho do Riot Client detectado no início.

## Invariantes e decisões

- **Logo da Riot no lugar da Riot (2026-11-25, 2.31.0, [[ADR-053 Etapas do login na tela até o jogo abrir]]).** Pedido do usuário: "ultilize a logo da riot games (como esta no riot client original) e deixe ela exatamente no mesmo lugar e tamanho". A cobertura tapa o topo da coluna de login, onde a Riot desenha o logo; agora ela mostra o mesmo logo no mesmo ponto.
- **Da instalação da pessoa, nunca do Setup.** O [[Estudo - Visual da Riot]] diz que artes da Riot ficam fora do Setup e, se usadas, vêm da instalação da própria pessoa. O SVG só existe na memória do Eclipse e só sai pelo endereço exato `riot/logo.svg`.
- **Conferência antes de servir.** Só passa um texto que começa com `<svg`, termina com `</svg>`, tem até 64 KiB e não tem `<script`, `javascript:`, `<foreignObject`, `<iframe`, `<image`, endereço `http` em `href` nem atributo `on…=`. A página ainda mostra o logo por `<img>`, onde um SVG não roda script, e a CSP só libera imagem local.
- **Sem logo, nada quebra.** Se a Riot mudar o pacote e a variável sumir, o endereço responde 404 e a página esconde a imagem.
- **Posição e tamanho vêm do CSS da Riot.** Na versão 143 do Riot Client, `.login-sidebar` tem 400 px de largura e `.outer-content` 64 px de margem no topo; `.login-header` centraliza `.login-logo`, e a imagem tem 113 × 32. Na cobertura isso vira `left: 143.5u`, `top: 64u`, `113u × 32u`, com `u = 100vw / 400`, a mesma unidade da coluna.

## Testes

`src-tauri/tests/integration/riot_logo.rs`: o logo vermelho achado entre nomes parecidos (`altRiotLogo`, `riotLogo$1`); PNG, texto sem aspas finais ou com `%` inválido recusados; SVG com script, `onload`, `foreignObject`, imagem externa, `javascript:` ou grande demais recusado; a leitura dentro de um `app.asar` sintético sem mudar o arquivo; o cache lendo uma vez por versão e sem repetir a falha; só o endereço exato respondendo. Conferido em 2026-11-25, só lendo, no `app.asar` instalado (Riot Client 143): achou o SVG de 113 × 32 e 6,6 KB.

## Pontos de atenção

- Uma versão nova do Riot Client pode renomear a variável ou mudar a margem e o tamanho do logo. Conferir em [[Atualização do Riot Client]].
- O pacote tem 11 MB; ele é lido uma vez por versão do `app.asar`, na primeira vez que a cobertura pede o logo.
