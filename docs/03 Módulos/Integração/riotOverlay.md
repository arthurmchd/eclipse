---
tipo: módulo
arquivo: src/integration/overlay/riotOverlay.js
camada: integração
testes: test/integration/overlay/riotOverlay.test.js
tags: [módulo, interface]
---

# riotOverlay

## Responsabilidade

Hospeda os cartões de contas em [[managerHost]] sobre a área de arte da janela oficial detectada por [[riotWindowObserver]]. Reutiliza preload e [[managerService]].

## API pública

`createRiotOverlay({ electron, request, readAuthenticationState, createObserver, createHost, onError })` retorna `start(clientPath)`, `open()`, `setBlocked(bool)`, `setOperation(operation)` e `stop()`. Dependências e temporizadores são injetáveis. `overlayBounds` calcula os limites e `overlayShape` calcula a região de pintura/cliques sem acessar o sistema.

## Invariantes e decisões

- **Presa à janela da Riot.** Desde 2026-11-04 ([[ADR-012 Sobreposição presa à janela do Riot]]), a janela não é `alwaysOnTop` e não chama `moveTop`. `start` passa o identificador nativo da janela (`getNativeWindowHandle`, como texto decimal) ao [[riotWindowObserver]], cujo helper faz da janela da Riot a dona da sobreposição. O Windows então a mantém logo acima da Riot, esconde as duas juntas ao minimizar e deixa outros programas cobrirem as duas. Os cartões aparecem com a Riot visível na tela de login, mesmo com outro programa em foco. Pedido do usuário: o gerenciador sumia ao trocar de programa e seguia o arraste com atraso.
- **Minimizar sem perder a sessão.** Desde 2026-11-04, com a Riot minimizada o observador continua mandando a mesma janela, marcada `minimized: true`. O `id` não muda, então a sessão não é zerada e a leitura do login segue a cada 750 ms. `layout` esconde a janela com `hide` nesse estado, e o primeiro retrato sem `minimized` (cerca de 10 ms depois de restaurar) a mostra de novo sem esperar nova consulta do login. Teste com uma Riot falsa feita em Electron: os cartões voltaram 15 ms depois de a Riot restaurar. Antes, a janela minimizada virava `target:null`, a sessão era zerada e os cartões demoravam até perto de 1 s para voltar.
- **Não deixar a volta por conta do Windows.** Uma versão do mesmo dia não chamava `hide` com a Riot minimizada e deixava o Windows esconder e trazer de volta os cartões junto com a dona. Com a Riot real, isso fez a janela da Riot voltar sozinha cerca de 0,1 s depois de minimizar, sem desenhar nada: o usuário via só os cartões sobre a área de trabalho, e um clique neles trazia a Riot. Isso não se reproduziu com janelas de teste, nem com uma Riot falsa em Electron; a causa exata dentro da Riot não é conhecida. Não volte a deixar a sobreposição visível para o Windows enquanto a Riot está minimizada.
- **Movimento sem refazer a região.** Cada nova posição chama `setBounds`; `setShape` só roda quando largura ou altura mudam, para o arraste não recalcular a região de cliques a cada evento.
- **Some depois que a conta entra.** `setOperation` esconde a janela enquanto a operação está `running` com `signedIn: true`. Quando a operação termina, volta a valer só a regra da tela de login. Pedido do usuário em 2026-11-04: entrar na conta é diferente de entrar no jogo, e o gerenciador não deve ficar sobre o Riot depois da primeira.
- Desde 2026-11-02, cartões aparecem somente com estado sanitizado `auth` sem erro ou `error/auth_failure`, que permite tentar novamente. Sessão autenticada, MFA, desafio fora do formulário de login, estado desconhecido e falha de consulta ocultam o painel. A origem do login e o cadastro da conta não entram nessa decisão; logout confirmado permite reaparecer.
- O main injeta `readAuthenticationState(signal)`. Com uma janela Riot detectada, consulta a cada 750 ms, sem consultas simultâneas da mesma geração. A janela começa oculta até a confirmação; uma confirmação com mais de 2,5 s perde validade. Troca/desaparecimento de janela invalida respostas anteriores e cancela a consulta. `stop()` cancela consulta e timer. Abrir pelo menu não ignora a sessão.
- O monitor é somente leitura; ocultar cartões não cancela o login nem o lançamento do jogo. Nenhuma credencial ou identidade é necessária para decidir visibilidade.
- A superfície vazia `about:blank` é inicializada antes da view; a janela aparece sem tomar foco (`showInactive`).
- A divisão 400/1536 do layout medido reserva o login. A janela cobre toda a arte até as bordas da área cliente, sem margens verticais. A proporção é do layout conhecido, não detecção por pixels.
- `setShape` delimita duas regiões contínuas: coluna principal e rodapé de 104 DIP em toda a largura. A coluna reserva à direita `max(96, ceil(larguraDaView * 104 / 1136))` DIP, limitado ao espaço disponível, igual ao CSS de [[cards]]. O rodapé fica limitado à altura da janela. Não há recortes individuais dos ícones. Minimizar, fechar e perfil continuam fora da captura de cliques, nas posições nativas. Menus que avancem à esquerda dessa faixa ainda precisam de conferência visual.
- A janela é transparente e carrega [[cards]] automaticamente, com recuo interno zero e fundo geral totalmente transparente no renderer. Conversão de coordenadas físicas para DIP acontece antes do cálculo de geometria.
- O renderer recebe operações pela API de eventos existente, bloqueia novas ações durante login e oferece Cancelar. `setBlocked` e `setOperation` permanecem compatíveis com o main, sem ocultar cartões ou criar outro canal IPC.
- Startup cria janela oculta, sem moldura e sem item na barra de tarefas; não inicia Riot. Só mostra com login confirmado e janela da Riot visível, em foco ou não.
- Fechar ou perder dados do observador oculta a sobreposição. Minimizar a Riot oculta com `hide`, sem zerar a sessão. Perder foco não oculta mais (desde 2026-11-04). Ao voltar, os cartões aparecem automaticamente se o cliente ainda estiver no login.
- A view usa as proteções IPC de [[managerHost]]: remetente, frame principal e URL local exata. Não há leitura de credenciais ou conteúdo da interface nativa.
- Fechar a janela sobreposta não encerra o serviço. Parar destrói somente a própria janela e observador.
- Decisão: [[ADR-009 Sobreposição no cliente oficial]]. Sem arquivos Riot alterados, sem plugin Pengu e sem ponte HTTP no modo padrão.

## Testes

Fakes cobrem escala, coordenadas negativas, janela sem `alwaysOnTop`, identificador entregue ao observador, movimento sem refazer a região, Riot minimizada escondendo sem zerar a sessão e voltando no primeiro retrato restaurado, desaparecimento, reabertura e visibilidade por sessão. Testes de geometria conferem os controles nativos fora da área sobreposta e limites da faixa de arte em várias alturas. A visualização possui teste Electron real em [[managerHost]].
