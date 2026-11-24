---
tipo: módulo
arquivo: src-tauri/src/application/manager_service.rs
camada: aplicação
testes: src-tauri/tests/application/manager_service.rs
tags: [módulo, segurança]
---

# managerService

> Serviço de comandos e eventos públicos para os cartões de contas sobre a Riot.

## Responsabilidade

Valida métodos, quantidade de argumentos, formatos e campos antes de acessar [[store]], [[signInService]] ou o navegador padrão. Devolve somente contas públicas e configurações mascaradas. Mantém uma fila de eventos para os [[cards]] se reconectarem sem depender da vida da janela.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `ManagerService::new(store, ports, events)` | construtor | Recebe o [[store]], as portas (`ManagerPorts`) e a fila de eventos |
| `dispatch(método, args)` | método | Executa apenas métodos reconhecidos e argumentos válidos; erro é um `Failure` com mensagem e código (400, 404, 409) |
| `ManagerPorts` | trait | O que o serviço pede ao resto do app: login, jogos abertos, link externo, atualização de elos, contexto inicial e aviso de configurações |
| `ManagerEvents::new(limite, bytes)` | construtor | Fila de eventos com limite de quantidade e bytes |
| `publish(canal, payload)` | método | Publica somente um canal de `CHANNELS`, com payload público sanitizado |
| `read(depois)` | método | Eventos posteriores ao cursor, cursor atual e indicação de histórico perdido |
| `cursor()` | método | Cursor atual, incluído no estado inicial |
| `public_account`, `copy_public` | funções | Conta pública e cópia sem segredos de um payload |

Comandos de `dispatch`: `init`, `events`, `operation`, `saveAccount`, `deleteAccount`, `refresh`, `runningGames`, `signIn`, `cancelSignIn`, `saveSettings` e `openExternal`.

## Dependências

- Usa: [[store]] e a trait `ManagerPorts`, que no app é o [[appPorts]]: login pelo [[signInService]], jogos abertos pelo [[riotClient]], link externo, atualização de elos pelo [[refresher]], contexto inicial e aviso de configurações.
- Usado por: [[managerHost]], que recebe os comandos da webview dos [[cards]], e [[main]], que publica o progresso na fila.
- Consumido por: [[manager-preload]], através de [[managerHost]].

## Invariantes e decisões

- **`signIn` com cinco jogos (2026-11-19).** `GAMES` aceita `lol`, `tft`, `val`, `2xko`, `lor` e `riot` ([[ADR-038 TFT, 2XKO e Runeterra no Eclipse]]).
- **Comandos novos de 2026-11-15:** `addAccounts(lista)` (1 a 50 contas novas, sem `id`, todas validadas como no `saveAccount` antes de gravar qualquer uma; erro com "Line N: …"), `pinAccount(id, booleano)` e `reorderAccounts(ids)` (409 quando a lista não bate com as contas salvas). Os três estão em `METHODS` do [[managerHost]] e no [[manager-preload]].
- **Campos novos da conta:** `games` (lista não vazia de `lol`, `val`, `tft`, `2xko` e `lor`, sem passar de cinco itens, normalizada nessa ordem; ausente vale os cinco; até a 2.10.3 só `lol` e `val`). `signInCount` só sai, nunca entra. `color` existiu na 2.5.0 e saiu em 2026-11-18 a pedido do usuário: agora é chave extra, recusada com 400, e não sai mais na lista pública. `tags` seguiu o mesmo caminho em 2026-11-19, também a pedido do usuário: `saveAccount` e `addAccounts` a recusam com 400 e ela saiu da lista pública. `addAccounts` também não aceita mais `note`, que a caixa de várias contas nunca mandou.
- **`seenAccount` no `init`.** Vem do [[appPorts]] e só é devolvido se nenhuma conta salva tiver o mesmo Riot ID.
- **`saveSettings` aceita `cardSort`** em `manual`, `rank`, `name` ou `recent`.
- **`signIn` aceita `riot`.** Desde 2026-11-04, além de `lol`, `tft` e `val`, para entrar na conta sem abrir jogo ([[signInFlow]]). Qualquer outro valor continua recusado com 400.
- **`saveSettings` aceita `staySignedIn`** só como booleano. Adicionado em 2026-11-04.
- **`saveSettings` aceita `uiSounds`** só como booleano. Adicionado em 2026-11-20 (2.15.0), para os [[sounds]].
- **Iniciar com o Windows fora do `data.json`.** Desde 2026-11-21, `init` devolve `startWithWindows` (booleano, ou `null` fora do app instalado) por `ManagerPorts::start_with_windows(None)`. `saveSettings` aceita `startWithWindows` só como booleano e só então chama `start_with_windows(Some(valor))`, depois de gravar os outros ajustes e antes de `settings_changed`, para a bandeja já remontar com o estado novo. A resposta traz o estado lido depois, só quando a chave veio. Nada disso vai para o [[store]]; o registro do Windows é do [[startWithWindows]].
- **API do tamanho dos cartões.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), `patchAccount`, `forgetSession`, `copy`, `showRiotClient`, `pickClientPath` e `openDataFolder` saíram: só a janela antiga os chamava. `saveSettings` aceita só `refreshMinutes`, `staySignedIn`, `riotClientPath`, `language` e as três chaves de API; `minimizeOnLaunch`, `hideRiotClient`, `closeRiotClient` e `streamerMode` são recusadas. O resultado não tem mais `clientFound`, e `init` não tem mais `embedded`. Menos portas abertas para a view, e nenhum comando lê uma senha guardada.
- **Não aceita comando genérico.** Métodos desconhecidos, quantidade incorreta de argumentos e objetos com chaves extras são recusados. Objetos contendo `__proto__`, `constructor` ou `prototype` também são recusados.
- **Formato de conta fechado.** IDs usam o formato de sessão seguro; regiões precisam existir no contexto inicial; texto, credenciais, notas, temporadas e banimentos têm limites e tipos explícitos.
- **Conta em login não é reescrita.** Alterar a conta ou excluí-la recusa o `activeAccountId` em uso.
- **Segredos persistidos não retornam.** `init` e resultados de conta usam uma lista pública de campos; a sanitização de objetos aninhados remove chaves de senha, token, segredo, cookie, autorização e sessão.
- **Cadastro recebe somente o que foi digitado.** A senha nova atravessa o comando de escrita e vai ao armazenamento criptografado. Não existe comando para devolver a senha salva ao formulário.
- **Login confirmado pelos cartões.** `signIn` retorna um identificador por `start_from_manager`, sem prender a chamada pelo tempo de login. As confirmações de banimento e de jogo aberto ficam nos [[cards]].
- **Atualização em segundo plano.** `refresh` e a atualização após salvar conta disparam trabalho sem manter a chamada aberta.
- **Fila limitada.** Por padrão até 256 eventos e 768 KiB, somente `account-updated`, `refresh-progress`, `next-refresh`, `sign-in-status` e `sign-in-operation`. Eventos e resultados não recebem os objetos internos do store.
- **Reconexão explícita.** Cursor inválido é recusado; cursor que perdeu histórico informa `reset`, para a visualização reler o estado.
- **Ações externas limitadas.** Links exigem HTTPS sem usuário ou senha na URL e abrem no navegador padrão.
- **Idioma só `pt` ou `en`.** `saveSettings` aceita `language` apenas com um valor de `LANGUAGES` do [[language]]; o resto recusa com `Invalid setting`. Depois de salvar, chama o aviso `settings_changed` das portas, que o [[main]] usa para refazer a bandeja e avisar a sobreposição. Uma falha nesse aviso não desfaz o salvamento. Adicionado em 2026-11-04 ([[ADR-014 Interface em português e inglês]]).
- **Visual só `plates` ou `list`.** Desde 2026-11-15, `saveSettings` aceita `cardLayout` apenas com um valor de `CARD_LAYOUTS`; o resto recusa com `Invalid setting`. Como toda configuração salva, reagenda a atualização e chama `settings_changed`.
- **Fundo só `light` ou `dark`.** Desde 2026-11-23 ([[ADR-049 Fundo escuro opcional]]), `saveSettings` aceita `pageTheme` apenas com um valor de `PAGE_THEMES`; o resto recusa com `Invalid setting`.
- **Portas e limites.** O que o serviço pede ao resto do app vem pela trait `ManagerPorts`; no app é o `AppPorts` ([[appPorts]]), e a fila de atualização é o [[refresher]]. Um pânico no aviso `settings_changed` é contido e não derruba o comando. O tamanho de texto é contado em unidades UTF-16, como os cartões contam no formulário, para os limites baterem.

## Testes

`src-tauri/tests/application/manager_service.rs`, com store em memória e portas falsas. Cobre: estado inicial e operações sem credenciais salvas; criar, editar e apagar contas; recusa de campos desconhecidos, valores inválidos e edição da conta em login; banimento só no formato conhecido; configurações com chaves mascaradas e reagendamento da atualização; `signIn` respondendo na hora, com cancelar e estado dos jogos; atualização de elos respondendo antes do trabalho e validando os IDs; link externo só `https` e sem credenciais na URL; fila de eventos sem segredos, com instantâneos e aviso de histórico perdido; objetos com chaves de protótipo descartados; idioma salvo só como `pt` ou `en`, avisando a mudança; e visual dos cartões salvo só como `plates` ou `list`. Não acessam dados reais do usuário.

## Pontos de atenção

- A lista de métodos deve acompanhar [[managerHost]] e [[manager-preload]].
- Chaves mascaradas são apenas indicadores de configuração, não são valores utilizáveis para chamadas de API.
- Os cartões preservam as confirmações de ações destrutivas; o serviço não exibe uma segunda janela de confirmação.
