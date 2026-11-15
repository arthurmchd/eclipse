---
tipo: módulo
arquivo: src-tauri/src/riot/riot_client.rs
camada: riot
testes: src-tauri/tests/riot/riot_client.rs
tags: [módulo]
---

# riotClient

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Fachada do processo principal para o Riot Client: detecta a instalação, fecha e reabre o cliente, monta o [[signInFlow]] com as dependências reais e abre o jogo.

## Responsabilidade

- Liga as peças reais ao [[signInFlow]]: processos do Windows, arquivo de configurações do Riot, API local, helper de janelas ([[windowController]]) e [[login.ps1]].
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
| `persistedSubject(yaml)` | função | O `sub` (a conta dona do login lembrado): do cookie `sub` na lista de cookies, se houver, senão do `id_token`. Aceita só `[A-Za-z0-9-]{8,100}`; fora disso, `null`. |
| `persistedRiotId(yaml)` | função | `{ gameName, tagLine }` de `acct.game_name` e `acct.tag_line` no `id_token` do login lembrado, ou `null`. |
| `readSettingsYaml()` / `writeSettingsYaml(text, { expected })` | função / função async | Lê (ou `null`) e grava o `RiotGamesPrivateSettings.yaml`. Exportadas desde 2026-11-06 para o [[sessionKeeper]]. Desde 2026-11-06, a gravação usa `replaceFile` e devolve `true`, ou `false` quando o arquivo não é mais `expected`. Qualquer falha vira "Could not update the Riot Client settings file", sem caminho. |
| `replaceFile(file, text, options)` | função async | Grava num temporário `eclipse-<uuid>.tmp` na mesma pasta e troca com `rename`. Opções: `expected`, `fs`, `sleep`, `attempts` (5), `delayMs` (100), `now`, `staleMs` (60 s). Exportada para os testes. |
| `authorizationOf(response)` | função | `'yes'` com 200, `'no'` com 404, `'unknown'` com qualquer outra resposta ou sem resposta. Exportada para os testes. |
| `gameRanks` | objeto | `{ league, valorant }` do [[gameRanks]], com dois transportes do [[riotTransport]]: um para o cliente do LoL (`connection: readLeagueLockfile`) e um para o chat do Riot Client (até 8 MiB). Desde 2026-11-08, para o [[rankWatcher]] ([[ADR-031 Elo lido do próprio jogo, sem chave]]). |
| `look()` | função | Uma olhada do [[riotState]] sobre `runningGames`, `authorization` e `sessionState` reais. Desde 2026-11-07, para o [[sessionKeeper]] e o [[riotWakeup]] ([[ADR-029 Estado da Riot definido num lugar só]]). |
| `createCloseEverything(deps)` | função | Monta o `closeEverything` com `runningGames`, `authorization`, `activeRiotId`, `localApi`, `taskkill`, `readSettingsYaml` e `waitFor`. Exportada para os testes. |
| `createClientStarter(deps)` | função | Monta o `startClient` com `detectClientPath`, `runningGames`, `reveal`, `launchClient` e `select`. Exportada para os testes. |
| `watchSettings(onChange)` | função | `fs.watch` na pasta `Data` da Riot, avisando só mudanças em `RiotGamesPrivateSettings*`. Erros do watcher são engolidos; pasta ausente devolve `null`. |
| `watchLockfile(onChange)` | função | `fs.watch` na pasta `Config` da Riot, avisando só mudanças no `lockfile`. Erros do watcher são engolidos; pasta ausente devolve `null`. Desde 2026-11-06, para o [[riotWakeup]]. |
| `showInterface()` | função async | `POST /riot-client-lifecycle/v1/show`. `true` com resposta 2xx; erro vira `false`. Sem plano B que reinicie a Riot, diferente de `openClient`. Desde 2026-11-06, para o [[riotWakeup]]. |
| `quitClient()` | função async | Pede à Riot a saída normal (`POST /process-control/v1/process/quit`), a mesma do menu "Sair". Erro vira `null`. Exportada desde 2026-11-06 para o [[sessionKeeper]]. |
| `sameRiotId(a, b)` | função | Compara `gameName` e `tagLine` sem diferenciar maiúsculas. Exige `gameName` nos dois. |
| `startClient(clientPath)` | função async | Inicia a Riot com a interface só se nenhum processo dela estiver rodando. Libera as janelas guardadas, confere de novo e inicia. Devolve `true` se iniciou e `false` se a Riot já rodava. Sem caminho, lança "Riot Client not found". Desde 2026-11-06, para o [[sessionKeeper]]. |
| `openClient(clientPath)` | função async | Revela as janelas Riot. Se não há janela do cliente, abre a interface visível. |
| `closeClient()` | função async | Fecha o Riot como o botão X da Riot, pelo [[riotAppControls]]. Devolve `'background'` ou `'quit'`. Usado só pela cópia do X nos [[cards]]. |
| `dispose()` | função async | `windows.stop()`. |
| `readLoginScreenState(signal)` | função async | Estado sanitizado da tela de login (`riotAuthentication.loginScreenState`), usado só para a visibilidade dos cartões. Sinal opcional cancela a leitura. |

## Dependências

- Usa: [[signInFlow]], [[gameRanks]], [[riotTransport]], [[riotAuthentication]], [[riotAppControls]], [[riotProcess]], [[windowController]], [[windowsEnvironment]], [[paths]] (`windowsHelper('login.ps1')`), [[login.ps1]].
- Usado por: [[main]] (`openClient`, `closeClient`, `readLoginScreenState`, `saveLeavingSession`, encerramento), [[signInService]] (`signIn`), [[managerService]] (`runningGames`), [[sessionKeeper]], [[riotWakeup]] e [[rankWatcher]] (`look`, `gameRanks`, `sameRiotId`).
- **API sem o modo antigo.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saíram `ensureBackgroundClient` (só a cópia privada o usava), `showClient` e o export `readAuthenticationState`. O [[signInFlow]] continua recebendo `readAuthenticationState` pelo `io` interno.

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
| `sessionState` | `authentication.sessionState()`. Qualquer erro vira `null`. Nulo também com a Riot em segundo plano, porque a rota não existe nesse modo. Entregue ao [[riotState]] e ao [[signInFlow]]. |
| `authorization` | `GET /rso-auth/v1/authorization` lido por `authorizationOf`. Erro vira `'unknown'`. Entregue ao [[riotState]], ao [[signInFlow]] e ao `closeEverything`. |
| `isAuthorized` | `authorization() === 'yes'`. |
| `activeRiotId` | `GET /player-account/aliases/v1/active`. Aceita `game_name`/`gameName` e `tag_line`/`tagLine`. |
| `launchProduct(exe, game, visible)` | `launchClient(exe, { visible })`. Ignora `game`. |

### `closeEverything(log)`

1. Lê a conta pela regra do [[riotState]]: Riot fechada vale `'no'`, sem consultar a API; aberta, `authorization`. Com `'yes'`, guarda `signedIn = true` e o Riot ID ativo.
2. Mata LoL e VALORANT com `taskkill /F /T`.
3. Com `'yes'` ou `'unknown'`, pede `POST /process-control/v1/process/quit`. Aceito (2xx), espera até 10 s e registra se saiu normalmente ou se será forçado. Recusado ou com erro, registra "Riot Client did not accept the quit request, forcing" e segue sem esperar. Com `'no'`, não há login a gravar e nada é pedido.
4. Mata os processos do cliente e espera até 10 s (a cada 250 ms). Se algo resta: "Could not close the Riot Client".
5. Retorna `{ signedIn, riotId, yaml }`, com o YAML como ficou no disco.

### `runWindowScript(request, onLine, signal)`

- `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File login.ps1`, com `windowsHide`.
- O pedido vai como JSON no stdin. Retorna `{ promise, kill }`; `onLine` recebe cada linha impressa.
- Timeout de 90 s: "The Riot Client sign-in form did not respond". `signal` mata o processo: "Sign-in cancelled".
- Sucesso exige código 0 e última linha `ok`. Resolve com todas as linhas.
- Traduz `error:window-not-found` e `error:form-not-ready`. O resto vira "Riot Client window script failed: <última linha>".

### `typeCredentials(request, signal, log)` (entregue ao signInFlow)

- Garante a janela da interface com `openInterface` ([[riotInterface]]): reaproveita a janela existente, pede `show` aos serviços headless ou os reinicia com interface, sempre visível desde 2026-11-07.
- Checa cancelamento e roda `runWindowScript(request, () => {}, signal)`.
- O caminho usado vai para o `sign-in.log` pelo `log`.

### `requestLaunch(game, log)`

Criado por `createLaunchRequester({ localApi })`, exportado para os testes.

- Base: `/product-launcher/v1/products/<produto>/patchlines/live`. `lol` e `tft` → `league_of_legends`; `val` → `valorant`.
- `GET <base>/eligibility` só para o log. Depois `POST <base>` com 30 s.
- Grava no log só o status HTTP, `eligible`/`not eligible` quando a elegibilidade vem como booleano e um `errorCode` com formato de código. Nunca lança erro.
- Devolve `{ status, errorCode }`. `errorCode` é o `errorCode` da resposta se casar com `^[A-Za-z0-9_.-]{1,100}$`, senão `null`. Status fora de 0–999 vira `0`. Sem resposta, grava "launch request: no answer from Riot" e devolve `{ status: 0, errorCode: null }`.

## Invariantes e decisões

- **Estado da Riot pelo [[riotState]].** Desde 2026-11-07 ([[ADR-029 Estado da Riot definido num lugar só]]), o riotClient cria uma instância do [[riotState]] com as consultas reais e exporta `look()`. O `closeEverything` usa a mesma regra. Saíram as saídas `clientRunning`, `isAuthorized`, `authorization` e `sessionState`, que só o [[sessionKeeper]] e o [[riotWakeup]] usavam; continuam como funções internas, entregues ao [[signInFlow]].

- **Sem `error:focus` e sem interface escondida.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saiu o ramo `error:focus`, que o [[login.ps1]] nunca emitia, e o `visible: true` explícito das chamadas ao [[riotInterface]], que agora sempre abre a interface visível.
- `openClient` usa o mesmo abridor quando os serviços já rodam sem interface; pede a janela ao backend antes de considerar outro início. Executar novamente apenas o exe não garantia uma janela.

- Para [[ADR-010 Login visível com progresso]], fornece `openVisibleInterface` ao fluxo usando o abridor existente e `closeGames` restrito aos processos de jogos, sem reiniciar a interface Riot. A confirmação de fechar jogos permanece nos [[cards]] antes da operação.

- **A API local é a fonte do estado de login.** Porta e senha estão no lockfile do cliente.
- **Estado só com metadados públicos.** `readLoginScreenState` e o `readAuthenticationState` do `io` reaproveitam a normalização de [[riotAuthentication]], sem expor tokens ou credenciais.
- **Troca de conta pelo "Stay signed in".** Depois que uma conta entra uma vez com a opção marcada, o `RiotGamesPrivateSettings.yaml` guarda esse login. O app mantém uma cópia por conta e a devolve antes de iniciar o cliente. O cliente então entra sozinho, sem janela nem digitação. Se a cópia falta ou expirou, as credenciais são enviadas pela API direta ou digitadas no formulário visível.
- **`clientWindow` olha só a interface.** `RiotClientServices.exe` roda em segundo plano sem janela. Por isso `clientWindow` considera só `Riot Client.exe` e `RiotClientUx.exe`.
- **Dois formatos de login lembrado.** Um `refresh_token` em `psl.authorization.riot-client` (Riot Client v141) ou um cookie `"ssid"` (versões antigas).
- **A dona do login lembrado vem do `sub`.** Desde 2026-11-06 ([[ADR-019 Sessão salva por conta no modo cartões]]). O Riot Client v141 não grava cookie `sub`: o login lembrado fica em `psl.authorization.riot-client`, e o `id_token` dali é um JWT cuja parte do meio traz `sub` e `acct` (`game_name`, `tag_line`). `idTokenClaims` decodifica só essa parte (base64url e JSON), sem conferir assinatura. Qualquer erro dá `null`. Um cookie `sub` (formato antigo) ainda vale primeiro, e só dentro de um item da lista de cookies (linha começando com `-`). O [[sessionKeeper]] usa o `sub` contra o das sessões guardadas e o Riot ID como segunda prova.
- **Observar o arquivo da Riot para guardar a sessão.** `watchSettings` usa o aviso do Windows sobre a pasta `Data`. A Riot grava esse arquivo ao entrar, ao renovar a sessão e ao sair, e o [[sessionKeeper]] guarda cada versão. Encerrar a Riot conectada que ficou sem jogo é outra coisa: depende da olhada nos processos do guardião, a cada 4 s ([[ADR-020 Riot conectada é encerrada quando fica sem jogo]]).
- **O `lockfile` marca a troca de modo.** A Riot v142 regrava `Config\lockfile` ao entrar e ao sair do segundo plano (conferido em 2026-11-06). Em segundo plano, a API local só responde `/help`. O [[riotWakeup]] usa os dois fatos ([[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]).
- **`startClient` nunca mexe numa Riot aberta.** Diferente de `openClient`, não pede a janela ao serviço nem reinicia a Riot sem interface com `taskkill`. Confere os processos antes e depois do `reveal` do [[windowController]], porque o usuário pode abrir a Riot nesse meio-tempo. Só existe para a reabertura do [[sessionKeeper]] ([[ADR-026 Riot fechada depois do jogo reabre na tela de login]]).
- **`quitClient` é só a saída normal.** Nunca `taskkill` nem `DELETE /rso-auth/v1/session`. A Riot grava o login ao sair, e a sessão continua válida no servidor para a próxima restauração.
- **Limpar o login preserva o `tdid`.** `stripPersistedLogin` troca o mapeamento `riot-client:` (os tokens) por `riot-client: null`. Em `riot-login.persist.session.cookies` fica só o cookie `tdid`, para a Riot continuar reconhecendo este computador.
- **Formato da lista de cookies.** Os itens ficam no mesmo recuo de `cookies:` ou mais fundo, e cada um começa com `-`.
- **`/rso-auth/v1/authorization` indica a conexão.** Responde 404 com o cliente desconectado e 200 com uma conta Riot conectada.
- **Fechar com pedido de saída primeiro.** Um cliente conectado, ou de estado desconhecido, recebe `quit` antes do `taskkill`, para gravar no disco a sessão mais recente. O YAML é lido só depois. Até 2026-11-06, um erro na leitura do estado levava direto ao `taskkill`, e um pedido recusado ainda esperava 10 s.
- **Estado da conta em três valores.** Desde 2026-11-06, `authorization()` devolve `'yes'` (200), `'no'` (404) ou `'unknown'` (outra resposta ou erro). Um 401, por exemplo, só diz que a credencial da API local foi recusada. Só `'no'` prova que não há conta, e o [[signInFlow]] só limpa um login pela metade nesse caso.
- **Gravação atômica do arquivo da Riot.** Desde 2026-11-06, `writeSettingsYaml` grava num temporário na mesma pasta e troca com `rename` (no Windows, `MoveFileEx` com substituição). A Riot nunca lê um arquivo pela metade, e uma queda no meio deixa o original intacto.
  - O temporário se chama `eclipse-<uuid>.tmp` e não aciona o `watchSettings`, que só olha `RiotGamesPrivateSettings*`.
  - O conteúdo vai ao disco (`flush`) antes da troca.
  - Com `EPERM`, `EBUSY` ou `EACCES` (arquivo em uso), tenta 5 vezes, a cada 100 ms.
  - Com `expected`, o arquivo é relido antes de cada troca, e nada é gravado se a Riot o mudou. Isso estreita a janela de corrida, mas não a fecha.
  - Temporários próprios com mais de 60 s, deixados por uma queda, são apagados. Nenhum outro arquivo da pasta é tocado.
  - Não há cópia do arquivo anterior: ela deixaria mais uma cópia dos tokens em texto puro no disco, e as sessões já ficam cifradas no [[store]].
- **Rota de digitação é só compatibilidade.** `typeCredentials` só roda quando a API de login direto não está disponível (ou exige o formulário nativo). A interface é sempre aberta visível. Se uma janela do cliente já existe, não abre outra.
- **Serviços headless não abrem interface sozinhos.** Até 2026-10-26, `typeCredentials` chamava `RiotClientServices.exe` de novo para abrir a interface. Com os serviços já em `--headless`, isso não abria janela nenhuma e o login falhava com "The Riot Client window did not open". A abertura agora é responsabilidade do [[riotInterface]].
- **`requestLaunch` registra e devolve o motivo de recusa.** Por exemplo, HTTP 424 `launch_failed_product_not_up_to_date` quando o jogo ainda precisa de atualização; com ele o [[signInFlow]] espera e repete o pedido (desde 2026-11-04). Quem decide o sucesso continua sendo o [[signInFlow]], pela janela do jogo.
- **Log da abertura só com valores fixos.** Desde 2026-11-07 o `requestLaunch` não grava mais até 300 caracteres de cada resposta. Pelo `sign-in.log` real, a elegibilidade responde um booleano, o pedido aceito uma string (o ID da abertura) e a recusa `{ errorCode, httpStatus, implementationDetails, message }`. Ficam de fora a mensagem, os detalhes, o ID e o texto de erro da rede, que podem trazer caminhos ou nomes. O código basta para o [[signInFlow]] reconhecer o jogo desatualizado.
- **`launchProduct` nunca inclui um jogo.** O argumento `game` é ignorado. O jogo só é pedido depois da verificação, por `requestLaunch`.
- **`login.ps1` fora do `app.asar`.** O caminho vem de `windowsHelper` ([[paths]]), que troca `app.asar` por `app.asar.unpacked`. O PowerShell não lê arquivos de dentro do asar.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/riot/riot_client.rs`, testes em `src-tauri/tests/riot/riot_client.rs`. As funções puras ficaram soltas (`has_persisted_login`, `strip_persisted_login`, `persisted_subject`, `persisted_riot_id`, `authorization_of`, `request_launch`, `parse_tasklist`) e o `RiotClient` monta as peças reais, como o módulo JS. `close_everything` e `start_client` recebem as dependências pelas traits `CloseIo` e `StartIo`; `replace_file_with` recebe o disco pela trait `SettingsFiles`. No Windows, `EPERM`, `EBUSY` e `EACCES` chegam ao Rust como os códigos 5, 32 e 33, e são esses que repetem a troca do arquivo. Os vigias usam a biblioteca `notify`. O `login.ps1` recebe as credenciais só pela entrada padrão, como no JS; um cancelamento ou os 90 s encerram a árvore inteira do PowerShell (`taskkill /T`), não só o processo de cima. O Riot ID tirado do `id_token` é cortado em 64 e 16 unidades UTF-16, sem partir um caractere ao meio. Nada disso rodou ainda com a Riot real.

## Testes

`test/riot/riotClient.test.js` (desde 2026-11-06) importa o módulo e cobre, com YAMLs sintéticos: `persistedSubject` pelo cookie (com LF e CRLF, `sub` fora da lista de cookies ou com formato estranho) e pelo `id_token` do formato atual; `persistedRiotId`; tokens ilegíveis ou com campos do tipo errado; `hasPersistedLogin` e `stripPersistedLogin` (sobra só o `tdid`, nenhum token, sessão ou `sub`). `test/riot/signInFlow.test.js` troca as demais funções por fakes, e `test/main/mainStartup.test.js` usa um `riotClient` falso.

Desde 2026-11-06 também cobre:

- `replaceFile` numa pasta temporária dentro de `test/riot`: troca inteira por um temporário da mesma pasta, que não começa com o nome do arquivo da Riot; arquivo mudado desde a leitura mantido; arquivo em uso tentado de novo, com a gravação da Riot durante a espera vencendo; falha de troca, de disco ou de arquivo sumido sem sobra de temporário; limpeza só dos temporários próprios antigos;
- `authorizationOf`: 200, 404 e o resto;
- `createClientStarter` com fakes: Riot fechada iniciada com a interface depois de liberar as janelas; Riot já rodando ou aberta no meio-tempo nunca iniciada de novo; caminho ausente sem nenhuma outra ação.
- `createCloseEverything` com fakes: saída normal depois dos jogos e antes do `taskkill`, estado desconhecido, Riot sem conta ou fechada sem pedido de saída, pedido recusado sem espera, Riot que não sai a tempo e Riot que não fecha.
- `createLaunchRequester` com uma API local falsa (desde 2026-11-07): rotas de elegibilidade e abertura por jogo; log só com status, elegibilidade e código; mensagem, detalhes, ID da abertura e erro de rede fora do log; código malformado e status estranho descartados.

Sem cobertura: `sameRiotId`, `detectClientPath`, `watchSettings`, `runWindowScript` e os `taskkill` e `tasklist` reais.

## Pontos de atenção

- **YAML editado por linhas.** `stripPersistedLogin` para na primeira linha em branco dentro do bloco, aceita qualquer chave `riot-client:` recuada e devolve o texto com `\n` (CRLF vira LF). Um formato novo exige revisão: [[Atualização do Riot Client]].
- **Jogos fechados à força.** `closeEverything` usa `taskkill /F` nos jogos. A confirmação do usuário fica fora deste módulo: os [[cards]] perguntam antes de trocar de conta com um jogo aberto. Conferido em 2026-11-06; a janela antiga e o caminho do addon saíram em 2026-11-07.
- **Caminhos fixos em `C:`.** Outra unidade depende do `RiotClientInstalls.json` ou do caminho nas configurações.
- **`selectedClientPath` é estado global.** O último caminho detectado vale para todas as chamadas seguintes da API local.
- **Identidade no `id_token`.** Conferido no Riot real em 2026-11-06 (em memória, sem mostrar valores): o `id_token` traz `sub` e `acct`. Se a Riot mudar o formato, `persistedSubject` e `persistedRiotId` devolvem `null` e o [[sessionKeeper]] deixa o login no arquivo da Riot.
