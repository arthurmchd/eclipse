---
tipo: decisão
status: aceita
data: 2026-11-04
tags: [adr, arquitetura, interface, janelas, segurança]
---

# ADR-015 Controles da janela do Riot desenhados pelo Eclipse

## Revisão de 2026-11-06

A cópia do perfil saiu, a pedido do usuário: "retire do eclipse o botão de gerenciar a conta da riot, faça com que ela apareça apenas quando o usuário clicar para esconder contas (modo padrão de acessar da riot)". Os [[cards]] desenham só minimizar e fechar. O botão real do perfil fica escondido embaixo da página e volta a funcionar quando o usuário marca "Ocultar contas", que devolve a arte inteira à Riot. A ação `reveal` saiu do [[managerHost]], do [[manager-preload]] e do [[riotOverlay]]. O resto da decisão continua; o item "O perfil oculta as contas" abaixo fica como registro.

## Contexto

Em 2026-11-04 o usuário pediu para usar toda a área do Riot Client, menos a coluna de login. No canto superior direito da arte ficam três controles nativos da Riot: minimizar, fechar e o botão redondo do perfil. Até aqui a região de cliques da sobreposição deixava de fora uma faixa à direita para esses controles continuarem funcionando ([[ADR-011 Cartões sobre a arte do Riot]], [[ADR-012 Sobreposição presa à janela do Riot]]). O usuário achou o recorte estranho e, sem ele, os controles ficariam embaixo da janela do Eclipse, visíveis mas sem receber cliques.

## Decisão

- **A região cobre a arte inteira.** Com as contas visíveis, a região de cliques é a caixa "Ocultar contas" mais toda a área à direita da coluna de login, de cima a baixo. Com as contas ocultas, só a caixa. A diferença de região com um diálogo aberto deixa de existir, e o aviso `setModal` dos cartões sai.
- **Os cartões desenham cópias dos três controles** nas mesmas posições e tamanhos da Riot, medidos na base de 1536 × 864 e escalados pela largura da janela, como a interface da Riot faz: minimizar e fechar com 32 × 24 no topo, colados à direita, e o perfil com 48 de diâmetro, 32 abaixo do topo e 16 da borda direita.
- **Minimizar** chama `ShowWindowAsync(SW_MINIMIZE)` na janela da Riot pelo helper do [[riotWindowObserver]], o mesmo efeito do botão da Riot (`mainWindow.minimize()`).
- **Fechar** repete a decisão do botão da Riot pelo serviço local, sem tocar em arquivos:
  - o Eclipse lê a flag `lifecycle.backgroundRunning`, a opção do jogador `enable_run_in_background_set_by_player` (padrão: ligada), a linha de comando (`--launch-background-mode`) e se o lançamento veio do app do Xbox;
  - se o Riot ficaria em segundo plano, envia `POST /riot-client-lifecycle/v1/quit/switch-background-mode`;
  - se o Riot fecharia de vez, envia `POST /riot-client-lifecycle/v1/quit` e pede ao helper para fechar a janela (`WM_CLOSE`), como o `RiotClient.QuitUX` da Riot faz;
  - se o serviço local não responder, o helper só fecha a janela, como Alt+F4.
- **O perfil oculta as contas.** Escolha do usuário: o clique marca "Ocultar contas", e o botão real da Riot fica livre para o segundo clique. Nada é enviado à Riot.
- **Regra nova para o helper.** Ele passa a aceitar dois comandos, uma linha cada pela entrada padrão (que agora fica aberta): `minimize` e `close`. Só age na janela já escolhida e conferida pelo caminho do executável oficial, visível e não minimizada, e só quando o usuário clica na cópia. Fora isso, a janela da Riot continua sem nenhuma alteração, e o helper continua sem ler título, conteúdo ou credenciais.

## Alternativas consideradas

- **Manter o recorte:** foi o que o usuário rejeitou, e impede usar a faixa direita.
- **Abrir as Configurações da Riot pelo perfil:** existe o comando interno `ShowSettings`, entregue por `/riot-client-lifecycle/v1/ux-command`. Seria escrever num canal interno da interface da Riot, sem garantia de uso externo. O usuário preferiu revelar a Riot.
- **Minimizar com um PowerShell avulso a cada clique:** levaria cerca de um segundo para iniciar e compilar o código nativo. O helper já está rodando e conhece a janela.
- **Fechar só com `WM_CLOSE`:** a janela principal da Riot não intercepta o fechamento. A escolha entre segundo plano e sair fica na interface, então o Riot sairia sem respeitar a opção do jogador.
- **Fechar com `/process-control/v1/process/quit`:** encerra o cliente mesmo quando o jogador escolheu mantê-lo em segundo plano.

## Consequências

- Os controles nativos continuam embaixo da página. Desde a troca da arte por fundo branco no mesmo dia, ficam escondidos; antes apareciam por baixo e dobravam os traços. Se uma atualização da Riot mover esses controles, as cópias ficam fora do lugar e os nativos não recebem cliques. As medidas estão em [[cards]] e precisam ser revistas junto com a posição da caixa do [[overlayToggle]].
- A faixa de arrastar da Riot no topo da arte fica coberta. A janela da Riot só pode ser arrastada pela faixa superior da coluna de login.
- Com o app do Xbox aberto, a Riot mostra um aviso antes de ir para o segundo plano. A cópia vai direto para o segundo plano, que é a ação do único botão desse aviso.
- Os efeitos de passar o mouse imitam os da Riot. A dica de ferramenta e o menu do perfil não são reproduzidos.
- Fechar a entrada padrão do helper não o encerra. Ele continua terminando quando o processo do Eclipse sai.
- Não foi conferido com a Riot real aberta.

## Relacionado

- [[riotOverlay]]
- [[riotWindowObserver]]
- [[cards]]
- [[Segurança e privacidade]]
