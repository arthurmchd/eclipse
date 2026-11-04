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

- **Painel somente no login.** Injeta a leitura sanitizada e cancelável `riotClient.readLoginScreenState(signal)` em [[riotOverlay]]. A visibilidade acompanha também entradas manuais e sessões lembradas pela Riot, sem depender dos eventos de login do gerenciador.
- **Progresso visível.** No modo sobreposto ativa `visibleLogin` e encaminha a operação ao painel de carregamento. `setBlocked` impede outra seleção durante a tentativa; `setOperation` mantém o indicador visível sobre a Riot. O modo privado conserva a ocultação anterior.

- **Progresso visível.** No modo sobreposto ativa `visibleLogin` e encaminha a operação ao painel de carregamento. `setBlocked` impede outra seleção durante a tentativa; `setOperation` mantém o indicador visível sobre a Riot. O modo privado conserva a ocultação anterior.

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

## Testes

`test/main/mainStartup.test.js` executa o ponto de entrada num `vm` com dependências falsas. Confere a abertura integrada sem janela independente, pedidos concorrentes/segunda instância, falhas recuperáveis e a recuperação do desafio nativo. Validação de formulários e ações está em [[managerService]]; a hospedagem da UI está em [[managerHost]].

Nenhum desses testes autentica contas reais ou abre jogos.

## Pontos de atenção

- Um `require` novo precisa entrar no mapa `deps` do harness de inicialização.
- A cópia privada precisa estar preparada e compatível; a migração não autoriza alterar a instalação original Riot.
- Ver [[Integração com o Riot Client]], [[Segurança e privacidade]] e [[Backlog]].
