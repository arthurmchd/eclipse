---
tipo: módulo
arquivo: src/core/language.js
camada: aplicação
testes: test/core/language.test.js
tags: [módulo]
---

# language

> Guarda os idiomas aceitos e traduz para português ou inglês as mensagens que o processo principal mostra ao usuário.

## Responsabilidade

Define que o Eclipse fala `pt` ou `en`, com `pt` como padrão, e tem o catálogo de pares inglês/português das mensagens do login e do main, além dos textos da bandeja e dos diálogos. Não decide qual idioma está ativo (isso é do [[store]]) nem traduz os cartões, que têm o dicionário `src/renderer/cardsText.js` ([[cards]]). Decisão: [[ADR-014 Interface em português e inglês]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `LANGUAGES` | lista | `['pt', 'en']`. |
| `DEFAULT_LANGUAGE` | texto | `'pt'`. |
| `MESSAGES` | lista | Pares `[inglês, português]`. Exportado para o teste conferir o catálogo inteiro. |
| `normalizeLanguage(valor)` | função | Devolve `en` só para `'en'`; qualquer outra coisa vira `pt`. |
| `localize(texto, idioma)` | função | Acha o texto em qualquer lado de um par (ou num dos padrões com parte variável) e devolve a versão no idioma pedido. Texto desconhecido volta igual. |
| `mainText(idioma)` | função | Textos da bandeja, dos balões e da caixa de erro do [[main]]. Desde 2026-11-08 inclui `trayStartWithWindows` ("Iniciar com o Windows" / "Start with Windows"). |

## Dependências

- Usa: nada.
- Usado por: [[main]], [[managerService]] (lista de idiomas aceitos), [[overlayToggle]] (normaliza o idioma).

## Invariantes e decisões

- **Traduz na saída, não na origem.** As mensagens continuam em inglês em [[signInFlow]], [[signInService]] e no `sign-in.log`. O [[main]] passa `localize` ao [[signInService]] como `translate` e usa nos balões e diálogos. Assim o log de diagnóstico não muda de língua.
- **Pares nos dois sentidos.** `localize` aceita o texto em inglês ou em português e devolve o do idioma pedido; o [[main]] tem alguns erros que antes eram escritos em português e agora são escritos em inglês, e qualquer texto antigo em português ainda se traduz. Um mesmo texto não pode aparecer em dois pares; o teste confere.
- **Padrões com parte variável.** Duas mensagens têm um trecho que vem de fora (código de erro da Riot, código do script da janela). O trecho é mantido como veio.
- **Sem textos do monitor de janelas.** Desde 2026-11-07 saíram "The background window guard has stopped" e o padrão "The background window guard stopped (motivo). Try Play again", que só o monitor persistente produzia ([[windowController]]). Fica "The background window guard is shutting down", que o controlador ainda usa.
- **Sem "Show Riot Client".** Desde 2026-11-07 as mensagens em inglês do [[signInFlow]] e do [[signInService]] dizem para olhar ou abrir a janela da Riot, como os textos em português já diziam; o botão era da janela antiga. Saiu também um par sem uso: "Could not bring the Riot Client to the front".
- **Par usado pelo lado em português conta como usado.** No mesmo dia saíram por engano mais dois pares cujo texto em inglês não aparecia no código: o [[signInFlow]] escrevia "Preparando o login no Riot Client…" e o [[riotWindowObserver]] "Não foi possível acompanhar a janela do Riot…", e com o app em inglês esses textos ficariam em português. Os pares voltaram, e os dois módulos passaram a escrever em inglês, como o resto. Um teste confere que todo status do [[signInFlow]] e o erro do observador têm par.
- **Sem par, sem erro.** Uma mensagem nova que não entrou no catálogo aparece no texto original. Ao criar mensagem que chega ao usuário, acrescente o par.
- **Padrão português.** Qualquer valor diferente de `'en'` vira `pt`, inclusive dados antigos sem o campo.

## Testes

`test/core/language.test.js` confere o padrão, a normalização, que cada par traduz nos dois sentidos sem repetir texto, os padrões com parte variável, a passagem de textos desconhecidos e que os textos da bandeja existem nas duas línguas com as mesmas chaves.

## Pontos de atenção

- Mudou o texto de uma mensagem em inglês? Atualize o par aqui, senão ela deixa de ser traduzida.
