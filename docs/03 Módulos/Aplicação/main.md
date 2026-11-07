---
tipo: módulo
arquivo: src/main/index.js
camada: aplicação
testes: test/main/mainStartup.test.js
tags: [módulo]
---

# main

> Processo de serviços em segundo plano: mantém os dados e operações e abre a interface completa dentro da janela Riot.

## Responsabilidade

- Garante uma única instância do aplicativo.
- Cria [[store]], [[signInService]], [[managerService]], bandeja, [[bridgeServer]] e [[privateClient]].
- Agenda a atualização de elos usando [[rankApi]] e publica seus eventos.
- Encaminha a abertura de contas para a visualização integrada, sem criar uma janela independente.
- Mantém a recuperação de desafios na interface que possui o contexto nativo.

## API pública

É o ponto de entrada Electron definido no `package.json`; não exporta API de consumo. Os comandos da interface completa passam por [[managerService]], em vez dos antigos handlers IPC da janela do gerenciador.

As entradas do usuário são o atalho integrado, `npm start`, uma segunda instância e o menu de bandeja. A flag `--riot-login` continua reconhecida por compatibilidade; a interface integrada é o comportamento padrão.

## Dependências

- Usa: [[paths]], [[store]], [[rankApi]], [[riotClient]], [[signInService]], [[managerService]], [[bridgeServer]], [[privateClient]], [[windowsDpapi]] e APIs de bandeja/diálogo do Electron.
- Usado por: Electron.
- A visualização é criada por [[managerHost]] no processo do host privado, com [[manager-preload]] e [[renderer]].

## Invariantes e decisões

- **Nome visível "Eclipse".** Desde 2026-11-04, a pedido do usuário, a constante `APP_NAME` dá nome à dica da bandeja e aos títulos dos avisos, diálogos de erro e balões. A bandeja usa `APP_TRAY_ICON` ([[paths]]); só se ele não carregar, volta ao ícone do executável e depois a `APP_ICON`. O `name` do `package.json` continua `riot-account-manager` de propósito: o Electron deriva dele a pasta de dados (`%APPDATA%\riot-account-manager\`), e trocá-lo (ou definir `productName`/`app.setName`) faria o app abrir sem as contas salvas. Os textos e símbolos internos do modo privado (`riot-account-manager.*`, "Open Riot Account Manager to connect") também ficam, porque são conferidos dentro da cópia privada da Riot.
- **Chromium sem detecção de oclusão no modo sobreposto.** Desde 2026-11-04, antes de o app ficar pronto, o modo sobreposto chama `app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion')`. O modo privado não muda. Motivo: com a Riot minimizada, abrir o gerenciador e restaurar a Riot mostrava os cartões ainda cobertos pela Riot. O Chromium marcava a página como oculta e não voltava a desenhá-la quando o [[riotWindowObserver]] trazia a janela para a frente: o Windows dizia cartões visíveis e na frente, mas a tela mostrava a arte da Riot no lugar deles, até minimizar e restaurar. Conferido com uma Riot falsa em outro processo: coberta e depois trazida para a frente, a página ficou `hidden` por mais de 3 s com a detecção ligada e `visible` com ela desligada. Custo: o gerenciador continua desenhando os cartões quando outro programa os cobre, o que é pouco para uma única janela.
- **Chromium sem animação de janela no modo sobreposto.** Desde 2026-11-04 ([[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]), o modo sobreposto também chama `app.commandLine.appendSwitch('wm-window-animations-disabled')` antes de o app ficar pronto. Sem isso, a janela transparente dos cartões surgia aos poucos, em cerca de 200 ms, a cada `show`, e a arte da Riot aparecia ao restaurar a Riot minimizada. O modo privado continua com os padrões do Chromium.
- **Painel somente no login.** Injeta a leitura sanitizada e cancelável `riotClient.readLoginScreenState(signal)` em [[riotOverlay]]. A visibilidade acompanha também entradas manuais e sessões lembradas pela Riot, sem depender dos eventos de login do gerenciador.
- **Progresso visível.** No modo sobreposto ativa `visibleLogin` e encaminha a operação ao painel de carregamento. `setBlocked` impede outra seleção durante a tentativa; `setOperation` mantém o indicador visível sobre a Riot. O modo privado conserva a ocultação anterior.
- **Janela da Riot na volta do segundo plano, só no modo cartões.** Desde 2026-11-06 ([[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]), o modo sobreposto cria o [[riotWakeup]] logo depois do guardião, com o `riotClient` real, `busy: () => launchService.isBusy()` e o `sign-in.log`. Ao sair, ele para junto com o guardião.
- **Guardião da sessão só no modo cartões.** Desde 2026-11-06 ([[ADR-019 Sessão salva por conta no modo cartões]]), o modo sobreposto cria o [[sessionKeeper]] antes da sobreposição, com o `riotClient` real, o [[store]], `busy: () => launchService.isBusy()` e o `sign-in.log`. Uma sessão guardada publica `account-updated`. Toda operação que deixa de estar `running` pede uma conferência, para pegar um arquivo da Riot deixado por um login que falhou. Ao sair, o guardião para logo depois do cancelamento. O modo privado não cria o guardião: lá cada Jogar já reinicia a Riot e limpa o login lembrado.
- **Sessão de quem sai vai para a dona provada.** Desde 2026-11-06 ([[ADR-020 Riot conectada é encerrada quando fica sem jogo]]), `saveLeavingSession` (o `onClosed` dos logins) chama primeiro `sessionKeeper.keep(yaml)`. Se o guardião prova a dona pelo `sub` ou por um Riot ID único, a sessão vai para ela e o log registra "updated the session of the account that was signed in". Só sem guardião (modo privado) ou sem dona provada vale a regra antiga: a última conta usada, se o Riot ID ativo bater com ela.

- **Padrão sobreposto desde 2026-10-28.** Inicia [[riotOverlay]] e bandeja, sem abrir o Riot, a cópia privada ou a ponte HTTP. Comandos da view chegam diretamente ao [[managerService]] após validação IPC do host. `--private-client` preserva o comportamento anterior descrito abaixo. Operação em andamento oculta a sobreposição; ações explícitas da bandeja abrem o cliente oficial. O serviço continua quando não há janela visível. [[ADR-009 Sobreposição no cliente oficial]] substitui a hospedagem padrão da ADR-007.

- **Sem `BrowserWindow` própria.** A janela independente foi removida da experiência normal; toda a interface de contas fica na própria janela Riot, conforme [[ADR-007 Interface completa dentro do Riot Client]].
- **Uma instância, um armazenamento e um login.** Pedidos repetidos reutilizam o serviço e não criam outro dono das credenciais.
- **Abertura serializada.** Pedidos concorrentes de iniciar a integração ou abrir contas compartilham a preparação em andamento.
- **Contexto de verificação preservado.** Se uma operação está `running`, pede atenção e tem `nativeClient`, a recuperação abre a interface nativa que recebeu a senha; não cria outra página que reinicializaria o CAPTCHA/MFA. A mesma recuperação vale após falha com verificação pendente. Nesse caso, consulta o estado sanitizado da Riot: `auth` ou `authenticated` sem erro permite voltar às contas; desafio, estado desconhecido ou falha de consulta conserva a interface original.
- **Login fora da interface.** Ocultar ou fechar a visualização de contas não cancela a operação. O serviço de login publica estado e o host integrado é escondido durante o lançamento.
- **Eventos públicos, não IPC amplo.** Conta alterada, progresso de elos, próximo refresh e progresso/operação de login entram na fila limitada do [[managerService]].
- **Sessão anterior só com identidade.** Ao encerrar uma conta, salva os tokens atualizados apenas se o Riot ID corresponde à conta conhecida; identidade não confirmada não é associada ao store.
- **Falha visível sem ressuscitar a janela antiga.** Integração ausente, incompatível ou indisponível é informada por diálogo; a janela independente não é recriada como substituta silenciosa.
- **Segredos continuam no serviço.** Descriptografia, clipboard e consultas de elo permanecem no main, não no renderer Riot.
- **Bandeja é a recuperação.** Abrir contas pela bandeja abre a visualização filha do Riot; recuperar cliente, cancelar e sair seguem disponíveis.
- **Saída ordenada.** Cancela a operação e para host privado, monitor Windows e ponte antes de encerrar.
- **Alterações do usuário preservadas.** A migração da interface não substitui as correções locais de [[signInFlow]] e [[windowController]].
- **Fechar o Riot pela cópia do X.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): o main passa ao [[riotOverlay]] `closeClient: () => riotClient.closeClient()`. Falhas não viram balão nem diálogo; a sobreposição fecha só a janela.
- **Bandeja e avisos no idioma salvo.** Revisão de 2026-11-04 ([[ADR-014 Interface em português e inglês]]): o menu da bandeja, os títulos dos balões e a caixa de erro vêm de `mainText` do [[language]], e as mensagens que aparecem neles passam por `localize`. Os erros lançados aqui passaram a ser escritos em inglês, como os do login; o `sign-in.log` fica em inglês. Ao salvar as configurações, `settingsChanged` refaz o menu da bandeja e chama `overlay.setLanguage`; o idioma também é passado à sobreposição antes de `start`.

## Testes

`test/main/mainStartup.test.js` executa o ponto de entrada num `vm` com dependências falsas. Confere a abertura integrada sem janela independente, pedidos concorrentes/segunda instância, falhas recuperáveis e a recuperação do desafio nativo. Validação de formulários e ações está em [[managerService]]; a hospedagem da UI está em [[managerHost]]. Também confere que só o modo sobreposto desliga a detecção de oclusão do Chromium e cria o [[sessionKeeper]], que ele confere de novo quando uma operação termina e que para ao sair, e que a sessão de quem sai passa primeiro pelo `keep` do guardião. Confere também que só o modo sobreposto cria o [[riotWakeup]], depois do guardião e antes da sobreposição, e que ele para ao sair.

Nenhum desses testes autentica contas reais ou abre jogos.

## Pontos de atenção

- Um `require` novo precisa entrar no mapa `deps` do harness de inicialização.
- A cópia privada precisa estar preparada e compatível; a migração não autoriza alterar a instalação original Riot.
- Ver [[Integração com o Riot Client]], [[Segurança e privacidade]] e [[Backlog]].
