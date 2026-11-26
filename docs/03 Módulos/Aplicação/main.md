---
tipo: módulo
arquivo: src-tauri/src/main.rs
camada: aplicação
testes: src-tauri/tests/paths.rs
tags: [módulo]
---

# main

> Ponto de entrada do Eclipse em Tauri: monta os serviços em segundo plano, a bandeja e a janela dos cartões sobre a Riot.

## Responsabilidade

- Garante uma única instância do aplicativo (`tauri-plugin-single-instance`) e sai com um aviso se o Eclipse antigo, em Electron, estiver aberto ([[electronInstance]]).
- Cria o [[store]] (com o [[safeStorage]]), o [[signInService]], o [[refresher]], o [[managerService]] com o [[appPorts]], o [[sessionKeeper]], o [[riotWakeup]], o [[rankWatcher]] e a janela do [[riotOverlay]] com o [[riotWindowObserver]].
- Registra o protocolo `eclipse://` ([[assetProtocol]]); o endereço `riot/logo.svg` é respondido com o logo do [[riotLogo]], lido do Riot Client detectado no início e os comandos `manager` ([[managerHost]]) e `overlay_toggle` ([[overlayToggle]]).
- Monta a bandeja: Contas no Riot, Abrir Riot Client, Cancelar login, "Atualizar para a versão X" (só com uma versão nova encontrada, [[updates]]), "Iniciar com o Windows" (só no app compilado em modo release, [[startWithWindows]]), "Procurar atualizações" e Sair; duplo clique abre as contas.
- Mostra notificações do Windows ([[notices]], [[toasts]]) e caixas de aviso.

## API pública

Não exporta API. As entradas do usuário são os atalhos do Eclipse instalado, o início com o Windows (se ligado), `cargo tauri dev`, uma segunda instância e o menu da bandeja. Os comandos dos cartões passam pelo [[managerHost]] e pelo [[managerService]]. Desde 2026-11-07 não há opções de linha de comando ([[ADR-028 Modo antigo removido]]).

## Dependências

- Usa: [[paths]], [[store]], [[safeStorage]], [[language]], [[notices]], [[toasts]], [[timers]], [[rankApi]], [[refresher]], [[riotClient]], [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[rankWatcher]], [[managerService]], [[appPorts]], [[managerHost]], [[riotOverlay]], [[riotWindowObserver]], [[assetProtocol]], [[startWithWindows]], [[electronInstance]], [[updates]], [[appUpdater]] e a bandeja e o menu do Tauri.
- Usado por: o executável `eclipse.exe`.

## Invariantes e decisões

- **Pasta de dados escolhida antes de tudo.** No app compilado em modo release, os dados ficam em `%APPDATA%\riot-account-manager`. Em desenvolvimento, o Eclipse só abre com `ECLIPSE_DATA_DIR` apontando para uma pasta absoluta escolhida à mão; sem ela, mostra o aviso e sai ([[paths]]).
- **Eclipse antigo aberto, Eclipse novo sai.** Antes de tudo, o `main.rs` confere se o Eclipse em Electron está aberto com a mesma pasta de dados ([[electronInstance]]) e, se estiver, avisa e sai, para os dois nunca gravarem o `data.json` ao mesmo tempo ([[ADR-034 Troca do Electron pelo Tauri]]).
- **Uma instância.** A segunda cópia avisa a primeira e sai; a primeira abre as contas só depois de terminar de iniciar, ignorando os argumentos.
- **O estado do app entra no Tauri antes de a janela existir.** Revisão de 2026-11-14, primeiro uso na Riot real: ao reabrir o Eclipse, as contas salvas só apareciam depois de clicar em atualizar. O `main.rs` criava a janela com as três webviews e só depois chamava `app.manage`. Criar uma webview do WebView2 atende mensagens enquanto espera, então a página dos cartões, a primeira a ser criada, carregava e pedia `init` enquanto as outras duas ainda eram criadas; o comando `manager` não achava o estado, o Tauri recusava o pedido e os cartões ficavam vazios. Agora `app.manage` vem antes de `create`. `windowAction` e `overlay_toggle` só respondem depois de a sobreposição existir.
- **Início sem abrir a Riot.** O main cria a sobreposição e liga o observador sem abrir a Riot. Uma falha no início vira uma caixa de aviso, e o app sai ([[ADR-009 Sobreposição no cliente oficial]]).
- **Sem janela própria.** O main não cria janela de gerenciamento. Os cartões vivem na janela da sobreposição, presa à Riot. Fechar essa janela pelo Windows é ignorado, e o app só sai pela bandeja.
- **Um modo só.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), não há o modo `--private-client`, a ponte HTTP nem a cópia privada. O código antigo está na tag `modo-antigo-final`, e o Electron na tag `electron-final`.
- **Nome visível "Eclipse".** Desde 2026-11-04, a pedido do usuário, `APP_NAME` dá nome à dica da bandeja, às notificações e às caixas de aviso. A pasta de dados continua `riot-account-manager` de propósito, para abrir as contas que o Electron gravou ([[paths]]).
- **Painel somente no login.** O main passa ao [[riotOverlay]] a leitura sanitizada e cancelável da tela de login do [[riotClient]]. A visibilidade acompanha também entradas manuais e sessões lembradas pela Riot, sem depender dos eventos de login do Eclipse.
- **Progresso visível.** O login é sempre visível. Cada operação publicada vai à fila de eventos dos [[cards]] e ao `set_operation` do [[riotOverlay]], que cobre a coluna de login. Uma operação que deixa de estar `running` pede uma conferência ao [[sessionKeeper]], para pegar um arquivo da Riot deixado por um login que falhou.
- **Sessão de quem sai vai para a dona provada.** Desde 2026-11-06 ([[ADR-020 Riot conectada é encerrada quando fica sem jogo]]), o `save_leaving_session` do [[appPorts]] chama primeiro `keep(yaml)` do [[sessionKeeper]]. Se o guardião prova a dona pelo `sub` ou por um Riot ID único, a sessão vai para ela e o log registra "updated the session of the account that was signed in". Sem dona provada vale a regra antiga: a última conta usada, se o Riot ID ativo bater com ela; identidade não confirmada não é associada ao store.
- **Guardião, wakeup e leitura do jogo.** O [[sessionKeeper]] ([[ADR-019 Sessão salva por conta no modo cartões]]), o [[riotWakeup]] ([[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]) e o [[rankWatcher]] ([[ADR-031 Elo lido do próprio jogo, sem chave]]) recebem o [[riotClient]] real, o [[store]], "há login em curso" do [[signInService]] e o log. Uma sessão guardada ou uma conta atualizada publica `account-updated`.
- **Sem chave, a atualização só lê o jogo.** O [[refresher]] recebe o [[rankApi]] real e, para quando não há chave, o `check()` do [[rankWatcher]].
- **Uma abertura de cada vez.** Um pedido de abrir a Riot com outro em curso é ignorado (trava `opening`).
- **Login em andamento bloqueia a abertura.** Com uma operação `running` sem pedido de atenção, abrir a Riot falha com "The game is opening. Wait or cancel from the tray.". Com pedido de atenção (2FA, CAPTCHA), a bandeja abre a Riot para o usuário resolver, sem pedir os cartões por cima.
- **Falha visível.** Uma falha ao abrir a Riot pela bandeja vai ao `sign-in.log` e vira uma caixa de aviso com o motivo traduzido e a sugestão de tentar de novo.
- **Segredos continuam no serviço.** Descriptografia e consultas de elo ficam no processo do Eclipse, nunca na página dos cartões.
- **Saída ordenada.** Para o [[refresher]], cancela o login, para o guardião, o wakeup e a leitura do jogo, depois a sobreposição, e só então sai.
- **Fechar a Riot pela cópia do X.** Revisão de 2026-11-04 ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]): o main passa ao [[riotOverlay]] o fechamento do [[riotAppControls]]. Falhas não viram notificação nem caixa; a sobreposição fecha só a janela.
- **Bandeja e avisos no idioma salvo.** Revisão de 2026-11-04 ([[ADR-014 Interface em português e inglês]]): o menu da bandeja, as notificações e as caixas de aviso vêm de `main_text` do [[language]], e as mensagens que aparecem neles passam por `localize`. O `sign-in.log` fica em inglês. Ao salvar as configurações, o menu é refeito e o idioma vai à sobreposição. O menu também é refeito ao ligar ou desligar "Iniciar com o Windows".
- **Atualizações pela bandeja (2026-11-21, [[ADR-045 Atualização pelo GitHub]]).** O main registra o `tauri-plugin-updater`, monta o [[updates]] com o [[appUpdater]] e o inicia junto com o resto. Uma versão nova vira um balão e o item "Atualizar para a versão X"; o clique chama `install`, e um login em andamento ou uma falha viram uma caixa de aviso. "Procurar atualizações" grava `updateChecks` no [[store]], refaz o menu e, ao religar, pergunta na hora. O `quit` para também as perguntas, e o [[appUpdater]] chama o mesmo `quit` antes de rodar o Setup.
- **Iniciar com o Windows só no app instalado.** Desde 2026-11-08 ([[ADR-030 Eclipse instalado por um Setup próprio]]), a opção aparece só no app compilado em modo release, marcada conforme a chave `Run`. Rodando do projeto, a chave não é lida nem gravada. Iniciado pelo Windows, o Eclipse faz o mesmo que pelo atalho: fica na bandeja sem abrir a Riot.
- **WebView2 sem detecção de oclusão nem animação.** Desde 2026-11-04, ainda no Electron, a detecção de oclusão do Chromium fica desligada (`CalculateNativeWinOcclusion` nos argumentos das webviews): com ela, a página dos cartões ficava marcada como oculta depois de a Riot ser restaurada e não voltava a desenhar. As transições do DWM da janela dos cartões também ficam desligadas ([[riotOverlay]], [[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]).

## Testes

O `main.rs` só monta as peças e não tem teste próprio: cada serviço tem os seus, com dependências falsas. `src-tauri/tests/paths.rs` confere a pasta de dados que ele usa em cada modo. A ordem de criação e parada, a bandeja e a segunda instância são conferidas à mão, no app real ([[Backlog]]). Até 2026-11-15, o `mainStartup.test.js` conferia o ponto de entrada do Electron.

## Pontos de atenção

- Uma peça nova que dependa de outra criada depois precisa de um `OnceLock`, como o guardião e a leitura do jogo usam hoje.
- Ver [[Integração com o Riot Client]], [[Segurança e privacidade]] e [[Backlog]].
