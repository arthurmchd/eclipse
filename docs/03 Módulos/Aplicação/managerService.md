---
tipo: módulo
arquivo: src/core/managerService.js
camada: aplicação
testes: test/core/managerService.test.js
tags: [módulo, segurança]
---

# managerService

> Serviço de comandos e eventos públicos para os cartões de contas sobre a Riot.

## Responsabilidade

Valida métodos, quantidade de argumentos, formatos e campos antes de acessar [[store]], [[signInService]] ou o navegador padrão. Devolve somente contas públicas e configurações mascaradas. Mantém uma fila de eventos para os [[cards]] se reconectarem sem depender da vida da janela.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createManagerService(options)` | função | Recebe `store`, `launchService`, `riotClient`, `shell`, `events`, `refreshAll`, `scheduleRefresh`, `initContext` e `settingsChanged` por injeção. |
| `dispatch(method, args)` | método assíncrono | Executa apenas métodos reconhecidos e argumentos válidos. |
| `createManagerEvents(options)` | função | Cria a fila de eventos com limite de quantidade e bytes. |
| `events.publish(channel, payload)` | método | Publica somente um canal conhecido, com payload público sanitizado. |
| `events.read(after)` | método | Retorna eventos posteriores ao cursor, cursor atual e indicação de histórico perdido. |
| `events.cursor()` | método | Cursor atual, incluído no estado inicial. |

Comandos de `dispatch`: `init`, `events`, `operation`, `saveAccount`, `deleteAccount`, `refresh`, `runningGames`, `signIn`, `cancelSignIn`, `saveSettings` e `openExternal`.

## Dependências

- Usa por injeção: [[store]], [[signInService]], [[riotClient]] (só `runningGames`), `shell` (só `openExternal`) e a atualização de elos.
- Usado por: [[main]], que passa `dispatch` à [[riotOverlay]] e publica o progresso na fila.
- Consumido por: [[manager-preload]] através de [[managerHost]].

## Invariantes e decisões

- **`signIn` aceita `riot`.** Desde 2026-11-04, além de `lol`, `tft` e `val`, para entrar na conta sem abrir jogo ([[signInFlow]]). Qualquer outro valor continua recusado com 400.
- **`saveSettings` aceita `staySignedIn`** só como booleano. Adicionado em 2026-11-04.
- **API do tamanho dos cartões.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]), `patchAccount`, `forgetSession`, `copy`, `showRiotClient`, `pickClientPath` e `openDataFolder` saíram: só a janela antiga os chamava. `saveSettings` aceita só `refreshMinutes`, `staySignedIn`, `riotClientPath`, `language` e as três chaves de API; `minimizeOnLaunch`, `hideRiotClient`, `closeRiotClient` e `streamerMode` são recusadas. O resultado não tem mais `clientFound`, e `init` não tem mais `embedded`. Menos portas abertas para a view, e nenhum comando lê uma senha guardada.
- **Não aceita IPC genérico.** Métodos desconhecidos, quantidade incorreta de argumentos e objetos com chaves extras são recusados. Objetos contendo `__proto__`, `constructor` ou `prototype` também são recusados.
- **Formato de conta fechado.** IDs usam o formato de sessão seguro; regiões precisam existir no contexto inicial; texto, credenciais, notas, temporadas e banimentos têm limites e tipos explícitos.
- **Conta em login não é reescrita.** Alterar a conta ou excluí-la recusa o `activeAccountId` em uso.
- **Segredos persistidos não retornam.** `init` e resultados de conta usam uma lista pública de campos; a sanitização de objetos aninhados remove chaves de senha, token, segredo, cookie, autorização e sessão.
- **Cadastro recebe somente o que foi digitado.** A senha nova atravessa o comando de escrita e vai ao armazenamento criptografado. Não existe comando para devolver a senha salva ao formulário.
- **Login confirmado pelos cartões.** `signIn` retorna um identificador por `startFromManager`, sem prender a chamada pelo tempo de login. As confirmações de banimento e de jogo aberto ficam nos [[cards]].
- **Atualização em segundo plano.** `refresh` e a atualização após salvar conta disparam trabalho sem manter a chamada aberta.
- **Fila limitada.** Por padrão até 256 eventos e 768 KiB, somente `account-updated`, `refresh-progress`, `next-refresh`, `sign-in-status` e `sign-in-operation`. Eventos e resultados não recebem os objetos internos do store.
- **Reconexão explícita.** Cursor inválido é recusado; cursor que perdeu histórico informa `reset`, para a visualização reler o estado.
- **Ações externas limitadas.** Links exigem HTTPS sem usuário ou senha na URL e abrem no navegador padrão.
- **Idioma só `pt` ou `en`.** `saveSettings` aceita `language` apenas com um valor de `LANGUAGES` do [[language]]; o resto recusa com `Invalid setting`. Depois de salvar, chama `settingsChanged(configurações)`, que o [[main]] usa para refazer a bandeja e avisar a sobreposição. Uma falha nesse aviso não desfaz o salvamento. Adicionado em 2026-11-04 ([[ADR-014 Interface em português e inglês]]).

## Testes

Testes com dados sintéticos e dependências falsas cobrem validação de métodos e formulários, campos proibidos, proteção da conta em operação, contas públicas, ausência de senhas e chaves em resultados/eventos, recusa dos comandos e opções removidos, limites da fila e execução das ações válidas. Não acessam dados reais do usuário.

## Pontos de atenção

- A lista de métodos deve acompanhar [[managerHost]] e [[manager-preload]].
- Chaves mascaradas são apenas indicadores de configuração, não são valores utilizáveis para chamadas de API.
- Os cartões preservam as confirmações de ações destrutivas; o serviço não exibe uma segunda janela de confirmação.
