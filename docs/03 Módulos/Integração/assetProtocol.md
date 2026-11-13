---
tipo: módulo
arquivo: src-tauri/src/integration/asset_protocol.rs
camada: integração
testes: src-tauri/tests/integration/asset_protocol.rs
tags: [módulo, tauri, segurança]
---

# assetProtocol

> O protocolo `eclipse://` do Eclipse em Tauri: entrega às webviews da sobreposição só os arquivos de uma lista fechada.

## Responsabilidade

- Dizer qual arquivo do projeto responde a cada endereço `eclipse://localhost/...` (no Windows, `http://eclipse.localhost/...`) e com qual tipo.
- **Não** lê o arquivo nem monta a resposta: isso fica no [[main]], que só chama `resolve`.
- **Não** existe no Electron: lá as views carregam `file://` direto. Nasceu na fase 4 da [[Migração para Tauri]] ([[ADR-033 Sobreposição no Tauri]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `SCHEME` | constante | `eclipse` |
| `CARDS_PAGE`, `TOGGLE_PAGE`, `COVER_PAGE` | constantes | Caminhos das três páginas da sobreposição |
| `page_url(page)` / `served_url(page)` | função | O endereço `eclipse://localhost/...` e o que a WebView2 mostra, `http://eclipse.localhost/...` |
| `is_page(page, url)` | função | Se o endereço é exatamente o da página, numa das duas formas |
| `allowed(path)` | função | O caminho limpo, se estiver na lista |
| `resolve(root, uri)` | função | Arquivo e tipo MIME, ou nada (o [[main]] responde 404) |

## Dependências

- Usa: `regex`.
- Usado por: [[main]], [[managerHost]] (endereço exato dos cartões) e a janela do [[riotOverlay]].

## Invariantes e decisões

- **Lista fechada, por regra.** Entram os arquivos de `src/renderer/` e de `src/renderer/assets/` (só `html`, `css`, `js`, `png` e `svg`), seis arquivos da caixa e da cobertura, e as fontes Inter 400, Cinzel 700 e Teko 500 e 600 de `node_modules/@fontsource`, com o CSS e os `woff`/`woff2` de cada subconjunto. Os `preload`, o resto de `node_modules`, os `.ps1`, o `main` e qualquer outro arquivo ficam de fora, conferidos por teste.
- **Nenhum escape.** Cada pedaço do caminho é conferido por uma expressão sem `%`, sem barra invertida e sem começar por ponto; `..`, pedaços vazios e caminhos de mais de 512 caracteres são recusados. Assim, nenhum caminho codificado chega ao disco.
- **Só o próprio endereço.** `resolve` aceita `eclipse://localhost` e `http://eclipse.localhost`; `https`, outros hosts e outros esquemas não respondem.
- **Os caminhos relativos das páginas continuam valendo.** Os endereços espelham as pastas do projeto, então o `../../node_modules/...` do `cards.html` e o `../../../node_modules/...` do `toggle.html` chegam às fontes sem mudar o HTML do Electron.
- **No Setup (fase 5 da [[Migração para Tauri]]).** A lista de `bundle.resources` do `tauri.conf.json` leva exatamente os arquivos que este protocolo serve, nos mesmos caminhos. Um teste segue as três páginas e confere que cada arquivo servido está no Setup e que nenhum arquivo do Setup, fora os `.ps1`, seria recusado aqui.
## Testes

`src-tauri/tests/integration/asset_protocol.rs` abre as três páginas, segue cada CSS, JS e imagem que elas citam e cada fonte que os CSS do `@fontsource` citam, e confere que tudo existe e é servido. Também tenta 26 caminhos proibidos, de escapes a arquivos vizinhos, e confere o reconhecimento exato das páginas.

## Pontos de atenção

- Na fase 5, o `root` passa a ser a pasta de recursos do instalador, e as fontes precisam ir junto.
- Uma página nova nos cartões que carregue outra fonte precisa entrar na lista; o teste das páginas acusa.
