---
tipo: módulo
arquivo: src-tauri/src/application/store.rs
camada: aplicação
testes: src-tauri/tests/application/store.rs
tags: [módulo]
---

# store

> Armazenamento persistente de contas, configurações e sessões salvas do Riot Client, com segredos criptografados pelo [[safeStorage]].

## Responsabilidade

- Lê e grava `data.json` em `%APPDATA%\riot-account-manager\`, de forma atômica.
- Mantém backups rotativos em `backups/` e recupera deles quando `data.json` falha.
- Criptografa senhas, chaves de API e sessões, e entrega ao resto do app só versões públicas.
- Guarda uma sessão por conta em `sessions/<id>.bin`.
- Grava o `data.log` e o `sign-in.log`.
- **Não** impede edição durante o login (isso é do [[managerService]] e do [[main]]) e não fala com a Riot.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `Store::open(pasta, cipher)` | construtor | Carrega os dados da pasta com o `Cipher` do [[safeStorage]] e cria um backup se há contas e nenhum backup |
| `data` | campo | `StoreData { accounts, settings, last_refresh, current_account_id }`; o [[main]] e o [[appPorts]] leem e alteram direto |
| `log(linha)`, `sign_in_log(linha)` | métodos | Acrescentam uma linha em `data.log` ou `sign-in.log` |
| `save()` | método | Grava `data.json` e faz backup se campos relevantes mudaram |
| `list_backups()` | método | Nomes `data-*.json`, do mais novo ao mais antigo |
| `public_account(conta)`, `list_accounts()` | métodos | Conta sem `password`, com `hasPassword` e `hasSession` |
| `get_account(id)` | método | Conta crua, com a senha criptografada |
| `upsert_account(AccountInput)` | método | Cria ou edita a conta; devolve a versão pública |
| `delete_account(id)` | método | Apaga sessão e conta; zera `current_account_id` se for ela |
| `update_account_fields(id, campos)` | método | Junta os campos e salva; `None` se a conta não existe |
| `get_password(id)` | método | Senha em texto puro, ou vazia |
| `session_file`, `has_session`, `save_session`, `load_session`, `forget_session` | métodos | Sessões salvas |
| `session_saved_at(id)` | método | Data da última gravação da sessão (data do `sessions/<id>.bin`), ou `0` sem sessão. ID inválido dá erro |
| `set_current_account(id)` | método | Grava a última conta conectada |
| `public_settings()` | método | Configurações com chaves mascaradas (`riotApiKeyMasked`, `riotTftApiKeyMasked`, `henrikApiKeyMasked`) |
| `update_settings(SettingsInput)` | método | Aplica configurações e chaves |
| `get_keys()` | método | `ApiKeys { riot, tft, henrik }` em texto puro, para o [[rankApi]]; chave ilegível vem vazia |
| `ServiceStore` | trait | O que os serviços veem do store; implementada para `Mutex<Store>` |
| `stay_signed_in`, `client_path`, `account_id`, `account_riot_id` | funções | Leituras comuns sobre um `ServiceStore` ou uma conta |
| `clean_name`, `default_settings`, `RETIRED_SETTINGS` | funções e constante | Limpeza de nomes, padrões e opções do modo antigo |

## Dependências

- Usa: [[safeStorage]] (pela trait `Cipher`), `serde_json`, `uuid`, `chrono`.
- Usado por: [[main]], [[appPorts]], [[signInService]], [[sessionKeeper]], [[rankWatcher]] e [[refresher]].

## Invariantes e decisões

- **Jogos (2026-11-15; cinco jogos em 2026-11-20).** `upsert_account` grava `games` vindo do [[managerService]], na ordem de `ACCOUNT_GAMES` (`lol`, `val`, `tft`, `2xko`, `lor`); `games` vazio vira os cinco. O `data.json` leva `"schema": 2` desde a 2.11.0. Ao ler um arquivo sem ele (ou um backup antigo), `games` é traduzido para as abas em que a conta já aparecia: `["lol","val"]` vira os cinco, `["lol"]` vira League, TFT, 2XKO e Runeterra, `["val"]` vira VALORANT, 2XKO e Runeterra. Sem o número, uma escolha nova de League e VALORANT não se distinguiria do "todos" antigo. Conta nova começa com `pinned: false` e `signInCount: 0`. `games` entra no instantâneo dos backups; `signInCount` não, como `lastPlayed`. As etiquetas (`tags`) saíram em 2026-11-19: salvar a conta apaga as antigas, como a cor, e elas não entram mais nos backups.
- **Sem cor (2026-11-18).** A cor do cartão saiu a pedido do usuário. `upsert_account` apaga um `color` que tenha ficado de 2.5.0 quando a conta é salva, e os backups não o copiam mais. O `note` continua gravado como antes.
- **Várias contas num salvamento só.** `add_accounts` cria todas e grava uma vez; se a gravação falhar, nenhuma fica na memória.
- **Ordem manual.** `reorder_accounts` só aceita uma permutação exata dos ids salvos (sem faltar, sobrar nem repetir) e recusa com "The account list changed"; em falha de gravação, a ordem anterior volta. A ordem é a do próprio vetor `accounts` do `data.json`.
- **`cardSort`** fica em `manual`, `rank`, `name` ou `recent`; qualquer outro valor salvo aparece como `manual`.
- **`uiSounds`** (padrão `true` desde a 2.15.1; `false` na 2.15.0) guarda "Sons da interface" ([[sounds]]). Só um `false` salvo desliga; campo ausente ou de outro tipo aparece como `true`, como o `staySignedIn`. Adicionado em 2026-11-20.
- **Mesmo formato do Electron.** Lê e grava o mesmo `data.json`, os mesmos backups e as mesmas sessões que o Eclipse em Electron gravava, sem conversão ([[ADR-032 Migração para Tauri e Rust]]). Conferido em 2026-11-15: o usuário abriu o Eclipse 2.0.0 instalado e as contas reais abriram normalmente.
- **Campos desconhecidos são preservados.** As contas ficam como objetos JSON com a ordem das chaves preservada, para um campo que o Rust não conhece (como `puuidCache`) não sumir ao salvar.
- **`staySignedIn`** (padrão `true`) guarda a opção "Manter login". `public_settings` devolve `true` quando o campo não existe, para dados antigos. Adicionado em 2026-11-04.
- **Segredos só com DPAPI.** Senhas e chaves de API são criptografadas pelo [[safeStorage]]: só este usuário do Windows consegue descriptografar. Sem criptografia disponível, a gravação falha em vez de gravar texto puro.
- **Formato.** Em `data.json` os segredos ficam em base64. No `.bin` da sessão vão os bytes criptografados crus.
- **Padrões.** `riotApiKey`, `riotTftApiKey` e `henrikApiKey` ficam criptografadas. A de TFT é opcional, porque chaves pessoais de TFT são separadas. `riotClientPath` vazio significa detectar automaticamente. Demais: `refreshMinutes: 30`, `staySignedIn` ligado e `language: 'pt'`.
- **Opções do modo antigo são limpas.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), `minimizeOnLaunch`, `hideRiotClient`, `closeRiotClient` e `streamerMode` (`RETIRED_SETTINGS`) saíram dos padrões, de `public_settings` e de `update_settings`, e são apagadas de um `data.json` ou backup antigo ao carregar; o próximo `save` grava o arquivo sem elas.
- **Limpeza de nomes.** Nomes copiados do Riot Client trazem marcas invisíveis de direção (U+2066…2069) e caracteres parecidos que fazem toda consulta à API falhar. `clean_name` remove U+200B–200F, U+202A–202E, U+2066–2069 e U+FEFF ao carregar e ao salvar. A `tagLine` também perde um `#` inicial.
- **Logs sem credenciais.** Eventos de dados, nunca credenciais, vão para `data.log`, para explicar qualquer conta perdida. O `sign-in.log` recebe as linhas do login e da sobreposição. Os dois viram `.old` acima de 200 KB.
- **Arquivo ilegível é preservado.** Se `data.json` existe mas não abre, é copiado para `data.json.corrupt-<timestamp>` e o `data.log` registra. Depois tenta os backups, do mais novo ao mais antigo; sem nenhum válido, começa vazio. A mesma recuperação roda quando `data.json` não existe.
- **Gravação atômica.** `save` escreve em `data.json.tmp` e renomeia. Falha é registrada e devolvida como erro.
- **Backup só quando o usuário edita.** Faz backup das edições do usuário sem criar outro a cada refresh de elo ou horário de lançamento. A comparação usa só `id`, `createdAt`, `gameName`, `tagLine`, `region`, `valRegion`, `username`, `password`, `note`, `lastSeason`, `ban`, `pinned` e `settings`. Senhas e chaves seguem criptografadas no backup, que contém o `data.json` inteiro.
- **30 backups.** Uma cópia a cada mudança de conta ou configuração; ficam as 30 mais novas. O nome usa um horário estritamente crescente e um UUID, para não colidir e ordenar por nome.
- **Os cartões nunca veem a senha.** `public_account` remove `password` e expõe só `hasPassword` e `hasSession`.
- **Senha vazia mantém a atual.** Na edição, campo de senha vazio significa "manter a atual".
- **Sessão pertence a um login.** Usuário ou senha novos significam login novo. Por isso `upsert_account` apaga a sessão nesses casos.
- **O que é a sessão.** Cópia do `RiotGamesPrivateSettings.yaml` do Riot Client, tirada enquanto a conta estava conectada com "Manter conectado" e criptografada como as senhas.
- **ID validado antes do disco.** Hoje os IDs são UUIDs; IDs simples antigos continuam aceitos. `session_file` rejeita separadores, pontos e sintaxe de caminho ou stream do Windows antes de tocar no disco: exige `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$` e recusa `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`. `has_session` devolve erro para um ID assim; `public_account` e o `ServiceStore` o tratam como sem sessão.
- **Troca de sessão segura.** `save_session` grava num `.tmp` único e renomeia. Uma substituição que falha deixa a sessão anterior utilizável, e o `.tmp` é apagado.
- **Sessão só de conta existente.** `save_session` e `forget_session` dão `Account not found`. `load_session` devolve `None` em qualquer erro.
- **A data da sessão é a do arquivo.** `session_saved_at` lê só a data do `sessions/<id>.bin`, sem decifrar. O [[sessionKeeper]] a usa para apagar sessões de antes do modo cartões ([[ADR-022 Sessões de antes do modo cartões são descartadas]]). Adicionado em 2026-11-06.
- **Chave ilegível não trava as contas.** Uma chave que não pode ser descriptografada não impede as contas de carregar. `public_settings` mostra `(unreadable, paste it again)`. O `get_keys()` devolve vazia a chave ilegível, o `data.log` recebe só o nome do campo ("could not decrypt the saved riotTftApiKey, skipped it"), e o refresh segue com as outras chaves. Sem a chave, o [[rankApi]] trata aquele jogo como sem chave; uma chave de TFT ilegível cai na chave da Riot, como quando não há chave de TFT.
- **Máscara.** Primeiros 8 e últimos 4 caracteres da chave.
- **Chaves em `update_settings`.** Ausente = não mexe, vazia = remove, outro valor = substitui (com `trim`).
- **`language`** (padrão `'pt'`) guarda o idioma do Eclipse. `public_settings` devolve `'en'` só quando o valor salvo é exatamente `'en'`; qualquer outro valor, inclusive dados antigos sem o campo, vira `'pt'` ([[ADR-014 Interface em português e inglês]]).
- **`cardLayout`** guarda o visual dos [[cards]], desde 2026-11-15: `public_settings` devolve `'list'` só quando o valor salvo é exatamente `'list'`; qualquer outro, ou a falta do campo, vira `'plates'`. Fica fora de `default_settings`: um `data.json` antigo só ganha o campo quando o usuário clica num dos ícones, e o teste do arquivo do Electron continua conferindo que ele é salvo sem mudar.
- **Interface dos serviços.** `ServiceStore` é o que os serviços ([[signInService]], [[sessionKeeper]], [[rankWatcher]]) veem do store: contas, configurações, senha, sessões e atualização de campos. A implementação para `Mutex<Store>` trava o store a cada chamada; nos testes, um store em memória a implementa.

## Testes

`src-tauri/tests/application/store.rs`, com um `Cipher` falso e pasta temporária. Cobre: travessia de caminho e contas desconhecidas nas sessões; ida e volta de sessão criptografada com UUID e ID legado; substituição de sessão que falha mantendo a anterior, sem sobrar `.tmp`; backup disparado por edição de conta e configuração, mas não por elo ou lançamento; limite de 30 backups; "Manter login", idioma e visual dos cartões por padrão; chave ilegível pulada sem afetar as outras e chave vazia removendo a salva; opções do modo antigo apagadas de um arquivo antigo; um `data.json` no formato do Electron carregado e salvo sem perder campo; arquivo ilegível guardado e o backup mais novo restaurado; usuário ou senha novos apagando a sessão; apagar a conta atual; nomes sem marcas de direção; os serviços vendo o store real pela trava; e o `sign-in.log` virando `.old` acima do limite.

## Pontos de atenção

- Se a cópia de um `data.json` ilegível para `.corrupt-<timestamp>` falhar (por exemplo, sem permissão), o erro é ignorado e o próximo `save` sobrescreve o arquivo ilegível.
- `update_settings` aceita vazia para remover chave, mas os [[cards]] nunca enviam vazia.
- Backups e sessões só abrem no mesmo usuário Windows. Ver [[Armazenamento e dados]] e [[Segurança e privacidade]].
