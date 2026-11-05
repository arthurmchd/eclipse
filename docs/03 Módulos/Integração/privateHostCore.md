---
tipo: módulo
arquivo: src/integration/host/privateHostCore.js
camada: integração
testes: [test/integration/host/privateHost.test.js, test/integration/host/privateVersion142.test.js, test/integration/host/privateArchive.test.js]
tags: [módulo]
---

# privateHostCore

> Regras puras do host privado: endurece o `main.js` do Riot, prepara o Electron antes do `ready`, monta os argumentos sintéticos e valida o pedido de abertura.

## Responsabilidade

Na preparação, reescreve o `main.js` do Riot para que o token não vá para o log e para que o Sentry aceite ser iniciado depois do `ready`. No host, faz o registro pré-`ready`, valida o pedido contra o manifesto e os arquivos, e gera `argv`. Não lê o canal nem controla janelas; isso é [[privateHost]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `SUPPORTED_VERSIONS`, `isSupportedVersion(v)` | constante, função | Versões aceitas: `141.0.0` e `142.0.0`. |
| `SUPPORTED_VERSION` | constante | `141.0.0`. Exportada, sem uso no código. |
| `PRIVATE_LOG_GUARD_MARKER`, `PRIVATE_COMPATIBILITY_MARKER`, `PRIVATE_BOOTSTRAP_SYMBOL` | constantes | Marcadores e nome do símbolo global. |
| `ORIGINAL_PROTOCOL_BOOTSTRAP`, `ORIGINAL_PROTOCOL_BOOTSTRAP_142` | constantes | Âncoras do `configureProtocol` original. |
| `hasUnsafeStartupLog(source)` | função | `true` se ainda houver o log de inicialização com `cliArgs`. |
| `hardenPrivateMainSource(source)` | função | Aplica o guarda de log e a compatibilidade pré-`ready`. Idempotente. |
| `preparePrivateHostBeforeReady(electron, { globalObject })` | função | Desliga GPU e registra `sentry-ipc` antes do `ready`. |
| `buildLaunchArguments(config)` | função | Monta os argumentos sintéticos do main do Riot. |
| `validateHostRequest(request, { workspaceRoot })` | função | Valida o pedido e devolve a configuração do host. |

## Dependências

- Usa: [[asar]], [[privateRendererCore]] (`PRIVATE_RENDERER_MFA_MARKER`), [[paths]] (`PROJECT_ROOT`).
- Usado por: [[privateHost]], [[privateClient]] (`isSupportedVersion`), [[Scripts de integração]].

## Invariantes e decisões

**Marcadores.**

| Marcador | Prova | Quem confere |
|---|---|---|
| `RAM_PRIVATE_HOST_LOG_GUARD_V1` | O log de `cliArgs` foi trocado pelo guarda que redige o token. | `hardenBuffer` e a releitura no script de preparação; `validateHostRequest`. O manifesto registra isso em `privacy`, que [[privateClient]] também lê. |
| `RAM_PRIVATE_HOST_PRE_READY_COMPAT_V1` | O `configureProtocol` original foi trocado pela versão que aceita o registro pré-`ready`. | `hardenPrivateMainSource` (idempotência); `validateHostRequest`. |
| `RAM_LOGIN_INTEGRATION_V1` | Os três [[addons]] foram anexados (vem de [[asar]]). | `validateHostRequest`; [[status]] no legado. |
| `RAM_PRIVATE_RENDERER_MFA_CONTEXT_V1` | Adaptador de MFA aplicado na 142 (ver [[privateRendererCore]]). | `validateHostRequest`, só na 142. |

**Âncoras no código minificado do Riot.** Quebram quando o Riot muda o bundle.

- Log de inicialização: regex `<id>.info("Starting RiotClientUx electron with args",cliArgs)`. Precisa aparecer uma única vez. `<id>` é capturado (era `log$d`) e reaproveitado no guarda.
- 141: `ORIGINAL_PROTOCOL_BOOTSTRAP`, de `function configureProtocol(t){if(require$$0$f.app.isReady())throw new SentryError$1(...` até `,whenAppReady.then`. Usa `PROTOCOL_SCHEME`.
- 142: `ORIGINAL_PROTOCOL_BOOTSTRAP_142`, de `function configureProtocol(t,e,r){if(electron.app.isReady())throw new Error(...` até `const n=createRendererEventLoopBlockStatusHandler(t);`. Usa `e.namespace`.
- Exatamente uma das duas âncoras de protocolo deve existir, e uma vez só.
- Em tempo de execução, o guarda ainda depende de `<id>.hooks` ser um array e de `cliArgs.remotingAuthToken`.
- Se o código já tem um dos dois marcadores, precisa ter os dois, sem log inseguro e sem âncora original; senão é "inconsistente". O resultado novo é compilado com `new Function` só para checar a sintaxe, sem executar.

**Guarda de log.** Roda no escopo léxico da própria cópia, antes do primeiro log de argumentos. Só copia `message.data` para o log; nunca altera a configuração de autenticação HTTP. Redige o token, sua forma `encodeURIComponent` e o Base64 de `riot:<token>`, trocando por `[redacted]`. Se `hooks` não existir ou o token estiver vazio, lança erro antes de logar. Em vez dos argumentos, loga "Starting private Riot UI".

**Compatibilidade pré-`ready`.** O main é carregado depois do `ready`, mas o `configureProtocol` original lança erro nesse caso.
- A versão nova procura o estado em `globalThis[Symbol.for('riot-account-manager.private-host.bootstrap.v1')]`: `version` 1, `gpuDisabled` e `protocolRegistered` verdadeiros, esquema `sentry-ipc` e exatamente os quatro privilégios `true`.
- Se a preparação síncrona não ocorreu, o registro original ainda roda, e o erro após o `ready` continua igual.
- Se ocorreu, reaproveita o mesmo esquema e segue para o registro de handlers original sem pulá-lo. Na 142, o `Proxy` sobre `registerSchemesAsPrivileged` continua sendo instalado.
- `preparePrivateHostBeforeReady` só aceita app ainda não pronto e recusa um segundo registro. O estado é congelado.
- Desligar a aceleração de hardware preserva o padrão de renderização por software do Riot. A flag sintética `--enableHardwareAcceleration=true` só impede o main de repetir essa chamada depois do `whenReady`.

**Argumentos sintéticos.** `--appPort`, `--remotingAuthToken`, `--appPid`, `--userDataRoot`, `--logDir`, `--enableHardwareAcceleration=true` e `private-local` em `--crashpadEnvironment`, `--machineId` e `--sessionId`. O array só é atribuído a `process.argv` em memória. Nunca pode ir para `child_process.spawn`, stdout, stderr ou log. Porta de 1 a 65535; PID de 1 a `0xffffffff`; token de 1 a 4096 caracteres, sem espaço nem controle.

**Ordem de `validateHostRequest`.**
1. Objeto com exatamente sete chaves: `candidatePath`, `manifestPath`, `appPort`, `appPid`, `encryptedAuthToken`, `userDataRoot`, `logDir`.
2. `candidatePath` e `manifestPath` absolutos, reais e dentro do workspace.
3. Candidato chamado `app.asar` na mesma pasta do manifesto.
4. `encryptedAuthToken` em Base64 válido, até 32768 caracteres. Um token em texto puro não passa.
5. Porta e PID válidos (o token só é validado depois de decifrado).
6. Manifesto de 2 B a 128 KiB, `schemaVersion` 1, com `source`, `candidate` e `changedFiles`.
7. `mode` `private-host` e as duas garantias de `privacy`.
8. Origem diferente do candidato; `candidate.path` do manifesto igual ao candidato.
9. Tamanho e SHA-256 da origem instalada e do candidato iguais ao manifesto.
10. `package.json` da origem, do candidato e do manifesto: `riot-client-ux`, main `./dist/main/main.js`, versão suportada e igual nos três.
11. Na 142: `externalMultifactorRecovery` e o marcador de MFA no renderer do candidato.
12. As três entradas batem com `changedFiles` (tamanho e hash) e contêm `RAM_LOGIN_INTEGRATION_V1`.
13. `main.js` com guarda de log e sem log inseguro; com compatibilidade e sem âncoras originais.
14. Só então cria `userDataRoot`, `logDir` e `private-electron-profile`, conferindo o ancestral existente mais próximo antes de criar (modo `0o700`).

## Testes

`privateHost.test.js`: endurecimento único e idempotente, redação de token simples, Basic e URL, falha se o hook mudar, argumentos sem chaves perigosas, registro pré-`ready` com e sem preparação, e cada recusa de `validateHostRequest`. `privateVersion142.test.js`: o mesmo para a 142. `privateArchive.test.js`: via script de preparação.

## Pontos de atenção

- Toda atualização do Riot pode mover as âncoras. A preparação falha fechada. Ver [[Atualização do Riot Client]].
- `UNSAFE_STARTUP_LOG` está declarada e não é usada. `SUPPORTED_VERSION` sugere uma única versão.
- Entradas acima de 20 MiB fazem a validação falhar.
