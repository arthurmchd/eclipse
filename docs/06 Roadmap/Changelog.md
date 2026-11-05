---
tipo: roadmap
tags: [changelog]
---

# Changelog

Mudanças relevantes, da mais nova para a mais antiga.

## 2026-11-04 · Cartões aparecem de uma vez ao restaurar a Riot

- Pedido do usuário: depois de minimizar, ao abrir a Riot de novo a arte aparecia por menos de 1 s antes dos cartões; por Alt+Tab, não. Revisão em [[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]].
- Causa medida com uma janela de teste e leitura do pixel na tela: numa janela Electron transparente, o Chromium faz a janela surgir aos poucos, em cerca de 200 ms, a cada `show`.
- [[main]]: o modo sobreposto liga `wm-window-animations-disabled`; a janela aparece no primeiro quadro e a região continua recortando.
- Primeira tentativa, desfeita no mesmo dia: janela opaca. Aparecia no primeiro quadro, mas o Electron ignora a região ao pintar janela opaca e a coluna de login ficou preta na Riot real.
- Não foi conferido com a Riot real.

## 2026-11-04 · Sem arte ao minimizar e pontas no formato da Riot

- Pedido do usuário: ver a arte da Riot só ao ocultar as contas (ela aparecia rapidamente ao minimizar) e manter o fundo novo dentro da janela da Riot. Decisão em [[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]].
- [[riotWindowObserver]]: o helper desliga a animação de minimizar da janela da Riot enquanto a acompanha e a devolve ao trocar de janela, ao fechar a entrada ou ao fim do processo dono. `stop` agora fecha a entrada e só mata o helper depois de 1 s. Cada retrato leva `corner`, o raio dos cantos da janela.
- [[riotOverlay]]: a região tira das pontas direitas o arredondado da Riot (4, 3, 2 e 1 px a 100%). Causa medida na Riot aberta, só leitura: cantos `DWMWCP_ROUND`; a sobreposição tinha cantos retos.
- Descartado: o helper mostrar os cartões ao restaurar. Testado com Electron, a janela mostrada por fora não volta a desenhar.
- Testes novos: autoteste do helper com a animação e o raio, helper real saindo sozinho ao fechar a entrada, `corner` validado, parada em duas etapas, recorte das pontas sem passar do arredondado e região refeita quando o raio muda. Não foi conferido com a Riot real.

## 2026-11-04 · Fundo branco no lugar da arte do Riot

- Pedido do usuário: tirar a arte da Riot do fundo dos cartões e usar um branco um pouco mais suave que o da Riot. Revisão em [[ADR-011 Cartões sobre a arte do Riot]].
- [[cards]]: `html` e `body` com `#f2f2f2` (a coluna de login da Riot é `#fcfcfc`). As cópias de minimizar e fechar passaram para traço `#636363` sem sombra; o fechar fica com traço branco sobre o vermelho ao passar o mouse.
- [[riotOverlay]]: a view dos cartões abre com o mesmo `#f2f2f2`, sem mostrar a arte durante o carregamento.
- Com o fundo opaco, os controles nativos não aparecem mais por baixo das cópias. Com as contas ocultas, a arte da Riot volta.
- Teste do [[riotWindowObserver]]: o autoteste de ordem das janelas falhava às vezes com a suíte inteira rodando, por janelas de outros testes entrando no meio. Agora tenta até 3 vezes.

## 2026-11-04 · Cartões na arte inteira, com cópias dos controles do Riot

- Pedido do usuário: usar toda a área do Riot Client menos a coluna de login, sem perder minimizar, fechar e o botão do perfil, que ficariam embaixo da janela do Eclipse. O recorte antigo foi achado estranho. Decisão em [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]].
- [[riotOverlay]]: a região normal passou a ser a caixa mais a arte inteira. A região própria de diálogo e o aviso `setModal` saíram.
- [[cards]]: cópias em SVG de minimizar, fechar e perfil nas posições da Riot, em unidades de `100vw / 1136`, comparadas pixel a pixel com a captura do usuário. A lista usa a largura toda; avisos ainda deixam espaço para o perfil.
- Minimizar: comando `minimize` ao helper do [[riotWindowObserver]], que agora mantém o stdin aberto e só age na janela oficial já conferida.
- Fechar: módulo novo [[riotAppControls]] repete a escolha do X da Riot (segundo plano ou sair) pelo serviço local; ao sair, ou se o serviço falhar, o helper fecha a janela.
- Perfil: oculta as contas e marca a caixa ([[overlayToggle]] ganhou `setHidden`), deixando o botão real da Riot livre. Escolha do usuário.
- [[managerHost]] e [[manager-preload]]: `windowAction` com `minimize`, `close` ou `reveal` no lugar de `setModal`.
- Testes novos: helper real recebendo comandos sem tocar janelas, autoteste minimizando e fechando janelas de teste, decisão de fechamento, ações na sobreposição, caixa marcada pelo main e cópias no teste Electron dos cartões. Não foi conferido com a Riot real aberta.
- Limites: a faixa de arrastar da Riot no topo da arte fica coberta, e traço e X aparecem um pouco mais marcados porque os nativos continuam por baixo da página transparente.

## 2026-11-04 · Eclipse em português e inglês

- Pedido do usuário: escolher entre inglês e português nas Configurações, com o Eclipse todo nas duas línguas e português como padrão. Decisão em [[ADR-014 Interface em português e inglês]].
- [[store]] guarda `language` (padrão `pt`); [[managerService]] aceita só `pt` ou `en` e avisa o [[main]] ao salvar.
- Módulo novo [[language]]: catálogo inglês/português das mensagens do login e do main, e textos da bandeja e dos diálogos. [[signInService]] traduz só o que publica (opção `translate`); o `sign-in.log` continua em inglês.
- [[main]]: bandeja, balões e caixas de erro no idioma salvo; o menu da bandeja muda na hora.
- [[cards]]: seletor de idioma no topo das Configurações e todos os textos em `cardsText.js`, inclusive elos (em inglês, nomes da Riot, LP e W/L; em português, VALORANT agora traduzido).
- [[overlayToggle]] e [[riotOverlay]]: "Ocultar contas" vira "Hide accounts" em inglês.
- Fora do escopo: renderer legado do modo privado, textos injetados na cópia privada da Riot e scripts `.bat`.
- Testes novos no catálogo, no store, nos serviços, no main, na caixa e no teste Electron dos cartões. Não foi conferido com a Riot aberta.

## 2026-11-04 · Ícone da Riot para só entrar na conta

- Pedido do usuário: um ícone da Riot à esquerda do League; com ele selecionado, o botão principal entra na conta escolhida e deixa o Riot Client aberto, sem abrir jogo.
- [[signInFlow]] aceita `riot`: faz o login e a conferência do Riot ID de sempre, guarda a sessão, mostra o cliente e para. [[signInService]] e [[managerService]] aceitam `riot`; o sucesso é `clientOpened`, sem marcar jogo jogado.
- [[cards]]: ícone `riot.png`, tema vermelho da Riot, botão "Entrar" e cartões com os elos do último jogo escolhido.
- Testes novos no fluxo, nos serviços e no teste Electron dos cartões. Não foi exercitado com contas reais.

## 2026-11-04 · O app passa a se chamar Eclipse

- Pedido do usuário: o projeto agora se chama Eclipse, com a imagem enviada como ícone. A dica da bandeja e os títulos de avisos, erros e balões dizem "Eclipse" ([[main]]).
- Ícone novo em `src/renderer/assets/icon.png` e `icon.ico` (fundo branco removido); a bandeja usa o `.ico` ([[paths]]).
- O `name` do `package.json`, a pasta do projeto e a pasta de dados continuam `riot-account-manager`, para não perder as contas salvas.

## 2026-11-04 · Caixa "Ocultar contas" com o visual da Riot

- O usuário pediu a caixa mais parecida com a original em tamanho, arredondamento e cor. [[overlayToggle]] agora usa os valores do CSS da tela de login da Riot (quadrado de 16 px, cantos de 20%, cinza translúcido, vermelho `#d53235` com o mesmo visto, Inter de 14 px) e ajusta peso e espaçamento do texto até a largura e a altura baterem com o "Stay signed in" numa captura.

## 2026-11-04 · Caixa "Ocultar contas" ao lado do "Stay signed in"

- Pedido do usuário: uma cópia da caixa "Stay signed in" da Riot, à direita dela, que esconde o gerenciador inteiro quando marcada e o traz de volta quando desmarcada. Começa sempre desmarcada.
- [[ADR-013 Caixa para ocultar as contas na coluna de login]]: a janela da sobreposição passa a cobrir toda a área da Riot; os cartões ficam no mesmo lugar por um recuo à esquerda no [[managerHost]], e a caixa é uma segunda visualização ([[overlayToggle]]). Na coluna de login, só o retângulo da caixa pinta e recebe cliques.
- Marcar tira os cartões da região de pintura e de cliques do [[riotOverlay]]; o estado fica só na memória.
- Posição medida numa captura da tela de login do Riot Client v142 em 1536×864. Testes novos: geometria em seis tamanhos, IPC só com booleano e um teste com Electron real que clica na caixa.

## 2026-11-04 · Fundo dos diálogos cobre a janela inteira

- O fundo escurecido de Configurações e dos outros diálogos parava antes da faixa da direita, onde ficam os controles da Riot, porque a janela dos cartões não pinta nem captura cliques ali.
- [[cards]] avisa por `setModal` quando um diálogo abre ou fecha; o [[managerHost]] trata o aviso localmente e o [[riotOverlay]] troca a região pela janela inteira enquanto o diálogo está aberto. Com um diálogo aberto, os botões da Riot naquela faixa ficam cobertos.
- Testes novos no host, no preload, na sobreposição e no teste Electron real.

## 2026-11-04 · Ícones de jogo fixos e atualizar só pelo ícone

- Em [[cards]], a conta selecionada no rodapé tem largura fixa e corta o texto com reticências; os ícones do League e do VALORANT não mudam mais de lugar quando o nome do jogo ou da conta muda de tamanho.
- O botão de atualizar é só o ícone ↻; "N contas · atualizado há X" virou texto ao lado, sem clique nem seleção.
- O teste Electron confere a posição dos ícones ao trocar de jogo e de conta e que o contador fica fora do botão.

## 2026-11-04 · Cartões desenhados ao restaurar a Riot

- Com a Riot minimizada, abrir o gerenciador e restaurar a Riot não mostrava os cartões, só depois de minimizar e restaurar de novo. O registro de janelas mostrou os cartões visíveis e na frente da Riot, mas a tela tinha a arte da Riot no lugar deles: os cartões apareceram primeiro atrás da Riot, o Chromium os marcou como cobertos e não voltou a desenhá-los depois de virem para a frente.
- O [[main]] desliga a detecção de oclusão do Chromium no modo sobreposto. Com uma Riot falsa em outro processo, a página dos cartões ficou `hidden` por mais de 3 s com a detecção ligada e `visible` com ela desligada.
- Teste novo no início do app. A correção da entrada anterior (trazer os cartões para a frente) continua, mas sozinha não resolvia este caso.

## 2026-11-04 · Cartões aparecem na primeira abertura da Riot

- Com o gerenciador aberto antes da Riot, os cartões não apareciam na primeira abertura; só depois de minimizar e restaurar. (Leitura revista: o caso relatado era a Riot minimizada, não fechada; ver a entrada seguinte, mais nova.) A Riot abre primeiro uma janela pequena e depois a principal; os cartões ficavam presos à pequena e, ao passar para a principal, continuavam atrás dela.
- O [[riotWindowObserver]] agora coloca os cartões logo acima da Riot sempre que eles estão visíveis e abaixo dela. Conferido com uma Riot falsa em Electron que abre do mesmo jeito.
- Autoteste novo no helper do observador, rodado pela suíte; ele falha sem a correção.

## 2026-11-04 · Cartões voltam junto com a Riot

- Ao restaurar a Riot minimizada, os cartões demoravam até perto de 1 s para voltar. A janela minimizada virava "sem janela", a sessão era zerada e os cartões esperavam a próxima leitura e uma nova consulta do login.
- Agora o [[riotWindowObserver]] mantém a janela minimizada como escolhida e a marca `minimized:true`, e a [[riotOverlay]] não esconde nem mostra nada nesse estado. O Windows traz os cartões de volta junto com a Riot. Teste com Electron e janela de teste: 34 ms entre o pedido de restaurar e os cartões pintados na tela.
- Testes novos para a janela minimizada na sobreposição e no observador; o da sobreposição falha sem a correção.
- Correção posterior no mesmo dia: a primeira versão não escondia os cartões com a Riot minimizada e deixava o Windows trazê-los de volta. Com a Riot real, a janela da Riot voltava sozinha logo depois de minimizar, sem desenhar nada, e os cartões ficavam sozinhos sobre a área de trabalho (também ao reabrir o gerenciador). Agora a [[riotOverlay]] esconde os cartões com a Riot minimizada, mantém a sessão e os mostra no primeiro retrato restaurado. Com uma Riot falsa em Electron, os cartões voltaram 15 ms depois da Riot, e ela continuou minimizada.

## 2026-11-04 · Cartões presos à janela do Riot

- Os cartões não somem mais ao trocar de programa: a janela da Riot passou a ser dona da sobreposição. O Windows mantém os cartões logo acima da Riot, cobertos por outros programas quando eles estão na frente, e esconde os dois juntos ao minimizar. A sobreposição deixou de ser "sempre no topo". Decisão: [[ADR-012 Sobreposição presa à janela do Riot]].
- Ao arrastar a Riot, os cartões seguem por evento do Windows (`EVENT_OBJECT_LOCATIONCHANGE`), não mais pela leitura a cada 180 ms. Com janelas de teste, cada movimento chegou ao gerenciador em 0 a 12 ms. A região de cliques só é recalculada quando o tamanho muda.
- [[riotWindowObserver]]: helper reescrito com laço de mensagens; recebe o identificador da sobreposição, confere que ela é do gerenciador e define o dono; o campo `active` saiu. [[riotOverlay]]: sem `alwaysOnTop`, sem `moveTop`, sem depender do foco.
- Testes da sobreposição e do observador ampliados (um deles achou um número aceito como identificador; corrigido para exigir texto). 340 passam. Falta conferir no Riot real; ver [[Backlog]].

## 2026-11-04 · Jogo desatualizado abre depois da atualização

- Quando o pedido de abertura volta HTTP 424 `launch_failed_product_not_up_to_date`, o [[signInFlow]] agora mostra "aguardando a atualização", repete o pedido a cada 15 s e espera até 20 min. Antes, esperava 180 s e falhava mesmo com a atualização terminada (login real de 2026-11-04 12:36).
- Depois de um pedido aceito, o prazo de 180 s e o aviso de demora contam a partir dele. Outras recusas continuam com um único pedido.
- [[riotClient]]: `requestLaunch` devolve `{ status, errorCode }`.
- 4 testes novos no fluxo; os três do comportamento novo falham sem a correção. 339 passam. Ainda não exercitado no Riot real. Ver [[Backlog]].
- Limpeza: removidos itens duplicados nas notas [[signInFlow]] e [[riotClient]].

## 2026-11-04 · Sem aviso falso de verificação

- Logo depois que o formulário nativo envia a senha, a Riot passa alguns segundos numa checagem automática. O [[signInFlow]] tratava isso como verificação pendente e mostrava "Conclua a verificação" e o balão "O login precisa de sua atenção" em quase todo login, 2 a 3 s antes de a conta entrar (logs reais de 2026-11-02 e 2026-11-04). Agora há tolerância de 12 s para essa checagem; se ela continuar, o aviso aparece como antes. 2FA continua imediato.
- 2 testes novos: checagem curta sem aviso; checagem longa avisa depois da tolerância e revela a janela. O primeiro falha sem a correção. 335 passam.
- Validado no Riot real em 2026-11-04 (horário local): nos logins das 12:36 e das 12:38, já com o código novo, não houve nenhum "Riot needs a security check"; a conta entrou 2 a 3 s depois do envio da senha. No das 12:38, com "Manter login" desmarcado, o log registrou `remember:off` e "stay signed in is off; no session was kept", e o jogo abriu às 12:38:55. O login das 12:36 parou porque o League precisava de atualização (HTTP 424 `launch_failed_product_not_up_to_date`) e foi interrompido ao reiniciar o app. Ver [[Backlog]].

## 2026-11-04 · Cancelar no botão, gerenciador some ao entrar e "Manter login"

- Durante o login, o botão Jogar vira **Cancelar**. Saiu a faixa "Entrando na conta e preparando seu jogo…"; ela só aparece quando a Riot pede verificação.
- O gerenciador some assim que a conta entra, sem esperar o jogo: o fluxo marca os status seguintes com `signedIn` e o [[riotOverlay]] se esconde. A leitura da tela de login também passou a conferir `/rso-auth/v1/authorization`, para não mostrar os cartões sobre a página inicial do Riot.
- Nova opção **Manter login** nas configurações (marcada por padrão). Desmarcada: login direto e formulário nativo enviam `remember: false`, o [[login.ps1]] desmarca "Stay signed in" quando reconhece a caixa, e o app não restaura nem grava sessões.
- 6 testes novos ou ampliados (autenticação, fluxo, serviço, sobreposição, configurações, armazenamento e Electron); 333 passam. Conferido no `npm run preview`.
- Teste real em 2026-11-04 12:29 (horário local), app reiniciado às 12:29:37 com o código novo e "Manter login" no padrão (ligado): formulário nativo preenchido em 7 s, conta autorizada em 11 s ("Signed in" às 12:29:58), cliente do League às 12:30:10, sessão guardada e "Game opened" às 12:30:22. O log não registra quando os cartões somem; isso depende da observação do usuário. A caixa "Stay signed in" saiu como `remember:unknown`, como nos testes anteriores: com "Manter login" desmarcado, o [[login.ps1]] não conseguiria desmarcá-la. Ver [[Backlog]].

## 2026-11-04 · Cartão sem avatar de iniciais

- Removido o círculo com as iniciais à esquerda do Riot ID; o cabeçalho do cartão mostra só nome, tag e nível. Teste do Electron verifica a ausência do avatar. Conferido no `npm run preview`.

## 2026-11-04 · Rodapé com o jogo escolhido

- Ícones do League e do VALORANT foram para o rodapé, à esquerda da conta selecionada; a barra superior deixou de existir e a lista sobe para 24 px do topo.
- Tema por jogo em `body[data-theme]`: League com destaques dourados e Jogar azul-escuro com borda dourada; VALORANT com destaques vermelhos e Jogar vermelho de canto cortado. A cor do jogo vai para a borda do cartão selecionado, a linha no topo do rodapé, o ícone ativo, o foco, o progresso e os botões dos diálogos.
- Teste do Electron verifica a ausência da barra, a posição dos ícones e a troca de tema. Conferido no `npm run preview` em 1130 e 600 px; não conferido ainda na janela real do Riot.

## 2026-11-04 · Ícones de jogo na barra superior

- "League of Legends" e "VALORANT" na barra superior viraram ícones de 28 px (`assets/lol.png`, extraído do `.ico` enviado, e `assets/valorant.png`). O nome continua em `aria-label` e na dica do mouse. O jogo ativo fica colorido com sublinhado vermelho; o outro fica cinza.
- Teste do Electron verifica que os botões de jogo têm nome acessível, imagem carregada e nenhum texto visível. Conferido no `npm run preview`; não conferido ainda na janela real do Riot.

## 2026-11-04 · Solo/Duo e Flex no mesmo cartão

- Cartão do League mostra as duas filas lado a lado, cada uma com emblema, elo, PdL e "winrate · VitóriasV DerrotasD"; VALORANT mostra só Competitivo. Removido o seletor de fila da barra superior, que agora tem só os jogos.
- Teste do Electron verifica as duas colunas, a fila sem partidas como "Sem classificação" e a ausência do seletor. Conferido no `npm run preview` em 1130 e 600 px; não conferido ainda na janela real do Riot.

## 2026-11-04 · Ações onde são usadas

- Canto superior direito livre para o perfil e os controles do Riot: a barra superior ficou com jogo e fila numa linha só, na largura do conteúdo. Antes, `+ Conta`, atualizar e configurações encostavam no círculo do perfil do Riot e pareciam uma fileira de quatro controles.
- Adicionar virou o cartão tracejado "Adicionar conta" no fim da grade. Configurações e o botão "N contas · atualizado há X" (que atualiza as estatísticas) foram para a esquerda do rodapé. O rodapé mostra só a conta e a região, sem o rótulo "CONTA SELECIONADA".
- Teste do Electron verifica que a barra superior só tem os jogos, que o rodapé tem as ações e que o cartão abre o diálogo de cadastro. `npm run preview` passa a servir `src/renderer/cards.html` com dados fictícios. Não conferido ainda na janela real do Riot.

## 2026-11-04 · Acabamento da borda superior

- Captura da janela real mostrou a caixa encostada sobre a linha externa superior. Adicionado recuo de 2 px apenas na barra superior, preservando largura e rodapé. Teste de limites atualizado; alteração ainda depende de recarregar o gerenciador em execução.

## 2026-11-04 · Caixa superior sem contorno

- Removida a borda cinza visível da barra superior, preservando dimensões, fundo e alinhamento.

## 2026-11-04 · Encaixe nas bordas do Riot

- Barra superior no topo da área cliente, com largura preservada pela reserva dos controles nativos. Rodapé de 104 DIP estendido até as bordas inferior e direita da arte.
- Observador mede a área cliente em coordenadas de tela, excluindo bordas invisíveis do Windows. Região nativa une coluna principal e rodapé, deixando perfil/minimizar/fechar fora dos cliques do painel.
- Testes verificam limites, região dos controles e correspondência entre CSS e geometria no Electron; validação isolada usa dados fictícios.

## 2026-11-04 · Organização baseada no rascunho

- Barra única com jogos à esquerda, adicionar/atualizar/configurações à direita e fila na segunda linha. Removido o espaço separado que antes abrigava somente as ações.
- Cartões compactos de até 330 px em duas colunas à esquerda, com mais espaço entre eles e a barra, revelando mais da arte. Mantidas estatísticas, edição, seleção e ação Jogar no rodapé, com adaptação para janelas menores.
- Cor `#fcfcfc`, fundo geral transparente e reservas nativas de login/perfil/controles preservados.

## 2026-11-04 · Cor da superfície de login

- Cartões, caixa dos seletores e rodapé usam `#fcfcfc`, amostrado do anexo do usuário. Superfícies opacas preservam a cor sobre a arte; conta selecionada usa a mesma cor com borda vermelha. Fundo geral continua transparente.

## 2026-11-04 · Caixa dos seletores

- Seleção de League/VALORANT e Solo/Duo/Flex recebe caixa clara com borda e cantos no estilo das contas, melhorando a leitura sobre a arte. Fundo geral e limites da sobreposição mantidos.

## 2026-11-04 · Painel sem fundo geral e sem textos introdutórios

- Removidos título, subtítulo e aviso geral de estatísticas. Botões do cabeçalho preservados à direita.
- Fundo geral totalmente transparente, mantendo cartões, rodapé, alinhamento da janela e áreas nativas livres.

## 2026-11-04 · Transparência e espaço dos controles nativos

- Fundo do painel translúcido para revelar a arte original, com cartões claros legíveis. Painel elevado para uma margem superior de 24 DIP e rodapé recuado 24 DIP da borda inferior.
- Preservada toda a faixa vertical direita de perfil, minimizar e fechar, além da coluna de login à esquerda. Sem recortes individuais nem reprodução dos controles nativos.
- Geometria e transparência cobertas pelos testes existentes; conferência isolada de layout usa dados fictícios. A interação dos menus nativos sobre a janela real continua pendente de validação ao vivo.

## 2026-11-03 · Validação do painel branco

- Conferidos seleção, lançamento simulado, conta sem senha, cancelamento e confirmação de remoção, configurações e larguras reduzidas com dados fictícios. Nenhum login real executado.
- Os 328 testes passaram em sequência. A execução simultânea apresentou falhas intermitentes na abertura da interface legada e no teste de prazo do monitor de janelas; a validação sequencial não resolve essa instabilidade dos testes.
- A conferência visual da sobreposição e dos menus nativos no Riot permanece pendente.

## 2026-11-02 · Painel branco no cliente oficial

- Aplicada a direção visual clara aprovada: cartões brancos, textos escuros, seleção vermelha e botão único Jogar no rodapé. League e VALORANT são as opções visíveis; TFT permanece apenas no suporte legado.
- Cadastro, edição, remoção, atualização, chaves de API, progresso e cancelamento permanecem integrados. Aviso de estatísticas agrupado, seleção acessível por teclado e ação desabilitada para conta sem senha.
- Removidos os recortes de janela: uma faixa contínua da arte e dos controles nativos fica acima do painel, com transição para o branco. Mantida a regra de ocultar após login manual ou gerenciado.
- Suíte completa e conferência isolada com dados fictícios; nenhuma autenticação real. Alinhamento e menus sobre o Riot em execução ainda dependem de validação visual ao vivo.

## 2026-11-02 · Contas somente na tela de login

- O painel acompanha o estado local de autenticação: desaparece após login por conta salva, entrada manual ou sessão lembrada; volta ao retornar ao login. Ocultar a interface mantém a operação de lançamento em andamento.
- Consultas somente de leitura a cada 750 ms, sem sobreposição, com cancelamento e descarte de respostas de janelas antigas. Estados desconhecidos, desafios e falhas deixam a interface nativa livre.
- Testes simulam login manual e gerenciado, logout, MFA, indisponibilidade, consulta lenta, troca de janela e encerramento. Validação visual ao vivo não realizada nesta revisão; a pendência de exibição da revisão anterior permanece.

## 2026-10-28 · Contorno individual dos controles do Riot

- Removido o recorte quadrado do canto superior: perfil, minimizar e fechar recebem recortes circulares separados; o fundo das contas preenche os intervalos.
- Mantidos os controles nativos e o clique direto no Riot. O contorno respeita os limites da janela e as coordenadas em DIP.
- 326 testes: 325 passaram e um teste legado foi pulado com Riot aberto. Novas verificações cobrem os intervalos preenchidos, círculos e dimensões pequenas.

## 2026-10-28 · Área inteira da arte coberta

- A tela de contas ocupa toda a área direita a partir da divisão medida 400/1536, sem margens e com fundo sólido. A coluna de login permanece livre.
- Recorte nativo no canto superior direito preserva minimizar, fechar e perfil, incluindo entrada de mouse. Barra de ações reserva a mesma área.
- 325 testes: 324 passaram e um legado foi pulado com Riot aberto. Cobertura de geometria, recorte dos três controles e renderização opaca no Electron.

## 2026-10-28 · Cartões de contas sobre a arte

- Substituída a interface completa do modo sobreposto por [[cards]]: nome, nível, rank, winrate, vitórias, derrotas e Entrar e jogar. Superfícies escuras translúcidas, bordas douradas e ações em azul seguem a aparência do cliente.
- Janela e view transparentes ocupam somente os 70% direitos, com margens para preservar login e controles nativos. Cartões aparecem automaticamente e rolam dentro da arte; não há mais botão para abrir um dashboard.
- Cadastro, edição e configurações essenciais ficam em diálogos compactos. Preload e serviço de credenciais são reaproveitados; dados ausentes exibem traço.
- Decisão [[ADR-011 Cartões sobre a arte do Riot]]. Validação: 324 testes, 323 passaram e um legado foi pulado com Riot aberto; inclui Electron real com dados fictícios e geometria da área preservada.
- Validação visual na máquina: cinco cartões carregados sobre a arte do cliente oficial, preservando a coluna nativa de login. Dados já salvos apareceram nos cartões e a área direita permite rolar a lista. O gerenciador foi recarregado com a interface nova sem autenticar nem abrir jogo.

## 2026-10-28 · Janela auxiliar da bandeja oculta

- Ocultada a `TrayIconClass` que ficou aberta no desktop. A recuperação agora a mantém oculta mesmo com snapshot visível antigo e nunca a seleciona como janela principal. Somente janelas raiz da interface Riot com dimensões apropriadas podem ser ativadas; serviços e jogos são excluídos dessa seleção.
- Self-test do guard cobre o filtro de ativação com janela realista, serviço de bandeja, auxiliar, jogo e janela filha.

## 2026-10-28 · Sobreposição e login visível

- [[riotOverlay]] e [[riotWindowObserver]] acompanham o cliente oficial com botão Contas, foco, escala e painel completo isolado. O padrão inicia somente o serviço na bandeja; o usuário abre o Riot normalmente. O modo anterior permanece por `npm run start:private`. Decisão: [[ADR-009 Sobreposição no cliente oficial]].
- A pedido do usuário, o login sobreposto mantém o Riot visível com indicador de carregamento e Cancelar. Reutiliza o backend e faz logout local para trocar a conta, sem fechar a interface para restaurar YAML. A identidade é confirmada antes de pedir o jogo. Decisão: [[ADR-010 Login visível com progresso]].
- Quando a janela do jogo está pronta, solicita fechamento somente das janelas da interface Riot. Falha, cancelamento e verificação mantêm o cliente acessível. O painel de progresso deixa a tela nativa livre.
- 324 testes: 323 passaram e um teste legado foi pulado porque o Riot estava aberto. A captura real confirmou o botão sobre o cliente oficial; o usuário relatou que não o via. A detecção de foco passou a considerar processos da interface oficial e do mesmo executável do gerenciador. O Riot foi aberto sem autenticar durante a validação final. A interação completa com a sobreposição e o novo lançamento visível ainda requerem confirmação em uso.

## 2026-10-28 · Sobreposição e login visível

- [[riotOverlay]] e [[riotWindowObserver]] acompanham o cliente oficial com botão Contas, foco, escala e painel completo isolado. O padrão inicia somente o serviço na bandeja; o usuário abre o Riot normalmente. O modo anterior permanece por `npm run start:private`. Decisão: [[ADR-009 Sobreposição no cliente oficial]].
- A pedido do usuário, o login sobreposto mantém o Riot visível com indicador de carregamento e Cancelar. Reutiliza o backend e faz logout local para trocar a conta, sem fechar a interface para restaurar YAML. A identidade é confirmada antes de pedir o jogo. Decisão: [[ADR-010 Login visível com progresso]].
- Quando a janela do jogo está pronta, solicita fechamento somente das janelas da interface Riot. Falha, cancelamento e verificação mantêm o cliente acessível. O painel de progresso deixa a tela nativa livre.
- 323 testes: 322 passaram e um teste legado foi pulado porque o Riot estava aberto. A captura real confirmou o botão sobre o cliente oficial; o usuário relatou que não o via. A detecção de foco passou a considerar também processos de interface do mesmo caminho oficial. Essa correção e o novo fluxo visível ainda requerem confirmação completa em uso.

## 2026-10-28 · Verificação recuperável e lançamento real confirmado

- **Diagnóstico ao vivo autorizado:** a Riot aguardava MFA enquanto a janela estava oculta; a recuperação também falhava ao restaurar estilos. Na repetição, o monitor falhou após enviar credenciais e antes de consultar o desafio.
- **Correção:** [[signInFlow]] revela uma vez a interface nativa para verificação e preserva sua recuperação no timeout. O bloco de erro consulta o estado sanitizado se o monitor falhar durante autenticação nativa. Cancelamento oculta novamente; erro posterior de abertura do jogo não vira desafio de login.
- **Estado e recuperação:** [[signInService]] mantém flags explícitas de atenção em falha, ignora progresso tardio e libera o mutex. [[main]] recupera a interface original inclusive após timeout; consulta [[riotClient]] para permitir voltar às contas depois da verificação.
- **Janelas:** [[windowGuard.ps1]] restaura somente os bits que controla, preservando alterações do cliente. A espera pelo worker continua processando mensagens, com prazo limitado. Diagnóstico opcional informa metadados de estilo, sem conteúdo ou credenciais. Complemento registrado na [[ADR-008 Recuperação visual sem reexibir o Riot]].
- **Validação:** suíte completa com 313 testes: 312 passaram e 1 foi pulado com Riot aberto. Teste real de 28/10 às 18:03–18:04 (São Paulo) concluiu autenticação, verificou identidade, abriu LeagueClientUx e salvou sessão; operação terminou `succeeded` às 18:04:55.
- **Limitação confirmada:** ainda ocorreram recuperações por `window-style-timeout` e `window-style-denied` durante a tentativa bem-sucedida. Não há comprovação de ausência absoluta de reaparecimento; a abertura do jogo e a recuperação de MFA foram confirmadas.

## 2026-10-27 · Recuperação sem reaparecimento intermediário do Riot

- **Problema observado:** após Entrar e jogar, o cliente reaparecia rapidamente antes de o jogo abrir. Os registros confirmam quedas do monitor por `window-style-denied` e `window-style-timeout`; o encerramento anterior podia restaurar a visibilidade durante sua substituição.
- **Correção:** [[windowGuard.ps1]] verifica somente os bits de estilo que controla ao ocultar e entrega snapshots sem restaurar em falha/`handoff` com dono vivo. O substituto recebe `initialMode` e já arma a ocultação antes de `ready`.
- **Recuperação preservada:** [[windowController]] mantém o encerramento definitivo idempotente, aguarda tarefas em curso e restaura snapshots retidos com helper sem ativação. Recuperação manual continua trazendo a interface para frente; jogos e Vanguard continuam fora do filtro.
- **Decisão:** [[ADR-008 Recuperação visual sem reexibir o Riot]], registrada antes do código. Autenticação, CAPTCHA/2FA e verificação de conta não mudam.
- **Validação:** `npm test`: 297 passaram, 1 teste do instalador legado foi pulado porque o Riot estava aberto. Testes de protocolo e concorrência usam processos falsos; self-test do C# não toca no desktop. Não foi executado login real para confirmar a ausência completa da piscada.

## 2026-10-27 · Todas as contas dentro da janela Riot

- **Pedido:** retirar a janela independente Riot Account Manager e reunir cadastro, edição, exclusão, elos, filtros, cópia, configurações e progresso na própria interface Riot.
- **Arquitetura:** [[main]] passa a executar serviços e bandeja, sem criar `BrowserWindow`. [[managerHost]] hospeda o [[renderer]] em um `WebContentsView` filho da janela Riot, com preload isolado ([[manager-preload]]), validação de remetente/frame/URL e recusa de navegação/permissões. Decisão registrada antes do código em [[ADR-007 Interface completa dentro do Riot Client]].
- **Interface:** acesso **Contas** permanece também na página conectada, sem exigir sair da sessão. O seletor rápido continua no login. **Voltar ao Riot** e `Escape` sem modal fecham apenas a visualização; campos sensíveis recém-digitados são limpos.
- **Serviço:** [[managerService]] centraliza validação dos comandos e disponibiliza uma fila limitada de eventos públicos. Senhas/chaves persistidas não voltam ao renderer; copiar senha continua sendo uma escrita do main no clipboard, com limpeza temporizada.
- **Abertura:** `npm start` usa a interface integrada por padrão. O preload e o atalho da janela independente foram removidos; `start:riot-login` continua como alias.
- **Cópia atualizada:** o preparador usa `private-v1/embedded-v1/` e declara `fullManagerInClient`; a cópia anterior permanece no lugar. O controlador dá prioridade ao novo destino e recusa addons antigos.
- **Agendamento:** atualização de elos é reagendada mesmo após falha; conta removida durante atualização não produz evento nulo.
- **Preservado:** dados/sessões existentes e as alterações locais do usuário em [[signInFlow]], [[windowController]] e seus documentos/testes. A migração não modifica a instalação original Riot.
- **Validação:** 293 testes cobrem comandos, transporte, view/preload, navegação e interface completa renderizada no Electron com conta fictícia. A cópia privada 142.0.0 foi preparada e validada por hash, com a instalação original intacta. O fluxo de login com uma conta real e a abertura de jogo não foram executados.

## 2026-10-26 · Monitor de janelas que se recupera

- **Problema:** depois do preenchimento nativo, o monitor de janelas ([[windowGuard.ps1]]) caía, e a primeira checagem do [[signInFlow]] abortava o login. A senha já tinha sido digitada, e o jogo nunca era pedido. Três falhas reais no `sign-in.log` (11:33, 18:40 e 23:00); o motivo da queda não era registrado em lugar nenhum.
- **Correção:** o [[windowController]] reergue um monitor perdido no mesmo modo (até 3 vezes por minuto), repete uma vez os comandos interrompidos, usa helper avulso no `gameWindow` quando o monitor está morto e só deixa `assertHealthy` falhar quando não consegue recuperar.
- **Diagnóstico:** cada queda vira um código fixo (`window-style-timeout`, `no-response`, `exit-1`…), gravado no `sign-in.log` e incluído na mensagem final de erro. Texto livre do .NET vira `unknown`.
- 8 testes novos ou reescritos; 246 passando (1 pulado por exigir o Riot fechado). **Ainda não validado com o Riot real.**
- Segurança da recuperação conferida no código: o monitor novo herda o estado original das janelas salvo pelo anterior.

## 2026-10-26 · "The Riot Client window did not open"

- **Causa:** quando a Riot exige CAPTCHA antes da senha, o login cai no formulário nativo escondido. Para abrir a interface, o código chamava `RiotClientServices.exe` de novo, mas os serviços já rodavam em `--headless`, e a chamada não abria janela. O [[login.ps1]] esperava 60 s e falhava. Acontecia em toda troca de conta sem sessão salva válida, inclusive pelo painel MINHAS CONTAS.
- **Correção:** novo módulo [[riotInterface]]. Ele pede a interface aos serviços (`POST /riot-client-lifecycle/v1/show`) e, se ela não aparecer em 10 s, reinicia os serviços com interface (oculta pelo monitor). É seguro porque nenhuma senha foi enviada nesse ponto.
- O caminho usado vai para o `sign-in.log`. 7 testes novos; 240 passando (1 pulado por exigir o Riot fechado).
- Diagnóstico registrado em [[Solução de problemas]], incluindo a cópia virtualizada do `sign-in.log` vista por apps empacotados.
- **Validação real (23:00):** o `show` abriu a interface em 0,8 s e as credenciais foram preenchidas. O erro "window did not open" não se repetiu. O login parou em seguida por outro motivo, o monitor de janelas encerrado ("The background window guard stopped"), e o jogo não abriu. Ver [[Backlog]].

## 2026-10-26 · Segurança do login

- **Sem segundo envio de senha.** Uma resposta 404/405/501 ao `complete` (senha já enviada) agora é erro, em vez de `{ supported: false }`, que levava o [[signInFlow]] a digitar a senha de novo no formulário nativo ([[riotAuthentication]]).
- **Sessão do jogador falha fechada.** `sessionState` troca a lista de bloqueios por uma lista de estados permitidos (`NON_BLOCKING_SESSION_STATES`). Estados desconhecidos e 19 estados de bloqueio que o projeto não conhecia (restrições de idade e de jogo, e-mail dos pais, 2FA negado, escolhas de conta e plataforma…) agora exigem intervenção em vez de liberar o jogo. Lista tirada da enumeração `PlayerSessionStateType` do Riot 142.
- 4 testes novos; 234 passando.

## 2026-10-26 · Reorganização profissional

- Código movido para `src/{main,core,riot,platform/windows,integration,renderer}`, scripts para `scripts/{dev,integration,legacy}`, testes espelhando `src/` ([[ADR-006 Estrutura de pastas por camada]], [[Estrutura de pastas]]).
- `src/paths.js` centraliza todos os caminhos do projeto ([[paths]]).
- `src/riotApi.js` renomeado para `src/core/rankApi.js`; `scripts/run-private-riot-host.js` virou `src/integration/host/hostEntry.js`.
- Comentários removidos de JS, CSS, HTML, PowerShell e C# embutido; o conhecimento foi para as notas dos módulos ([[ADR-005 Código sem comentários e conhecimento no vault]]).
- Documentação transformada neste vault do Obsidian; `ANALISE.md`, `INTEGRACAO-RIOT.md`, `COMPARACAO-ROSE.md` e `GUIA-GITHUB.md` viraram notas.
- `CLAUDE.md` e agentes do projeto em `.claude/agents/` ([[Trabalhando com agentes]]).
- `package.json`: `main` aponta para `src/main/index.js`; novo `start:riot-login`; `integration:prepare` virou `legacy:prepare-install`; `engines.node >= 22`.
- `.gitattributes` e `.editorconfig` para finais de linha e formatação consistentes.
- 230 testes passando antes e depois.

## Antes da reorganização

Melhorias já implementadas, registradas na antiga `ANALISE.md`:

- **Monitor persistente** de janelas no lugar do de três minutos ([[ADR-004 Monitor persistente de janelas]]).
- **Abertura em etapas:** monitor pronto antes do cliente; jogo só depois do Riot ID; sucesso exige janela visível.
- **Abertura direta:** conta atual reaproveitada sem reinício; trocas com `--headless`.
- **Intervenção controlada:** 2FA, CAPTCHA e atualizações informados no painel, sem abrir o cliente sozinho.
- **Cancelamento e recuperação** com liberação do botão Play mesmo em falha; restauração das janelas ao fechar.
- **Sessões corretas:** tokens da conta anterior salvos antes de carregar a escolhida; identidade desconhecida não é associada.
- **Armazenamento:** caminhos de sessão validados, gravação atômica, backups de edições sem churn de elo.
- **Falhas de execução** do Riot Client e dos auxiliares tratadas; comandos do monitor serializados.
- **Contexto de login:** limpar e inicializar antes de enviar a senha; CAPTCHA pré-submissão na interface escondida.
- **Painel MINHAS CONTAS** na tela de login real 141/142 ([[Integração com o Riot Client]]).
- **Serviço compartilhado** de login para a janela e o painel ([[signInService]]).
