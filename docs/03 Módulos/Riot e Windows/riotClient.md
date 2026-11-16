---
tipo: módulo
arquivo: src-tauri/src/riot/riot_client.rs
camada: riot
testes: src-tauri/tests/riot/riot_client.rs
tags: [módulo]
---

# riotClient

> Fachada do Eclipse para o Riot Client: detecta a instalação, fecha e reabre o cliente, monta o [[signInFlow]] com as dependências reais e entrega aos serviços o estado da Riot, o arquivo de configurações e os elos do jogo.

## Responsabilidade

- Liga as peças reais ao [[signInFlow]]: processos do Windows, arquivo de configurações do Riot, API local, helper de janelas ([[windowController]]) e [[login.ps1]].
- Lê o estado de login pela API local do Riot Client. Porta e senha vêm do lockfile, via [[riotTransport]].
- Faz a troca de conta com o "Stay signed in" do próprio cliente. Ver "Invariantes e decisões".

Não guarda contas nem sessões ([[store]], [[signInService]]). Não decide a ordem do login ([[signInFlow]]).

## API pública

O `RiotClient` (`RiotClient::new()`) monta as peças reais e as entrega por métodos e pelas traits que os serviços pedem.

| Método | Descrição |
|---|---|
| `sign_in(pedido)` | O [[signInFlow]] com as dependências reais (pela trait `SignInIo`) |
| `look()` | Uma olhada do [[riotState]] sobre os processos, a autorização e o estado da sessão reais (`RiotProbe`) |
| `game_ranks()` | O [[gameRanks]], com dois transportes do [[riotTransport]]: um para o cliente do LoL e um para o chat do Riot Client (até 8 MiB). Desde 2026-11-08, para o [[rankWatcher]] ([[ADR-031 Elo lido do próprio jogo, sem chave]]) |
| `show_interface()` | `POST /riot-client-lifecycle/v1/show`. `true` com resposta 2xx. Sem plano B que reinicie a Riot, diferente de `open_client`. Para o [[riotWakeup]] |
| `quit_client()` | Pede à Riot a saída normal (`POST /process-control/v1/process/quit`, `QUIT`), a mesma do menu "Sair". Para o [[sessionKeeper]] |
| `start_client(caminho)` | Inicia a Riot com a interface só se nenhum processo dela estiver rodando. Devolve `true` se iniciou e `false` se a Riot já rodava. Sem caminho, falha com "Riot Client not found". Para o [[sessionKeeper]] |
| `open_client(caminho)` | Traz as janelas da Riot à frente. Se não há janela do cliente, abre a interface visível |
| `close_client()` | Fecha a Riot como o botão X dela, pelo [[riotAppControls]]. Devolve `CloseMode`. Usado só pela cópia do X nos [[cards]] |
| `read_login_screen_state(cancel)` | Estado sanitizado da tela de login ([[riotAuthentication]]), usado só para a visibilidade dos cartões |
| `dispose()` | Para o [[windowController]] |

Traits implementadas para os serviços: `RiotProbe`, `CloseIo`, `StartIo` e `SignInIo` aqui; `SignInRunner` ([[signInService]]), `KeeperRiot` ([[sessionKeeper]]), `WakeupRiot` ([[riotWakeup]]) e `RankRiot` ([[rankWatcher]]) nos módulos deles.

Funções soltas:

| Função | Descrição |
|---|---|
| `running_games()` | `RunningGames` (`lol`, `val`, `client`, `client_window`) a partir do `tasklist` (`parse_tasklist`, `running_games_in`) |
| `detect_client_path(escolhido)` | O caminho escolhido se existir; depois `rc_default` e `rc_live` de `C:/ProgramData/Riot Games/RiotClientInstalls.json`; depois `FALLBACK_CLIENT`. Senão `None`. `detect_client_path_with` troca o disco para os testes |
| `has_persisted_login(yaml)` | `true` se o YAML tem login lembrado |
| `strip_persisted_login(yaml)` | Remove o login lembrado e mantém só o `tdid` |
| `persisted_subject(yaml)` | O `sub` da conta dona do login lembrado: do cookie `sub` na lista de cookies, se houver (`cookie_subject`), senão do `id_token` (`id_token_claims`). Aceita só `[A-Za-z0-9-]{8,100}` |
| `persisted_riot_id(yaml)` | `RiotId` de `acct.game_name` e `acct.tag_line` no `id_token`, cortado em 64 e 16 unidades UTF-16 |
| `read_settings_yaml()`, `write_settings_yaml(texto)` | Lê (ou `None`) e grava o `RiotGamesPrivateSettings.yaml`. A gravação usa `replace_file`; a do [[sessionKeeper]] passa a versão esperada. Qualquer falha vira "Could not update the Riot Client settings file", sem caminho |
| `replace_file(arquivo, texto, esperado)` | Grava num temporário `eclipse-<uuid>.tmp` na mesma pasta e troca com `rename`. `replace_file_with` recebe o disco pela trait `SettingsFiles` e o relógio |
| `authorization_of(resposta)` | `Yes` com 200, `No` com 404, `Unknown` com qualquer outra resposta ou sem resposta |
| `close_everything(io, log)` | Fecha jogos e Riot antes de uma troca de conta, pela trait `CloseIo` |
| `start_client(io, caminho)` | A regra do `start_client`, pela trait `StartIo` |
| `request_launch(api, jogo, log)` | Pede a abertura de um jogo já verificado e devolve o motivo de recusa |
| `watch_settings(aviso)`, `watch_lockfile(aviso)` | Observam a pasta `Data` (só `RiotGamesPrivateSettings*`) e a pasta `Config` (só o `lockfile`) da Riot pela biblioteca `notify`. Pasta ausente devolve `None` |
| `run_login_script(executor, script, pedido, cancel)` | Roda o [[login.ps1]] com as credenciais só pela entrada padrão |
| `taskkill(nomes)` | Encerra processos pelo nome |

## Dependências

- Usa: [[signInFlow]], [[riotState]], [[gameRanks]], [[riotTransport]], [[riotAuthentication]], [[riotAppControls]], [[riotInterface]], [[riotProcess]], [[windowController]], [[windowsEnvironment]], [[paths]] (pasta dos helpers), [[login.ps1]] e `notify`.
- Usado por: [[main]] (abrir, fechar, tela de login, encerramento), [[appPorts]] (jogos abertos e sessão de quem sai), [[signInService]], [[sessionKeeper]], [[riotWakeup]] e [[rankWatcher]].
- **API sem o modo antigo.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saíram o início da cópia privada, o "mostrar cliente" e a leitura do estado de autenticação para fora. O [[signInFlow]] continua recebendo essa leitura pela `SignInIo`.

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

- **Estado da Riot pelo [[riotState]].** Desde 2026-11-07 ([[ADR-029 Estado da Riot definido num lugar só]]), o `RiotClient` implementa a `RiotProbe` com as consultas reais e entrega `look()`. O `close_everything` usa a mesma regra. As consultas soltas de "Riot rodando" e "autorizada" deixaram de sair do módulo; continuam internas, entregues ao [[signInFlow]].
- **Sem `error:focus` e sem interface escondida.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) saiu o ramo `error:focus`, que o [[login.ps1]] nunca emitia, e o `visible: true` explícito das chamadas ao [[riotInterface]], que agora sempre abre a interface visível.
- `open_client` usa o mesmo abridor quando os serviços já rodam sem interface; pede a janela ao backend antes de considerar outro início. Executar novamente apenas o exe não garantia uma janela.

- Para [[ADR-010 Login visível com progresso]], fornece ao fluxo a abertura da interface visível, pelo abridor existente, e o fechamento só dos processos de jogos, sem reiniciar a interface Riot. A confirmação de fechar jogos permanece nos [[cards]] antes da operação.

- **A API local é a fonte do estado de login.** Porta e senha estão no lockfile do cliente.
- **Estado só com metadados públicos.** `read_login_screen_state` e a leitura do estado entregue ao [[signInFlow]] reaproveitam a normalização de [[riotAuthentication]], sem expor tokens ou credenciais.
- **Troca de conta pelo "Stay signed in".** Depois que uma conta entra uma vez com a opção marcada, o `RiotGamesPrivateSettings.yaml` guarda esse login. O app mantém uma cópia por conta e a devolve antes de iniciar o cliente. O cliente então entra sozinho, sem janela nem digitação. Se a cópia falta ou expirou, as credenciais são enviadas pela API direta ou digitadas no formulário visível.
- **`client_window` olha só a interface.** `RiotClientServices.exe` roda em segundo plano sem janela. Por isso `client_window` considera só `Riot Client.exe` e `RiotClientUx.exe`.
- **Dois formatos de login lembrado.** Um `refresh_token` em `psl.authorization.riot-client` (Riot Client v141) ou um cookie `"ssid"` (versões antigas).
- **A dona do login lembrado vem do `sub`.** Desde 2026-11-06 ([[ADR-019 Sessão salva por conta no modo cartões]]). O Riot Client v141 não grava cookie `sub`: o login lembrado fica em `psl.authorization.riot-client`, e o `id_token` dali é um JWT cuja parte do meio traz `sub` e `acct` (`game_name`, `tag_line`). `id_token_claims` decodifica só essa parte (base64url e JSON), sem conferir assinatura. Qualquer erro dá `None`. Um cookie `sub` (formato antigo) ainda vale primeiro, e só dentro de um item da lista de cookies (linha começando com `-`). O [[sessionKeeper]] usa o `sub` contra o das sessões guardadas e o Riot ID como segunda prova.
- **Observar o arquivo da Riot para guardar a sessão.** `watch_settings` usa o aviso do Windows sobre a pasta `Data`. A Riot grava esse arquivo ao entrar, ao renovar a sessão e ao sair, e o [[sessionKeeper]] guarda cada versão. Encerrar a Riot conectada que ficou sem jogo é outra coisa: depende da olhada nos processos do guardião, a cada 4 s ([[ADR-020 Riot conectada é encerrada quando fica sem jogo]]).
- **O `lockfile` marca a troca de modo.** A Riot v142 regrava `Config\lockfile` ao entrar e ao sair do segundo plano (conferido em 2026-11-06). Em segundo plano, a API local só responde `/help`. O [[riotWakeup]] usa os dois fatos ([[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]).
- **`start_client` nunca mexe numa Riot aberta.** Diferente de `open_client`, não pede a janela ao serviço nem reinicia a Riot sem interface com `taskkill`. Confere os processos antes e depois do `reveal` do [[windowController]], porque o usuário pode abrir a Riot nesse meio-tempo. Só existe para a reabertura do [[sessionKeeper]] ([[ADR-026 Riot fechada depois do jogo reabre na tela de login]]).
- **`quit_client` é só a saída normal.** Nunca `taskkill` nem `DELETE /rso-auth/v1/session`. A Riot grava o login ao sair, e a sessão continua válida no servidor para a próxima restauração.
- **Limpar o login preserva o `tdid`.** `strip_persisted_login` troca o mapeamento `riot-client:` (os tokens) por `riot-client: null`. Em `riot-login.persist.session.cookies` fica só o cookie `tdid`, para a Riot continuar reconhecendo este computador.
- **Formato da lista de cookies.** Os itens ficam no mesmo recuo de `cookies:` ou mais fundo, e cada um começa com `-`.
- **`/rso-auth/v1/authorization` indica a conexão.** Responde 404 com o cliente desconectado e 200 com uma conta Riot conectada.
- **Fechar com pedido de saída primeiro.** Um cliente conectado, ou de estado desconhecido, recebe `quit` antes do `taskkill`, para gravar no disco a sessão mais recente. O YAML é lido só depois. Até 2026-11-06, um erro na leitura do estado levava direto ao `taskkill`, e um pedido recusado ainda esperava 10 s.
- **Estado da conta em três valores.** Desde 2026-11-06, `authorization()` devolve `'yes'` (200), `'no'` (404) ou `'unknown'` (outra resposta ou erro). Um 401, por exemplo, só diz que a credencial da API local foi recusada. Só `'no'` prova que não há conta, e o [[signInFlow]] só limpa um login pela metade nesse caso.
- **Gravação atômica do arquivo da Riot.** Desde 2026-11-06, a gravação usa um temporário na mesma pasta e troca com `rename` (no Windows, `MoveFileEx` com substituição). A Riot nunca lê um arquivo pela metade, e uma queda no meio deixa o original intacto.
  - O temporário se chama `eclipse-<uuid>.tmp` e não aciona o `watch_settings`, que só olha `RiotGamesPrivateSettings*`.
  - O conteúdo vai ao disco (`flush`) antes da troca.
  - Com o arquivo em uso (erros 5, 32 e 33 do Windows, os `EACCES`, `EBUSY` e `EPERM` do Node), tenta 5 vezes, a cada 100 ms.
  - Com a versão esperada, o arquivo é relido antes de cada troca, e nada é gravado se a Riot o mudou. Isso estreita a janela de corrida, mas não a fecha.
  - Temporários próprios com mais de 60 s, deixados por uma queda, são apagados. Nenhum outro arquivo da pasta é tocado.
  - Não há cópia do arquivo anterior: ela deixaria mais uma cópia dos tokens em texto puro no disco, e as sessões já ficam cifradas no [[store]].
- **Rota de digitação é só compatibilidade.** A digitação no formulário só roda quando a API de login direto não está disponível (ou exige o formulário nativo). A interface é sempre aberta visível. Se uma janela do cliente já existe, não abre outra.
- **Serviços headless não abrem interface sozinhos.** Até 2026-10-26, a digitação chamava `RiotClientServices.exe` de novo para abrir a interface. Com os serviços já em `--headless`, isso não abria janela nenhuma e o login falhava com "The Riot Client window did not open". A abertura agora é responsabilidade do [[riotInterface]].
- **`request_launch` registra e devolve o motivo de recusa.** Por exemplo, HTTP 424 `launch_failed_product_not_up_to_date` quando o jogo ainda precisa de atualização; com ele o [[signInFlow]] espera e repete o pedido (desde 2026-11-04). Quem decide o sucesso continua sendo o [[signInFlow]], pela janela do jogo.
- **Log da abertura só com valores fixos.** Desde 2026-11-07 o `request_launch` não grava mais até 300 caracteres de cada resposta. Pelo `sign-in.log` real, a elegibilidade responde um booleano, o pedido aceito uma string (o ID da abertura) e a recusa `{ errorCode, httpStatus, implementationDetails, message }`. Ficam de fora a mensagem, os detalhes, o ID e o texto de erro da rede, que podem trazer caminhos ou nomes. O código basta para o [[signInFlow]] reconhecer o jogo desatualizado.
- **O início da Riot nunca inclui um jogo.** O jogo só é pedido depois da verificação, por `request_launch`.
- **`login.ps1` com credenciais só pela entrada padrão.** O caminho vem da pasta dos helpers ([[paths]]). Um cancelamento ou os 90 s (`LOGIN_TIMEOUT_MS`) encerram a árvore inteira do PowerShell (`taskkill /T`), não só o processo de cima.

## Testes

`src-tauri/tests/riot/riot_client.rs`, com YAMLs sintéticos, pastas temporárias e fakes, cobre:

- `persisted_subject` pelo cookie `sub` (e um `sub` fora da lista de cookies ou com formato estranho não vale) e pelo `id_token` do formato atual; `id_token` ilegível ou com campos do tipo errado; Riot ID cortado nos limites da Riot; limpeza do login deixando só o cookie do aparelho;
- `replace_file`: troca inteira por um temporário da mesma pasta; arquivo mudado desde a leitura mantido; arquivo em uso tentado de novo, com a gravação da Riot durante a espera vencendo; falha de troca sem sobra de temporário; limpeza só dos temporários próprios antigos;
- `authorization_of`: 200, 404 e o resto;
- `close_everything`: saída normal depois dos jogos e força só depois; estado ilegível; Riot sem conta ou fechada sem pedido de saída; pedido recusado forçado na hora; Riot que não sai forçada depois da espera, e uma que não fecha parando a troca;
- `start_client`: Riot fechada iniciada com a interface depois de trazer a janela à frente; Riot rodando ou aberta no meio-tempo nunca iniciada, fechada ou reiniciada;
- `request_launch`: log só com status, elegibilidade e código bem formado; resposta ausente ou código estranho só com texto fixo; só jogos conhecidos;
- `detect_client_path` na ordem caminho escolhido, instalações da Riot e pasta padrão;
- a lista de processos achando jogos, serviços e a janela da Riot pelo nome.

Sem cobertura: os vigias de pasta, o `login.ps1` real e os `taskkill` e `tasklist` reais.

## Pontos de atenção

- **YAML editado por linhas.** `strip_persisted_login` para na primeira linha em branco dentro do bloco, aceita qualquer chave `riot-client:` recuada e devolve o texto com `\n` (CRLF vira LF). Um formato novo exige revisão: [[Atualização do Riot Client]].
- **Jogos fechados à força.** `close_everything` usa `taskkill /F` nos jogos. A confirmação do usuário fica fora deste módulo: os [[cards]] perguntam antes de trocar de conta com um jogo aberto. Conferido em 2026-11-06; a janela antiga e o caminho do addon saíram em 2026-11-07.
- **Caminhos fixos em `C:`.** Outra unidade depende do `RiotClientInstalls.json` ou do caminho nas configurações.
- **Caminho guardado.** O último caminho detectado vale para as chamadas seguintes da API local, que precisam dele para achar o certificado.
- **Identidade no `id_token`.** Conferido no Riot real em 2026-11-06 (em memória, sem mostrar valores): o `id_token` traz `sub` e `acct`. Se a Riot mudar o formato, `persisted_subject` e `persisted_riot_id` devolvem `None` e o [[sessionKeeper]] deixa o login no arquivo da Riot.
