---
tipo: decisão
status: aceita
data: 2026-11-05
tags: [adr, interface, janelas, segurança]
---

# ADR-017 Cartões cedem a vez aos avisos da Riot

## Contexto

Pedido do usuário em 2026-11-05: depois de muito tempo parado na tela de login, a Riot pergunta "Você ainda está aí?" com os botões Sim e Sair do Riot Client, e os cartões do Eclipse ficam na frente do aviso. A Riot deve ficar em primeiro plano e ter prioridade sobre o Eclipse nesse momento.

Como o aviso funciona, conferido na cópia da interface da Riot em `.client-integration/private-v1/app.asar` (versão 141, só leitura):

- **É um modal dentro da página da Riot**, não uma janela separada: `AFKModal`, aberto pelo `ModalManager` da interface. O Windows não avisa quando ele aparece.
- **Aparece por tempo.** Abre 20 min depois de a Riot criar a sessão de login (2 min com a opção `afk_modal_timer` ligada pela Riot). Sim recria a sessão e recomeça a contagem.
- **O serviço local não muda.** A consulta de login do [[riotOverlay]] continua vendo `auth`, por isso os cartões ficam visíveis.
- **Fundo escurecido na janela inteira.** Todo modal da Riot tem o fundo `.riot-modal-backdrop`, que cobre a janela com `rgba(10, 10, 10, .7)`, inclusive a coluna de login. A coluna de login fica fora da região da sobreposição ([[ADR-013 Caixa para ocultar as contas na coluna de login]]). O ponto `PANEL` (2,6% da largura, metade da altura) é o mesmo que o [[login.ps1]] já exige claro (≥ 240) para considerar o formulário pronto. Ali o branco (≈ 252) passa a ≈ 83 com o aviso aberto.

## Decisão

- **O helper lê o escurecimento.** A cada retrato do [[riotWindowObserver]] (180 ms), o helper copia da tela um quadrado de 7 × 7 px centrado no ponto `PANEL` da área cliente da Riot e confere 9 pixels dele, de 3 em 3 px.
  - Todos com o canal mais alto ≤ 140: a Riot está escurecida.
  - Todos com o canal mais baixo ≥ 230: a Riot está livre.
  - Qualquer outra combinação mantém a leitura anterior, por exemplo durante o esmaecimento de 0,1 s do fundo.
- **Só lê quando a Riot está visível no ponto.** A leitura só acontece se a janela na tela naquele ponto for a própria Riot ou a sobreposição, que não pinta ali. Com outro programa por cima, fora da tela ou com a Riot minimizada, mantém a leitura anterior. Trocar de janela da Riot zera o estado.
- **O retrato leva só um booleano.** Escurecida, a Riot vai no retrato com `"dimmed": true`. Nenhuma cor, imagem ou coordenada da leitura sai do helper, e nada é gravado.
- **A sobreposição cede a vez.** Com `dimmed`, o [[riotOverlay]] esconde a janela inteira (cartões e caixa "Ocultar contas") como faz com a Riot minimizada, sem zerar a sessão de login. O aviso fica todo à mostra e recebe os cliques. Quando o fundo some, o primeiro retrato sem `dimmed` traz os cartões de volta, se o login continuar confirmado.
- **Vale para qualquer modal da Riot na tela de login**, não só o de inatividade, porque todos usam o mesmo fundo. Em todos eles a Riot deve ter prioridade.
- **Regra de segurança revista.** O observador continua sem ler título, texto, campos ou credenciais. A única leitura visual é a cor desse quadrado de 7 × 7 px numa área vazia da coluna de login, à esquerda dos campos e da caixa "Manter login". Nenhum campo, texto ou elemento do formulário fica ali.

## Alternativas consideradas

- **Copiar o cronômetro da Riot** (esconder 20 min depois do login aparecer): o tempo depende de uma opção remota da Riot (20 ou 2 min). O ponto de partida é a criação da sessão, que o Eclipse não vê. Erraria nos dois sentidos.
- **Ler o texto do aviso por UI Automation:** lê conteúdo da janela, depende do idioma e da árvore de acessibilidade do Chromium. O [[login.ps1]] já não reconhece a caixa "Manter login" por UIA na Riot 142.
- **`PrintWindow` da janela inteira**, como o [[login.ps1]]: veria o aviso mesmo com a Riot coberta, mas pede à Riot uma imagem da janela inteira a cada leitura enquanto o Eclipse está aberto. Com a Riot coberta, os cartões também estão, então ler a tela basta.
- **Serviço local da Riot:** o aviso não muda nenhum estado que o Eclipse consulte.
- **Mudar a cópia privada da interface:** só vale no modo privado; o padrão é a sobreposição no cliente oficial ([[ADR-009 Sobreposição no cliente oficial]]).

## Consequências

- O aviso de inatividade e os outros modais da Riot no login aparecem por inteiro, sem os cartões e sem a caixa por cima. Ao responder, os cartões voltam sozinhos.
- Ao voltar para a Riot coberta por outro programa com o aviso já aberto, os cartões ainda podem aparecer por até um retrato (180 ms) antes de sumir.
- Depende da coluna de login continuar clara no ponto `PANEL` e de o fundo dos modais continuar escuro. Se a Riot mudar o layout ou o fundo, os cartões podem não sumir (fundo claro) ou sumir sem aviso (ponto escuro). O mesmo ponto já é conferido pelo [[login.ps1]].
- Cada retrato faz uma cópia de 7 × 7 px da tela. É barato, mas acontece a cada 180 ms enquanto o Eclipse acompanha a Riot.
- Não foi conferido com o aviso real da Riot: a cor esperada foi calculada a partir do CSS da versão 141.

## Relacionado

- [[riotWindowObserver]]
- [[riotOverlay]]
- [[ADR-012 Sobreposição presa à janela do Riot]]
- [[ADR-013 Caixa para ocultar as contas na coluna de login]]
- [[Segurança e privacidade]]
