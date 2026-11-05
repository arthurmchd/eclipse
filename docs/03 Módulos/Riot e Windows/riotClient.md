---
tipo: módulo
arquivo: src/riot/riotClient.js
camada: riot
testes: nenhum
tags: [módulo]
---

# riotClient

> Fachada do processo principal para o Riot Client: detecta a instalação, fecha e reabre o cliente, monta o [[signInFlow]] com as dependências reais e abre o jogo.

## Responsabilidade

- Liga as peças reais ao [[signInFlow]]: processos do Windows, arquivo de configurações do Riot, API local, monitor de janelas e [[login.ps1]].
- Lê o estado de login pela API local do Riot Client. Porta e senha vêm do lockfile, via [[riotTransport]].
- Faz a troca de conta com o "Stay signed in" do próprio cliente. Ver "Invariantes e decisões".

Não guarda contas nem sessões ([[store]], [[signInService]]). Não decide a ordem do login ([[signInFlow]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `signIn` | função async | O [[signInFlow]] já montado com as dependências reais. |
| `runningGames` | função async | `{ lol, val, client, clientWindow }` a partir do `tasklist`. |
| `detectClientPath(override)` | função | Override se existir; depois `rc_default` e `rc_live` de `C:/ProgramData/Riot Games/RiotClientInstalls.json`; depois `C:/Riot Games/Riot Client/RiotClientServices.exe`. Senão `null`. |
| `hasPersistedLogin(yaml)` | função | `true` se o YAML tem login lembrado. |
| `stripPersistedLogin(yaml)` | função | Remove o login lembrado e mantém só o `tdid`. |
| `sameRiotId(a, b)` | função | Compara `gameName` e `tagLine` sem diferenciar maiúsculas. Exige `gameName` nos dois. |
| `showClient()` | função async | `openClient` com o último caminho usado ou o detectado. |
| `openClient(clientPath)` | função async | Revela as janelas Riot. Se não há janela do cliente, abre a interface visível. |
| `ensureBackgroundClient(clientPath)` | função async | Oculta janelas (`hide`), inicia o backend `--headless` se não roda e espera até 45 s pelo estado de sessão. Retorna o caminho. |
| `closeClient()` | função async | Fecha o Riot como o botão X da Riot, pelo [[riotAppControls]]. Devolve `'background'` ou `'quit'`. Usado só pela cópia do X nos [[cards]]. |
| `dispose()` | função async | `windows.stop()`. |
| `readAuthenticationState(signal)` | função async | Estado sanitizado de `riotAuthentication.sessionState(signal)`, usado para recuperar verificação pendente e controlar a visibilidade dos cartões. Sinal opcional cancela a leitura. |

## Dependências

- Usa: [[signInFlow]], [[riotTransport]], [[riotAuthentication]], [[riotAppControls]], [[riotProcess]], [[windowController]], [[windowsEnvironment]], [[paths]] (`windowsHelper('login.ps1')`), [[login.ps1]].
- Usado por: [[main]] (IPC "show-riot-client", `saveLeavingSession`, `ensureBackend` do [[privateClient]], encerramento) e [[signInService]] (`signIn`, `runningGames`).

## Estado do módulo

- `readLoginScreenState(signal)` encaminha a leitura cancelável e sanitizada de `authentication.loginScreenState` exclusivamente para decidir visibilidade de [[riotOverlay]], sem usar essa classificação para autorizar login ou jogo.
- `windows`: um único `createWindowController()`, criado no carregamento. Vive enquanto o app vive.
- `selectedClientPath`: último caminho confirmado. A API local o usa para achar o certificado do Riot.
- `localApi` = `createRiotTransport(...)`; `authentication` = `createRiotAuthentication({ request: localApi })`.

## Funções internas

| Função | O que faz |
|---|---|
| `runningProcesses` | `tasklist /FO CSV /NH`. Falha: "Could not check running Riot games. No accounts were switched". |
| `taskkill(names)` | `taskkill /F /T /IM ...`. Ignora erros. |
| `readSettingsYaml` / `writeSettingsYaml` | Lê (ou `null`) e grava `<LOCALAPPDATA>\Riot Games\Riot Client\Data\RiotGamesPrivateSettings.yaml`. |
| `sessionState` | `authentication.sessionState()`. Qualquer erro vira `null`. |
| `isAuthorized` | `GET /rso-auth/v1/authorization`. Erro vira `false`. |
| `activeRiotId` | `GET /player-account/aliases/v1/active`. Aceita `game_name`/`gameName` e `tag_line`/`tagLine`. |
| `launchProduct(exe, game, visible)` | `launchClient(exe, { visible })`. Ignora `game`. |

### `closeEverything(log)`

1. Se o cliente roda e está autorizado, guarda `signedIn = true` e o Riot ID ativo.
2. Mata LoL e VALORANT com `taskkill /F /T`.
3. Com conta conectada, pede `POST /process-control/v1/process/quit` e espera até 10 s. Registra se saiu normalmente ou se será forçado.
4. Mata os processos do cliente e espera até 10 s (a cada 250 ms). Se algo resta: "Could not close the Riot Client".
5. Retorna `{ signedIn, riotId, yaml }`, com o YAML como ficou no disco.

### `runWindowScript(request, onLine, signal)`

- `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File login.ps1`, com `windowsHide`.
- O pedido vai como JSON no stdin. Retorna `{ promise, kill }`; `onLine` recebe cada linha impressa.
- Timeout de 90 s: "The Riot Client sign-in form did not respond". `signal` mata o processo: "Sign-in cancelled".
- Sucesso exige código 0 e última linha `ok`. Resolve com todas as linhas.
- Traduz `error:window-not-found`, `error:form-not-ready` e `error:focus`. O resto vira "Riot Client window script failed: <última linha>".

### `typeCredentials(request, signal, log)` (entregue ao signInFlow)

- Garante a janela da interface com `openInterface` ([[riotInterface]]): reaproveita a janela existente, pede `show` aos serviços headless ou os reinicia com interface, oculta se `request.hide`.
- Checa cancelamento e roda `runWindowScript(request, () => {}, signal)`.
- O caminho usado vai para o `sign-in.log` pelo `log`.

### `requestLaunch(game, log)`

- Base: `/product-launcher/v1/products/<produto>/patchlines/live`. `lol` e `tft` → `league_of_legends`; `val` → `valorant`.
- `GET <base>/eligibility` só para o log. Depois `POST <base>` com 30 s.
- Grava status e até 300 caracteres do JSON de cada resposta. Nunca lança erro.
- Devolve `{ status, errorCode }`. `errorCode` é o `errorCode` textual da resposta, cortado em 100 caracteres, ou `null`. Falha de rede vira `status: 0`.

## Invariantes e decisões
- `openClient` usa o mesmo abridor quando os serviços já rodam sem interface; pede a janela ao backend antes de considerar outro início. Executar novamente apenas o exe não garantia uma janela.

- Para [[ADR-010 Login visível com progresso]], fornece `openVisibleInterface` ao fluxo usando o abridor existente e `closeGames` restrito aos processos de jogos, sem reiniciar a interface Riot. A confirmação de fechar jogos permanece no renderer antes da operação.

- **A API local é a fonte do estado de login.** Porta e senha estão no lockfile do cliente.
- **Recuperação consulta somente metadados públicos.** `readAuthenticationState` reaproveita a normalização de [[riotAuthentication]], sem expor tokens ou credenciais. Erros de consulta são propagados para o [[main]] preservar a tela existente em vez de reiniciar o contexto.
- **Troca de conta pelo "Stay signed in".** Depois que uma conta entra uma vez com a opção marcada, o `RiotGamesPrivateSettings.yaml` guarda esse login. O app mantém uma cópia por conta e a devolve antes de iniciar o cliente. O cliente então entra sozinho, sem janela nem digitação. Se a cópia falta ou expirou, as credenciais são enviadas pela API direta ou digitadas no formulário oculto.
- **`clientWindow` olha só a interface.** `RiotClientServices.exe` roda em segundo plano sem janela. Por isso `clientWindow` considera só `Riot Client.exe` e `RiotClientUx.exe`.
- **Dois formatos de login lembrado.** Um `refresh_token` em `psl.authorization.riot-client` (Riot Client v141) ou um cookie `"ssid"` (versões antigas).
- **Limpar o login preserva o `tdid`.** `stripPersistedLogin` troca o mapeamento `riot-client:` (os tokens) por `riot-client: null`. Em `riot-login.persist.session.cookies` fica só o cookie `tdid`, para a Riot continuar reconhecendo este computador.
- **Formato da lista de cookies.** Os itens ficam no mesmo recuo de `cookies:` ou mais fundo, e cada um começa com `-`.
- **`/rso-auth/v1/authorization` indica a conexão.** Responde 404 com o cliente desconectado e 200 com uma conta Riot conectada.
- **Fechar com pedido de saída primeiro.** Um cliente conectado recebe `quit` antes do `taskkill`, para gravar no disco a sessão mais recente. O YAML é lido só depois.
- **Rota de digitação é só compatibilidade.** `typeCredentials` só roda quando a API de login direto não está disponível (ou exige o formulário nativo). O monitor já está armado. Se uma janela do cliente já existe, não abre outra.
- **Serviços headless não abrem interface sozinhos.** Até 2026-10-26, `typeCredentials` chamava `RiotClientServices.exe` de novo para abrir a interface. Com os serviços já em `--headless`, isso não abria janela nenhuma e o login falhava com "The Riot Client window did not open". A abertura agora é responsabilidade do [[riotInterface]].
- **`requestLaunch` registra e devolve o motivo de recusa.** Por exemplo, HTTP 424 `launch_failed_product_not_up_to_date` quando o jogo ainda precisa de atualização; com ele o [[signInFlow]] espera e repete o pedido (desde 2026-11-04). Quem decide o sucesso continua sendo o [[signInFlow]], pela janela do jogo.
- **`launchProduct` nunca inclui um jogo.** O argumento `game` é ignorado. O jogo só é pedido depois da verificação, por `requestLaunch`.
- **`login.ps1` fora do `app.asar`.** O caminho vem de `windowsHelper` ([[paths]]), que troca `app.asar` por `app.asar.unpacked`. O PowerShell não lê arquivos de dentro do asar.

## Testes

Nenhum teste importa este módulo. `test/riot/signInFlow.test.js` troca todas as funções daqui por fakes, e `test/main/mainStartup.test.js` usa um `riotClient` falso.

Sem cobertura: `hasPersistedLogin`, `stripPersistedLogin`, `sameRiotId`, `detectClientPath`, `closeEverything`, `runWindowScript`, `requestLaunch`.

## Pontos de atenção

- **Ramo morto.** `error:focus` nunca é emitido pelo [[login.ps1]] atual.
- **YAML editado por linhas.** `stripPersistedLogin` para na primeira linha em branco dentro do bloco, aceita qualquer chave `riot-client:` recuada e devolve o texto com `\n` (CRLF vira LF). Um formato novo exige revisão: [[Atualização do Riot Client]].
- **Corpo de resposta no log.** `requestLaunch` grava trechos das respostas do Riot no `sign-in.log`. Ver [[Segurança e privacidade]].
- **Jogos fechados à força.** `closeEverything` usa `taskkill /F` nos jogos. A confirmação do usuário fica fora deste módulo ([[signInService]], [[renderer]]).
- **Caminhos fixos em `C:`.** Outra unidade depende do `RiotClientInstalls.json` ou do caminho nas configurações.
- **`selectedClientPath` é estado global.** O último caminho detectado vale para todas as chamadas seguintes da API local.
- Testes para o parser do YAML: [[Backlog]].
