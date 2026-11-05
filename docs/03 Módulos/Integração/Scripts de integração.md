---
tipo: módulo
arquivo: [scripts/integration/prepare-private-riot-host.js, scripts/integration/probe-private-riot-host.js, scripts/legacy/prepare-riot-integration.js, scripts/legacy/install-riot-integration.ps1]
camada: integração
testes: [test/integration/host/privateArchive.test.js, test/integration/clientArchive.test.js]
tags: [módulo]
---

# Scripts de integração

> Scripts de linha de comando que preparam e testam a cópia privada da interface do Riot, mais os dois scripts do experimento legado.

## Responsabilidade

- `prepare-private-riot-host.js`: gera `.client-integration/private-v1/embedded-v1/app.asar` e `manifest.json` a partir do `app.asar` instalado. O destino novo mantém a cópia anterior em seu lugar.
- `probe-private-riot-host.js`: abre a cópia privada uma vez e grava se o painel carregou e falou com a ponte.
- `legacy/prepare-riot-integration.js`: gera o candidato do experimento legado em `.client-integration/app.asar`.
- `legacy/install-riot-integration.ps1`: troca o `app.asar` instalado pelo candidato legado, ou restaura o backup.

Nenhum deles roda no fluxo normal do app. O atalho usa só a cópia privada, via [[privateClient]].

## API pública

| Comando npm | Executa |
|---|---|
| `npm run integration:prepare-private` | `node scripts/integration/prepare-private-riot-host.js [--source app.asar] [--output pasta/app.asar]` |
| `npm run integration:probe-private` | `electron scripts/integration/probe-private-riot-host.js` |
| `npm run legacy:prepare-install` | `node scripts/legacy/prepare-riot-integration.js [--source] [--output]` |
| (sem npm) | `install-riot-integration.ps1 -Manifest <arquivo> [-Restore]` |

Exports para testes: `preparePrivate`, `hardenBuffer`, `PRIVATE_LOG_GUARD`, `UNSAFE_STARTUP_LOG` (privado); `prepare`, `withinRoot` (legado).

## Dependências

- Usa: [[asar]], [[privateHostCore]], [[privateRendererCore]], [[addons]], [[windowsDpapi]], [[paths]]; o probe usa também [[privateClient]], [[backend]] e [[bridgeServer]].
- Usado por: [[Desenvolvimento]] e [[Atualização do Riot Client]] (preparar de novo após cada atualização).

## Invariantes e decisões

**Preparação privada.**
- **Nada é escrito na instalação do Riot.** Nem executáveis, nem configuração, nem dados do usuário. Só a cópia dentro do workspace.
- **Saída dentro do workspace.** O destino precisa se chamar `app.asar` e ficar dentro do projeto. A checagem se repete após `realpath` da pasta, para recusar uma pasta ligada por link simbólico para fora.
- **Nunca reaproveita.** Se o candidato ou o manifesto já existem, falha e pede uma pasta nova.
- **Origem validada.** Pacote `riot-client-ux`, main `./dist/main/main.js`, versão suportada e as três entradas presentes.
- **Addons preparados.** Cada addon tem o `__RAM_DPAPI_HELPER_BASE64__` trocado pelo comando DPAPI e passa por `new Function` para checar a sintaxe. Os addons são scripts independentes, sem `import`.
- **Transformações.** `main.js` passa por `hardenPrivateMainSource` e precisa sair com o guarda de log e sem o log inseguro. `renderer.js` passa por `hardenPrivateRendererSource` com a versão da origem.
- **Origem intacta.** O SHA-256 da origem é recalculado no fim. Se mudou, o Riot se atualizou durante a preparação e o candidato é apagado.
- **Confere a entrada que roda.** O candidato é reaberto e o `dist/main/main.js` apontado pelo cabeçalho é verificado. Os bytes antigos que o gravador append-only deixa no payload não contam: só a entrada do cabeçalho executa.
- **Manifesto.** `schemaVersion` 1, `mode: 'private-host'`, hashes e tamanhos de origem e candidato, `changedFiles`, `privacy.startupArgumentsRedacted`, `privacy.logGuardInstalled` e `behavior.fullManagerInClient` verdadeiros, e `behavior.externalMultifactorRecovery` verdadeiro só na 142. Gravado com `wx`.

**Probe.**
- **Somente leitura.** Não inicia processo do Riot e nunca pede login, logout, abertura de jogo ou mudança em conta salva. O único processo iniciado é o host privado.
- **Backend já de pé.** `ensureBackend` só lê o `lockfile`; não inicia o serviço do Riot.
- **Ponte própria se preciso.** Sem descoberta em `%APPDATA%\riot-account-manager\`, sobe uma ponte com lista vazia e `signIn` que sempre falha.
- **Resultado.** Grava `private-v1/probe-controller/result.json` com `ok`, `rendererReady`, `managerConnected`, `mode`, `authenticationTested: false` e dados do runtime. Sai com 0 só se o painel carregou e a ponte respondeu.

**Legado.**
- **Candidato só no workspace.** O preparo legado nunca escreve na instalação. Não confere versão nem aplica transformações. O manifesto não tem `mode` nem `privacy`.
- **Instalador recusa a cópia privada.** Manifesto com `mode: 'private-host'` nunca é instalado.
- **Só candidato verificado.** Aplica apenas um candidato preparado e conferido por hash. Exige Riot, League e VALORANT fechados. Nunca altera executável nem desliga configuração de segurança.
- **Alvos estritos.** Manifesto e arquivos regulares, sem links. Origem terminando em `RiotClientElectron\resources\app.asar`. Candidato `app.asar` ao lado do manifesto. Hashes válidos e diferentes.
- **Backup verificado.** `<app.asar>.ram-backup` e `.ram-backup.json` são criados uma vez e conferidos depois. Um backup de outra versão bloqueia a instalação.
- **Reconferência antes da troca.** O hash do destino é verificado logo antes da troca atômica. Assim não se sobrescreve uma atualização do Riot que terminou durante a cópia.
- **`NullString` no `Replace`.** O Windows PowerShell converte `$null` em string vazia para parâmetro string. `NullString` mantém o argumento de backup realmente nulo.
- **Rollback cuidadoso.** Se a instalação falhar, só restaura quando o destino é exatamente o candidato. Nunca sobrescreve um arquivo trocado pelo atualizador do Riot ou por outro programa.
- **`-Restore`.** Volta ao backup verificado e o mantém. Se o arquivo já é o original, não faz nada. Se mudou depois da instalação, recusa.

## Testes

`privateArchive.test.js`: redação dos argumentos no main lógico com a origem intacta; falha sem o logger esperado; recusa de log duplicado; recusa de alvo na instalação ou fora do workspace. `clientArchive.test.js`: preparo legado com manifesto e limite de workspace; no Windows, o instalador num arquivo de teste (recusa `private-host`, instala, restaura e recusa restaurar após uma "atualização"). O probe não tem teste.

## Pontos de atenção

- O caminho do Riot é fixo em `C:/Riot Games/...` no probe e no padrão de `--source`. Ver [[Limitações conhecidas]].
- O preparo legado não confere versão, mas [[status]] só aceita a 141.
- `UNSAFE_STARTUP_LOG` está duplicada aqui e em [[privateHostCore]].
- A cópia privada precisa ser refeita a cada atualização do Riot. Ver [[Atualização do Riot Client]] e [[Backlog]].
