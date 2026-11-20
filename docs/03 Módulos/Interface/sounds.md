---
tipo: módulo
arquivo: src/renderer/sounds.js
camada: interface
testes: test/renderer/sounds.test.js
tags: [módulo]
---

# sounds

> Toca os sons de interface do cliente do League nos [[cards]] enquanto "Sons da interface" estiver ligado, que é o padrão desde a 2.15.1.

## Responsabilidade

Escolhe o som de cada gesto (passar o mouse ou clicar numa placa, no Jogar, nas abas e nos botões; trocar uma lista; marcar uma caixa) e toca o arquivo da CommunityDragon. **Não** guarda a opção (fica no [[store]], `uiSounds`), **não** baixa nada com a opção desligada e **não** leva os sons no Setup.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `SOUND_BASE`, `SOUNDS` | constantes | Pasta do kit de interface do League na CommunityDragon e os oito arquivos `sfx-uikit-*.ogg` |
| `hoverSound(target)` | função | `{ host, name }` do elemento sob o mouse (Jogar, placa ou linha, aba de jogo ou botão da faixa), ou `null`; botão desligado não toca |
| `clickSound(target)` | função | Som do clique: Jogar (ou o clique neutro quando ele é Cancelar), placa, botão; `null` para o resto |
| `changeSound(target)` | função | `select` para listas, `check` para caixas de marcar |
| `createSounds(make)` | função | Tocador com `setEnabled` e `play(nome)`. `make` cria o `Audio` e é trocado nos testes |

## Dependências

- Usado por: [[cards]] (`cards.js` liga a opção em cada `render` e ouve `mouseover`, `click` e `change` no documento).

## Invariantes e decisões

- **Ligado por padrão, sem pedido de rede desligado.** Na 2.15.0 vinha desligado; na 2.15.1, a pedido do usuário ("pode deixar o som como ligado como padrão?"), só um `false` salvo desliga ([[store]], [[ADR-040 Visual da Riot e sons da interface]]). O tocador em si continua desligado até `cards.js` chamar `setEnabled(true)`, e o `Audio` só é criado no primeiro `play` com a opção ligada. Com ela desligada, a CommunityDragon não recebe nada.
- **Só o kit do League.** Os nomes são uma lista fechada; `play` recusa nomes fora dela, inclusive os herdados de `Object` (`Object.hasOwn`). A CSP de `cards.html` libera áudio só de `https://raw.communitydragon.org`.
- **Caixas de marcar tocam no `change`, não no clique.** O clique no rótulo gera um segundo clique na caixa; ouvir o clique tocava duas vezes.
- **Um som por entrada do mouse.** `cards.js` guarda o último alvo (o `id` da conta ou o próprio botão) e só toca quando ele muda. Sem isso, cada `render` que troca as placas sob o mouse tocava de novo.
- **Volume 0,4** e o mesmo `Audio` reaproveitado (volta ao início a cada toque). Um `play` recusado pelo navegador é ignorado em silêncio.

## Testes

`sounds.test.js`: nada é criado nem tocado com a opção desligada ou com valor diferente de `true`; um `Audio` por som, com volume 0,4 e o endereço da CommunityDragon; nomes desconhecidos recusados; todos os arquivos no formato `sfx-uikit-*.ogg`; a escolha do som por elemento, incluindo botão desligado e Jogar como Cancelar. O som de verdade não é testado: o Chromium sem janela não tem saída de áudio.

## Pontos de atenção

- Os arquivos são da Riot e a CommunityDragon pode mudar o caminho. Se sumirem, o Eclipse só fica mudo.
- Ouvidos só na página de comparação, não no app instalado.
