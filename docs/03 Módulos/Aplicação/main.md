---
tipo: módulo
arquivo: src/main/index.js
camada: aplicação
testes: test/main/mainStartup.test.js
tags: [módulo]
---

# main

> Processo de serviços em segundo plano: mantém os dados e as operações e mostra os cartões de contas sobre a janela oficial da Riot.

## Responsabilidade

- Garante uma única instância do aplicativo.
- Cria [[store]], [[signInService]], [[managerService]], a bandeja, o [[sessionKeeper]], o [[riotWakeup]] e a [[riotOverlay]].
- Agenda a atualização de elos usando [[rankApi]] e publica seus eventos.
- Abre a Riot oficial e pede os cartões pela bandeja ou por uma segunda instância.
- No app instalado, mostra na bandeja a opção "Iniciar com o Windows" ([[startWithWindows]]).

## API pública

É o ponto de entrada Electron definido no `package.json`; não exporta API de consumo. Os comandos dos cartões passam pelo [[managerService]].

As entradas do usuário são os atalhos do Eclipse instalado, o início com o Windows (se ligado), `npm start`, uma segunda instância e o menu da bandeja. Desde 2026-11-07 não há opções de linha de comando: `--private-client` e `--riot-login` saíram ([[ADR-028 Modo antigo removido]]).

## Dependências

- Usa: [[paths]], [[store]], [[rankApi]], [[riotClient]], [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[managerService]], [[riotOverlay]], [[startWithWindows]], [[language]] e as APIs de bandeja e diálogo do Electron.
- Usado por: Electron.
- Os cartões são criados pela [[riotOverlay]] com [[managerHost]], [[manager-preload]] e [[cards]].

## Invariantes e decisões

- **Iniciar com o Windows só no app instalado.** Desde 2026-11-08 ([[ADR-030 Eclipse instalado por um Setup próprio]]), o main cria o [[startWithWindows]] com `process.execPath` e o nome `Eclipse`. No app instalado, a bandeja ganha a opção marcável "Iniciar com o Windows" entre "Cancelar login" e "Sair", desmarcada até o usuário ligar. O estado é lido a cada vez que o menu é montado; um clique liga ou desliga e remonta o menu. Rodando do projeto, a opção não aparece e a chave `Run` não é lida nem gravada. Iniciado pelo Windows, o main faz o mesmo que pelo atalho: fica na bandeja sem abrir a Riot.
- **Nome do pacote intocado também no Setup.** O `name` continua `riot-account-manager` e o nome "Eclipse" do executável e dos atalhos vem só de `build.productName`. O `test/package.test.js` falha se aparecer um `productName` no topo do `package.json`.

- **Um modo só.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), o main não tem mais o modo `--private-client`, a ponte HTTP, a cópia privada nem o [[windowsDpapi]]. Tudo o que antes valia "só no modo sobreposto" vale sempre. O código antigo está na tag `modo-antigo-final`.
- **Nome visível "Eclipse".** Desde 2026-11-04, a pedido do usuário, a constante `APP_NAME` dá nome à dica da bandeja e aos títulos dos avisos, diálogos de erro e balões. A bandeja usa `APP_TRAY_ICON` ([[paths]]); só se ele não carregar, volta ao ícone do executável e depois a `APP_ICON`. O `name` do `package.json` continua `riot-account-manager` de propósito: o Electron deriva dele a pasta de dados (`%APPDATA%\riot-account-manager\`), e trocá-lo (ou definir `productName`/`app.setName`) faria o app abrir sem as contas salvas.
- **Chromium sem detecção de oclusão.** Desde 2026-11-04, antes de o app ficar pronto, o main chama `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`. Motivo: com a Riot minimizada, abrir o gerenciador e restaurar a Riot mostrava os cartões ainda cobertos pela Riot. O Chromium marcava a página como oculta e não voltava a desenhá-la quando o [[riotWindowObserver]] trazia a janela para a frente: o Windows dizia cartões visíveis e na frente, mas a tela mostrava a arte da Riot no lugar deles, até minimizar e restaurar. Conferido com uma Riot falsa em outro processo: coberta e depois trazida para a frente, a página ficou `hidden` por mais de 3 s com a detecção ligada e `visible` com ela desligada. Custo: o gerenciador continua desenhando os cartões quando outro programa os cobre, o que é pouco para uma única janela.
- **Chromium sem animação de janela.** Desde 2026-11-04 ([[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]), o main também chama `app.commandLine.appendSwitch('wm-window-animations-disabled')` antes de o app ficar pronto. Sem isso, a janela transparente dos cartões surgia aos poucos, em cerca de 200 ms, a cada `show`, e a arte da Riot aparecia ao restaurar a Riot minimizada.
- **Painel somente no login.** Injeta a leitura sanitizada e cancelável `riotClient.readLoginScreenState(signal)` em [[riotOverlay]]. A visibilidade acompanha também entradas manuais e sessões lembradas pela Riot, sem depender dos eventos de login do gerenciador.
- **Progresso visível.** O login é sempre visível; desde 2026-11-07 o [[signInService]] não recebe mais `visibleLogin` nem `releaseAfterLaunch` ([[ADR-028 Modo antigo removido]]). A operação vai ao painel de carregamento: `setBlocked` impede outra seleção durante a tentativa e `setOperation` mantém o indicador visível sobre a Riot.
- **Janela da Riot na volta do segundo plano.** Desde 2026-11-06 ([[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]), o main cria o [[riotWakeup]] logo depois do guardião, com o `riotClient` real, `busy: () => launchService.isBusy()` e o `sign-in.log`. Ao sair, ele para junto com o guardião.
- **Guardião da sessão.** Desde 2026-11-06 ([[ADR-019 Sessão salva por conta no modo cartões]]), o main cria o [[sessionKeeper]] antes da sobreposição, com o `riotClient` real, o [[store]], `busy: () => launchService.isBusy()` e o `sign-in.log`. Uma sessão guardada publica `account-updated`. Toda operação que deixa de estar `running` pede uma conferência, para pegar um arquivo da Riot deixado por um login que falhou. Ao sair, o guardião para logo depois do cancelamento.
- **Sessão de quem sai vai para a dona provada.** Desde 2026-11-06 ([[ADR-020 Riot conectada é encerrada quando fica sem jogo]]), `saveLeavingSession` (o `onClosed` dos logins) chama primeiro `sessionKeeper.keep(yaml)`. Se o guardião prova a dona pelo `sub` ou por um Riot ID único, a sessão vai para ela e o log registra "updated the session of the account that was signed in". Sem dona provada vale a regra antiga: a última conta usada, se o Riot ID ativo bater com ela; identidade não confirmada não é associada ao store.
- **Início sem abrir a Riot.** O main cria a sobreposição e chama `overlay.start(clientPath)` sem abrir a Riot. Sem o Riot Client instalado, o início para com um erro e o app sai. Comandos da view chegam ao [[managerService]] depois da validação IPC do [[managerHost]] ([[ADR-009 Sobreposição no cliente oficial]]).
- **Sem `BrowserWindow` própria.** O main não cria janela de gerenciamento. Os cartões vivem na janela da sobreposição, presa à Riot.
- **Uma instância, um armazenamento e um login.** Pedidos repetidos reutilizam o serviço e não criam outro dono das credenciais. Uma segunda instância antes do fim do início é ignorada; depois, abre a Riot e os cartões.
- **Abertura serializada.** Pedidos concorrentes de abrir a Riot compartilham a mesma abertura (`riotOpening`).
- **Elos pedidos no meio de um refresh esperam a vez.** Desde 2026-11-07, `refreshAll(ids)` com um refresh já rodando não devolve mais o refresh em curso. Os `ids` entram numa única passada extra, que roda logo depois e soma tudo o que foi pedido no meio; um pedido de todas as contas transforma essa passada em completa. Antes, uma conta recém-salva durante o refresh agendado só ganhava elo no ciclo seguinte. Um pedido de todas as contas com um refresh completo rodando ainda compartilha o que está em curso. A passada extra roda mesmo se a anterior falhar. O refresh é feito por `runRefresh`; `refreshAll` só decide se começa agora ou entra na fila.
- **Login em andamento bloqueia a abertura.** Com uma operação `running` sem pedido de atenção, abrir a Riot falha com "The game is opening. Wait or cancel from the tray.". Com pedido de atenção (2FA, CAPTCHA), a bandeja abre a Riot para o usuário resolver, sem pedir os cartões por cima.
- **Login fora da interface.** Esconder os cartões não cancela a operação. O serviço de login publica o estado na fila de eventos.
- **Eventos públicos, não IPC amplo.** Conta alterada, progresso de elos, próximo refresh e progresso/operação de login entram na fila limitada do [[managerService]].
- **Falha visível.** Uma falha ao abrir a Riot pela bandeja vira um diálogo com o motivo traduzido e a sugestão de tentar de novo pela bandeja. Até 2026-11-07 o texto falava da cópia privada; foi trocado com a [[ADR-028 Modo antigo removido]].
- **Segredos continuam no serviço.** Descriptografia e consultas de elo permanecem no main, nunca na view.
- **Saída ordenada.** Cancela a operação, para o guardião e o wakeup, depois a sobreposição e o `riotClient`, e só então destrói a bandeja e sai.
- **Fechar o Riot pela cópia do X.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): o main passa ao [[riotOverlay]] `closeClient: () => riotClient.closeClient()`. Falhas não viram balão nem diálogo; a sobreposição fecha só a janela.
- **Bandeja e avisos no idioma salvo.** Revisão de 2026-11-04 ([[ADR-014 Interface em português e inglês]]): o menu da bandeja, os títulos dos balões e a caixa de erro vêm de `mainText` do [[language]], e as mensagens que aparecem neles passam por `localize`. Os erros lançados aqui são escritos em inglês, como os do login; o `sign-in.log` fica em inglês. Ao salvar as configurações, `settingsChanged` refaz o menu da bandeja e chama `overlay.setLanguage`; o idioma também é passado à sobreposição antes de `start`.

## Testes

`test/main/mainStartup.test.js` executa o ponto de entrada num `vm` com dependências falsas. Confere o início sem abrir a Riot, a opção "Iniciar com o Windows" (só no app instalado, desligada até o clique, ligando e desligando com o nome `Eclipse`, nos dois idiomas, e ausente rodando do projeto), as opções do [[signInService]] e do [[managerService]], os switches do Chromium, a ordem de criação e parada do [[sessionKeeper]], do [[riotWakeup]] e da sobreposição, a bandeja (abrir a Riot, pedir os cartões, bloquear durante um login, não cobrir um pedido de atenção), a segunda instância antes e depois do início, a abertura serializada, os pedidos de elo feitos durante um refresh (uma passada extra somando os pedidos, completo compartilhado, completo pedido no meio de um parcial, passada extra depois de uma falha), a falta do Riot Client, os diálogos no idioma salvo e a saída ordenada.

Nenhum desses testes autentica contas reais ou abre jogos.

## Pontos de atenção

- Um `require` novo precisa entrar no mapa `deps` do harness de inicialização.
- Ver [[Integração com o Riot Client]], [[Segurança e privacidade]] e [[Backlog]].
