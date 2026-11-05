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
| `mainText(idioma)` | função | Textos da bandeja, dos balões e da caixa de erro do [[main]]. |

## Dependências

- Usa: nada.
- Usado por: [[main]], [[managerService]] (lista de idiomas aceitos), [[overlayToggle]] (normaliza o idioma).

## Invariantes e decisões

- **Traduz na saída, não na origem.** As mensagens continuam em inglês em [[signInFlow]], [[signInService]] e no `sign-in.log`. O [[main]] passa `localize` ao [[signInService]] como `translate` e usa nos balões e diálogos. Assim o log de diagnóstico não muda de língua.
- **Pares nos dois sentidos.** `localize` aceita o texto em inglês ou em português e devolve o do idioma pedido; o [[main]] tem alguns erros que antes eram escritos em português e agora são escritos em inglês, e qualquer texto antigo em português ainda se traduz. Um mesmo texto não pode aparecer em dois pares; o teste confere.
- **Padrões com parte variável.** Três mensagens têm um trecho que vem de fora (código de erro da Riot, motivo do monitor de janelas, código do script da janela). O trecho é mantido como veio.
- **Sem par, sem erro.** Uma mensagem nova que não entrou no catálogo aparece no texto original. Ao criar mensagem que chega ao usuário, acrescente o par.
- **Padrão português.** Qualquer valor diferente de `'en'` vira `pt`, inclusive dados antigos sem o campo.

## Testes

`test/core/language.test.js` confere o padrão, a normalização, que cada par traduz nos dois sentidos sem repetir texto, os padrões com parte variável, a passagem de textos desconhecidos e que os textos da bandeja existem nas duas línguas com as mesmas chaves.

## Pontos de atenção

- Mudou o texto de uma mensagem em inglês? Atualize o par aqui, senão ela deixa de ser traduzida.
