---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/integration/host/privateHost.js
camada: integração
testes: test/integration/host/privateHost.test.js
tags: [módulo]
---

# privateHost

> [!note] Removido em 2026-11-07
> O host da cópia privada saiu inteiro. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Ciclo de vida do processo do host privado: recebe o pedido pelo canal, prepara o Electron, decifra o token e carrega o `main.js` da cópia privada do Riot.

## Responsabilidade

Lê o pedido JSON inicial e os comandos `hide`, `show`, `open-manager`, `close-manager` e `stop`. Valida com [[privateHostCore]], isola o perfil Chromium, decifra o token DPAPI e carrega o main Riot com argumentos só em memória. Observa as janelas e emite `ready` quando os [[addons]] carregaram. A visualização completa é criada por [[managerHost]] dentro da janela principal, usando o transporte do addon main.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `runPrivateHost(options)` | função assíncrona | Devolve `{ stop, hide, show }`. Opções injetáveis: `electron`, `processObject`, `input`, `protocolOutput`, `loadMain`, `validateRequest`, `checkHash`, `mainGlobal`, `diagnostic`, `decryptToken`, `requestTimeoutMs` (30000) e `createAccountsView`. |

Eventos emitidos no canal: `{ event: 'ready', integrationReady: true, managerConnected }`, `{ event: 'error', stage, error }` com texto genérico, e `manager-ready` ou `manager-error` para a abertura da visualização de contas. Etapas: `validation`, `decryption`, `load-main`, `renderer`.

## Dependências

- Usa: [[privateHostCore]], [[asar]] (`sha256File`), [[windowsDpapi]] (`unprotectString`), [[managerHost]] e `electron`.
- Usado por: [[hostEntry]].

## Invariantes e decisões

- **Argumentos do SO sem segredo.** É um ponto de entrada Electron separado. A linha de comando tem só o script e o nome aleatório do pipe. As credenciais chegam cifradas pelo canal.
- **Console do fornecedor fora do protocolo.** O bundle do Riot cuida do próprio log. `process.stdout.write` e `process.stderr.write` viram no-ops, e o protocolo usa o `write` original guardado antes. O transporte de log em arquivo é protegido pelo guarda de log da cópia (ver [[privateHostCore]]).
- **Duas operações síncronas antes do primeiro `await`.** `preparePrivateHostBeforeReady` desliga a aceleração de hardware e registra o esquema `sentry-ipc` antes de o Electron ficar pronto. A decifragem DPAPI e o carregamento do main vêm depois.
- **Perfil separado antes de qualquer código do Riot.** `userData` e `sessionData` vão para `profilePath`, e `logs` para `logDir`, antes de carregar o fornecedor ou tocar a sessão padrão. Nenhum perfil do Riot instalado é alterado.
- **Ordem após o pedido.** Validar, configurar caminhos, `app.whenReady()`, decifrar, montar argumentos, conferir o hash do candidato de novo, recusar `RC_TEST_MODE`, carregar o main.
- **Hash conferido de novo.** Logo antes de carregar, o SHA-256 do candidato é comparado com o do manifesto. Se mudou, não carrega.
- **Sem modo de teste.** Se `RC_TEST_MODE` estiver no ambiente, o host recusa. Segundo a mensagem de erro, esse modo desligaria o watchdog do backend.
- **argv sintético só durante o carregamento.** O fornecedor lê `cliArgs` de forma síncrona ao carregar. `process.argv` recebe os argumentos sintéticos só durante `loadMain` e é restaurado num `finally`. Assim coletores de crash ou diagnóstico não pegam esses argumentos depois. As variáveis com o token são esvaziadas antes do carregamento.
- **"Pronto" é a janela principal, não o login.** Telas de splash e `about:blank` são ignoradas. Só conta a janela em `http://127.0.0.1:<porta>/index.html`. `ready` significa que o documento do renderer carregou, não que a autenticação terminou.
- **Prova de que o painel carregou.** Exige `window.riotAccountManager` com `state`, `signIn`, `cancel` e `openManager` e o símbolo `riot-account-manager.renderer.v1` em `window`. Sem isso, falha em `renderer`. A verificação só lê; chama `state()` para medir `managerConnected` e nunca chama as outras funções.
- **Mostrar após o primeiro carregamento.** Se não estiver oculto, faz `hide()` e `show()` na janela principal ao ficar pronto. Os testes chamam isso de contorno do "primeiro show" com início oculto.
- **Oculto continua oculto.** Com `hide`, qualquer `show` de janela é desfeito. `show` só atua na janela principal: `hide`, `show`, `focus`.
- **Contas é uma visualização da janela Riot.** `open-manager` mostra a janela principal e cria/reutiliza [[managerHost]]. Se o renderer ainda não está pronto, guarda o pedido e o executa após a validação. `close-manager` fecha somente a visualização. Não cria outra `BrowserWindow`.
- **Erro de Contas não mata o Riot.** Falha ao abrir a visualização emite `manager-error`, permitindo ao controlador informar o erro e manter a interface Riot disponível.
- **Transporte no main.** O serviço de gerenciamento é obtido pelo símbolo `riot-account-manager.manager-request.v1` no contexto principal. Não é entregue à página Riot como uma API genérica.
- **Descarte acompanha o host.** Parar o host descarta a visualização, remove seu IPC e encerra seu `webContents`; fechar apenas Contas não cancela operações no serviço.
- **Entrada limitada.** O pedido inicial pode ter até 64 KiB. Depois, cada comando até 128 bytes. Comando desconhecido derruba o host.
- **Falha única e genérica.** Só o primeiro erro é emitido, sem detalhes. Exceções não tratadas, rejeições não tratadas, crash do renderer e falha de carga do frame principal também falham. Toda falha encerra o app.
- **Prazos.** 30 s para chegar o pedido. 45 s depois de carregar o main para ficar pronto.
- **Fim do canal encerra.** Se o canal fecha, o host para.

## Testes

`privateHost.test.js` cobre: decifragem só após `ready` do Electron, argv só em memória e restaurado; `ready` só para a janela principal e modo oculto; contorno do primeiro show; falhas em cada etapa sem segredos; parada ao fechar a entrada e em crash do renderer; recusa de `RC_TEST_MODE`; recusa quando o addon do renderer não carregou.

## Pontos de atenção

- Uma falha na nova conferência do hash é relatada com etapa `decryption`, porque `stage` só muda para `load-main` depois dela. O teste fixa esse comportamento.
- `isMainRenderer` depende de o Riot servir a UI em `http://127.0.0.1:<porta>/index.html`. Ver [[Atualização do Riot Client]].
- O nome da etapa de diagnóstico `stdin-ended` é herança do tempo em que o canal era stdin.
