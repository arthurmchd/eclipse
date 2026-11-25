---
tipo: decisão
status: aceita
data: 2026-11-24
tags: [adr, interface, segurança, desempenho]
---

# ADR-050 Estandarte reduzido nos cartões

## Contexto

Pedido do usuário em 2026-11-24, depois de a 2.28.2 reduzir a memória do Eclipse: procurar o que ainda carrega de um jeito que não deveria. O estandarte do League vem do CommunityDragon em PNG de 580×1480 e aparece no cartão com 140×357. O WebView2 guarda cada PNG decodificado no tamanho cheio, cerca de 3,3 MB por estandarte diferente, quando o cartão só precisa de uma fração disso. O CommunityDragon não tem versão menor dos estandartes (pasta `regalia/bannerskins` conferida), e o PNG, ao contrário do JPEG, não é decodificado já reduzido.

O usuário perguntou se os cartões ficariam menores; não ficam: só a imagem guardada encolhe.

## Decisão

Os cartões reduzem cada estandarte uma vez, num `canvas` de 280×714 (o dobro do tamanho mostrado, para ficar nítido com escala de até 200% no Windows), e usam a cópia reduzida por um endereço `blob:`. Para isso a CSP de `cards.html` ganha `blob:` em `img-src`, e só nele. A imagem original vem com `crossOrigin = 'anonymous'`, que o CommunityDragon aceita (`Access-Control-Allow-Origin: *`). Se a redução falhar, o cartão mostra a original, como antes.

## Alternativas consideradas

- **Um `canvas` por cartão no lugar da imagem:** dispensa mudar a CSP, mas cada cartão ganha sua própria superfície de 0,8 MB, e com estandartes repetidos gastaria mais que hoje.
- **Reduzir no Rust e servir por `eclipse://`:** exige baixar imagens no Rust e uma biblioteca de imagem nova, para o mesmo resultado.
- **`data:` em vez de `blob:`:** também muda a CSP e guarda a imagem em texto base64, maior.
- **Deixar como está:** com poucas contas são uns 15 MB; o usuário escolheu reduzir.

## Consequências

- Cada estandarte diferente cai de cerca de 3,3 MB para 0,8 MB na memória, sem mudar o tamanho na tela.
- `blob:` em `img-src` só vale para imagens. Um `blob:` só pode ser criado por script da própria página, que continua sem script de fora, sem `connect-src` e sem `style` inline; imagem não executa código. A regra fica registrada em [[Segurança e privacidade]].
- Os endereços `blob:` ficam guardados enquanto a página vive, um por estandarte diferente; não crescem com o número de redesenhos.
- O estandarte aparece depois da imagem original carregar e ser reduzida; na primeira vez pode surgir um instante depois do resto do cartão.
- Desde a 2.29.1 qualquer falha da redução, inclusive a cópia `blob:` não carregar ou a redução passar de 15 s, cai na original; antes, um erro dentro do `onload` deixava o cartão sem estandarte. Desde a 2.29.2 uma cópia que só fica pronta depois dos 15 s é liberada, para não ocupar memória sem uso.

## Relacionado

- [[cards]]
- [[Segurança e privacidade]]
- [[ADR-040 Visual da Riot e sons da interface]]
- [[Arquitetura]]
