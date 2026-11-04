---
tipo: módulo
arquivo: src/core/managerService.js
camada: aplicação
testes: test/core/managerService.test.js
tags: [módulo, segurança]
---

# managerService

> Serviço de comandos e eventos públicos para todas as funções de contas exibidas dentro do Riot Client.

## Responsabilidade

Valida métodos, quantidade de argumentos, formatos e campos antes de acessar [[store]], [[signInService]], clipboard ou ações nativas. Devolve somente contas públicas e configurações mascaradas. Mantém uma fila de eventos para a visualização integrada se reconectar sem depender da vida de uma janela separada.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createManagerService(options)` | função | Recebe store, serviço de login, Riot Client, ações nativas, agendamento e contexto inicial por injeção. |
| `dispatch(method, args)` | método assíncrono | Executa apenas métodos reconhecidos e argumentos válidos. |
| `createManagerEvents(options)` | função | Cria a fila de eventos com limite de quantidade e bytes. |
| `events.publish(channel, payload)` | método | Publica somente um canal conhecido, com payload público sanitizado. |
| `events.read(after)` | método | Retorna eventos posteriores ao cursor, cursor atual e indicação de histórico perdido. |
| `events.cursor()` | método | Cursor atual, incluído no estado inicial. |

Comandos de `dispatch`: `init`, `events`, `operation`, `saveAccount`, `deleteAccount`, `patchAccount`, `forgetSession`, `copy`, `refresh`, `runningGames`, `signIn`, `showRiotClient`, `cancelSignIn`, `saveSettings`, `pickClientPath`, `openDataFolder` e `openExternal`.

## Dependências

- Usa por injeção: [[store]], [[signInService]], [[riotClient]], clipboard, shell, diálogo de arquivos, atualização de elos e relógio de limpeza de clipboard.
- Usado por: [[main]], que conecta `dispatch` à rota autenticada de [[bridgeServer]] e publica o progresso na fila.
- Consumido por: [[manager-preload]] através de [[managerHost]] e addon main.

## Invariantes e decisões

- **`saveSettings` aceita `staySignedIn`** só como booleano, como as outras preferências de liga/desliga. Adicionado em 2026-11-04.
- **Não aceita IPC genérico.** Métodos desconhecidos, quantidade incorreta de argumentos e objetos com chaves extras são recusados. Objetos contendo `__proto__`, `constructor` ou `prototype` também são recusados.
- **Formato de conta fechado.** IDs usam o formato de sessão seguro; regiões precisam existir no contexto inicial; texto, credenciais, notas, temporadas e banimentos têm limites e tipos explícitos.
- **Conta em login não é reescrita.** Alterar credenciais, excluir conta ou esquecer sessão recusa o `activeAccountId` em uso.
- **Patch não altera credenciais.** Aceita somente nota, banimento, última temporada e favorito, com validação própria.
- **Segredos persistidos não retornam.** `init` e resultados de conta usam uma lista pública de campos; a sanitização de objetos aninhados remove chaves de senha, token, segredo, cookie, autorização e sessão.
- **Cadastro recebe somente o que foi digitado.** A senha nova atravessa o comando de escrita e vai ao armazenamento criptografado. Não existe comando para devolver a senha salva ao formulário.
- **Cópia não devolve conteúdo.** O serviço escreve usuário, Riot ID ou senha diretamente no clipboard e retorna um booleano. A senha sai após vinte segundos se o clipboard ainda tiver o mesmo conteúdo.
- **Login confirmado pela visualização.** `signIn` retorna um identificador por `startFromManager`, sem prender a requisição HTTP pelo tempo de login. As confirmações de banimento e jogo aberto continuam na interface completa; o fluxo integrado permanece oculto.
- **Atualização em segundo plano.** `refresh` e a atualização após salvar conta disparam trabalho sem manter a chamada HTTP aberta.
- **Fila limitada.** Por padrão até 256 eventos e 768 KiB, somente `account-updated`, `refresh-progress`, `next-refresh`, `sign-in-status` e `sign-in-operation`. Eventos e resultados não recebem os objetos internos do store.
- **Reconexão explícita.** Cursor inválido é recusado; cursor que perdeu histórico informa `reset`, para a visualização reler o estado.
- **Ações externas limitadas.** O seletor aceita somente um arquivo `.exe` de cliente Riot; abrir pasta usa o diretório do store; links exigem HTTPS sem usuário ou senha na URL.
- **Uma fronteira para a interface completa.** A decisão está em [[ADR-007 Interface completa dentro do Riot Client]]. A ponte HTTP continua responsável por origem, token e tamanho de corpo.

## Testes

Testes com dados sintéticos e dependências falsas cobrem validação de métodos e formulários, campos proibidos, proteção da conta em operação, contas públicas, ausência de senhas e chaves em resultados/eventos, limpeza de clipboard, limites da fila e execução das ações válidas. Não acessam dados reais do usuário.

## Pontos de atenção

- A lista de métodos deve acompanhar [[managerHost]] e [[manager-preload]].
- Chaves mascaradas são apenas indicadores de configuração, não são valores utilizáveis para chamadas de API.
- A interface completa preserva as confirmações de ações destrutivas; o serviço não exibe uma segunda janela de confirmação.
