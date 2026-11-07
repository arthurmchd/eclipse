---
tipo: módulo
arquivo: src/core/store.js
camada: aplicação
testes: test/core/store.test.js
tags: [módulo]
---

# store

> Armazenamento persistente de contas, configurações e sessões salvas do Riot Client, com segredos criptografados pelo `safeStorage` do Electron.

## Responsabilidade

- Lê e grava `data.json` na pasta `userData` do Electron, de forma atômica.
- Mantém backups rotativos em `backups/` e recupera deles quando `data.json` falha.
- Criptografa senhas, chaves de API e sessões, e entrega ao resto do app só versões públicas.
- Guarda uma sessão por conta em `sessions/<id>.bin`.
- **Não** impede edição durante o login (isso é do [[main]]) e não fala com a Riot.

## API pública

Exporta só a classe `Store`.

| Export | Tipo | Descrição |
|---|---|---|
| `new Store()` | construtor | Define `dir`, `file`, `sessionsDir`, `backupsDir`, carrega os dados e cria um backup se há contas e nenhum backup |
| `data` | propriedade | `{ accounts, settings, lastRefresh, currentAccountId }`; o [[main]] lê e altera direto |
| `log(line)` | método | Acrescenta uma linha em `data.log` |
| `save()` | método | Grava `data.json` e faz backup se campos relevantes mudaram |
| `listBackups()` | método | Nomes `data-*.json`, do mais novo ao mais antigo |
| `publicAccount(acc)`, `listAccounts()` | métodos | Conta sem `password`, com `hasPassword` e `hasSession` |
| `getAccount(id)` | método | Conta crua, com a senha criptografada |
| `upsertAccount(input)` | método | Cria ou edita a conta; devolve a versão pública |
| `deleteAccount(id)` | método | Apaga sessão e conta; zera `currentAccountId` se for ela |
| `updateAccountFields(id, fields)` | método | `Object.assign` e `save`; `null` se a conta não existe |
| `getPassword(id)` | método | Senha em texto puro, ou `''` |
| `sessionFile`, `hasSession`, `saveSession`, `loadSession`, `forgetSession` | métodos | Sessões salvas |
| `sessionSavedAt(id)` | método | Data da última gravação da sessão (`mtimeMs` do `sessions/<id>.bin`), ou `0` sem sessão. ID inválido lança erro. |
| `setCurrentAccount(id)` | método | Grava a última conta conectada |
| `publicSettings()` | método | Configurações com chaves mascaradas (`riotApiKeyMasked`, `riotTftApiKeyMasked`, `henrikApiKeyMasked`) |
| `updateSettings(input)` | método | Aplica configurações e chaves |
| `getKeys()` | método | `{ riot, tft, henrik }` em texto puro, para o [[rankApi]]; chave ilegível vem vazia |

## Dependências

- Usa: `electron` (`app`, `safeStorage`), `fs`, `path`, `crypto`.
- Usado por: [[main]] e [[signInService]].

## Invariantes e decisões

- **`staySignedIn`** (padrão `true`) guarda a opção "Manter login". `publicSettings` devolve `true` quando o campo não existe, para dados antigos. Adicionado em 2026-11-04.
- **Segredos só com DPAPI.** Senhas e chaves de API são criptografadas com `safeStorage`, que no Windows usa DPAPI: só este usuário do Windows consegue descriptografar. Sem criptografia disponível, `encrypt` lança erro em vez de gravar texto puro.
- **Formato.** Em `data.json` os segredos ficam em base64. No `.bin` da sessão vão os bytes criptografados crus.
- **Padrões.** `riotApiKey`, `riotTftApiKey` e `henrikApiKey` ficam criptografadas. A de TFT é opcional, porque chaves pessoais de TFT são separadas. `riotClientPath` vazio significa detectar automaticamente. Demais: `refreshMinutes: 30`, `staySignedIn` ligado e `language: 'pt'`.
- **Opções do modo antigo são limpas.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), `minimizeOnLaunch`, `hideRiotClient`, `closeRiotClient` e `streamerMode` saíram dos padrões, de `publicSettings` e de `updateSettings`. `parse` apaga essas chaves de um `data.json` ou backup antigo ao carregar (`RETIRED_SETTINGS`); o próximo `save` grava o arquivo sem elas.
- **Limpeza de nomes.** Nomes copiados do Riot Client trazem marcas invisíveis de direção (U+2066…2069) e caracteres parecidos que fazem toda consulta à API falhar. `cleanName` remove U+200B–200F, U+202A–202E, U+2066–2069 e U+FEFF ao carregar e ao salvar. A `tagLine` também perde um `#` inicial.
- **Log sem credenciais.** Eventos de dados, nunca credenciais, vão para `data.log`, para explicar qualquer conta perdida. O arquivo vira `.old` acima de 200 KB.
- **Arquivo ilegível é preservado.** Se `data.json` existe mas não abre, é copiado para `data.json.corrupt-<timestamp>` em vez de ser sobrescrito em silêncio. Depois tenta os backups, do mais novo ao mais antigo; sem nenhum válido, começa vazio. A mesma recuperação roda quando `data.json` não existe.
- **Gravação atômica.** `save` escreve em `data.json.tmp` e renomeia. Falha é registrada e relançada.
- **Backup só quando o usuário edita.** Faz backup das edições do usuário sem criar outro a cada refresh de elo ou horário de lançamento. A comparação usa só `BACKUP_ACCOUNT_FIELDS` (`id`, `createdAt`, `gameName`, `tagLine`, `region`, `valRegion`, `username`, `password`, `note`, `lastSeason`, `ban`, `pinned`) e `settings`. Senhas e chaves seguem criptografadas no backup, que contém o `data.json` inteiro.
- **30 backups.** Uma cópia a cada mudança de conta ou configuração; ficam as 30 mais novas. O nome usa um horário estritamente crescente (`lastBackupTime`) e um UUID, para não colidir e ordenar por nome.
- **O renderer nunca vê a senha.** `publicAccount` remove `password` e expõe só `hasPassword` e `hasSession`.
- **Senha vazia mantém a atual.** Na edição, campo de senha vazio significa "manter a atual".
- **Sessão pertence a um login.** Usuário ou senha novos significam login novo. Por isso `upsertAccount` apaga a sessão nesses casos.
- **O que é a sessão.** Cópia do `RiotGamesPrivateSettings.yaml` do Riot Client, tirada enquanto a conta estava conectada com "Manter conectado" e criptografada como as senhas.
- **ID validado antes do disco.** Hoje os IDs são UUIDs; IDs simples antigos continuam aceitos. `sessionFile` rejeita separadores, pontos e sintaxe de caminho ou stream do Windows antes de tocar no disco: exige `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$` e recusa `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`.
- **Troca de sessão segura.** `saveSession` grava num `.tmp` único (`flag: 'wx'`, `mode: 0o600`) e renomeia. Uma substituição que falha precisa deixar a sessão anterior utilizável; o `.tmp` sai no `finally`.
- **Sessão só de conta existente.** `saveSession` e `forgetSession` lançam `Account not found`. `loadSession` devolve `null` em qualquer erro.
- **A data da sessão é a do arquivo.** `sessionSavedAt` lê só a data do `sessions/<id>.bin`, sem decifrar. O [[sessionKeeper]] a usa para apagar sessões de antes do modo cartões ([[ADR-022 Sessões de antes do modo cartões são descartadas]]). Adicionado em 2026-11-06.
- **Chave ilegível não trava as contas.** Uma chave que não pode ser descriptografada não pode impedir as contas de carregar. `publicSettings` registra o erro e mostra `(unreadable, paste it again)`. Desde 2026-11-07 o `getKeys()` também: a chave ilegível vem vazia, o `data.log` recebe só o nome do campo ("could not decrypt the saved riotTftApiKey, skipped it"), e o refresh segue com as outras chaves. Antes a exceção derrubava o refresh de todas as contas até a chave ser colada de novo. Sem a chave, o [[rankApi]] trata aquele jogo como sem chave; uma chave de TFT ilegível cai na chave da Riot, como quando não há chave de TFT.
- **Máscara.** Primeiros 8 e últimos 4 caracteres da chave.
- **Chaves em `updateSettings`.** `undefined` = não mexe, `''` = remove, outro valor = substitui (com `trim`).
- **`language`** (padrão `'pt'`) guarda o idioma do Eclipse. `publicSettings` devolve `'en'` só quando o valor salvo é exatamente `'en'`; qualquer outro valor, inclusive dados antigos sem o campo, vira `'pt'`. Adicionado em 2026-11-04 ([[ADR-014 Interface em português e inglês]]).

## Testes

`test/core/store.test.js` carrega o módulo em `vm`, com `safeStorage` falso e pasta temporária. Cobre: rejeição de travessia de caminho, nomes reservados, IDs inválidos e contas desconhecidas; ida e volta de sessão criptografada com UUID e ID legado; `sessionSavedAt` com a data do arquivo, `0` sem sessão e erro para ID inválido; falha de `rename` preservando a sessão anterior sem sobrar `.tmp`; backup disparado por nota e configuração, mas não por `stats`, `puuidCache`, `lastPlayed`, `lastGame` ou `setCurrentAccount`; opções do modo antigo apagadas ao carregar, ausentes do arquivo salvo e ignoradas por `updateSettings`; chave ilegível vazia no `getKeys()` sem afetar as outras, mascarada no `publicSettings` e ausente do `data.log`.

Fora: recuperação de `data.json` corrompido, limite de 30 backups e `cleanName`.

## Pontos de atenção

- `publicAccount` chama `hasSession`, que lança erro para ID fora do padrão. Uma conta antiga assim derruba `listAccounts` e o `init` inteiro.
- Se `copyFileSync` falhar ao preservar um `data.json` ilegível (por exemplo, sem permissão), o construtor lança e o app não abre.
- `updateSettings` aceita `''` para remover chave, mas os [[cards]] nunca enviam `''`.
- Backups e sessões só abrem no mesmo usuário Windows. Ver [[Armazenamento e dados]] e [[Segurança e privacidade]].
