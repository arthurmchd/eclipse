---
tipo: módulo
arquivo: src/integration/manager/manager-preload.js
camada: integração
testes: test/integration/manager/manager-preload.test.js
tags: [módulo, interface]
---

# manager-preload

> Preserva a API funcional da interface de contas, agora isolada dentro da visualização filha da janela Riot.

## Responsabilidade

Expõe `window.api` por `contextBridge`, encaminha métodos nomeados ao IPC de [[managerHost]] e transforma a consulta periódica de eventos em assinaturas usadas pelo [[renderer]]. Não oferece acesso ao Node, ao IPC arbitrário, ao token da ponte ou às senhas armazenadas.

## API pública

`createManagerApi(options)` permite testes com `ipcRenderer`, relógio e temporizadores falsos. O preload expõe os métodos de contas (`init`, `saveAccount`, `deleteAccount`, `patchAccount`, `forgetSession`, `copy`), elos (`refresh`), login (`runningGames`, `signIn`, `showRiotClient`, `cancelSignIn`), configurações (`saveSettings`, `pickClientPath`, `openDataFolder`) `closeManager` e as ações das cópias dos controles do Riot: `minimizeRiot()` e `closeRiot()`. Cada uma manda `windowAction` com um valor fixo e ignora argumentos (revisão de 2026-11-04, [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]; substituem `setModal`). `revealRiot()` saiu em 2026-11-06, com a cópia do perfil nos [[cards]].

As assinaturas públicas continuam `onAccountUpdated`, `onRefreshProgress`, `onNextRefresh`, `onSignInStatus` e `onSignInOperation`; cada uma devolve o cancelamento do listener.

## Dependências

- Usa: `electron` (`contextBridge`, `ipcRenderer`), relógio e temporizadores injetáveis.
- Usado por: [[managerHost]] e [[renderer]].

## Invariantes e decisões

- **Mesma função, outro transporte.** O renderer mantém sua API de operações e eventos, sem depender de uma janela independente ou de handlers no main raiz. Ver [[ADR-007 Interface completa dentro do Riot Client]].
- **Só um canal nomeado.** Toda chamada passa por `ram-manager:invoke`, com método e argumentos da função pública correspondente. O consumidor não recebe um `invoke` genérico.
- **Eventos com cursor.** Consulta `events(cursor)` em intervalos de 500 ms, sem requisições simultâneas. Só entrega os cinco canais permitidos e avança o cursor válido.
- **Recupera perda de histórico.** Quando a fila pública informa reinício do histórico, lê `init` novamente e sincroniza contas, horário de atualização e operação.
- **Login sobrevive à visualização.** `signIn` recebe imediatamente o identificador da operação e aguarda seu fim por eventos ou `operation`, mantendo o retorno esperado pela interface. O serviço em segundo plano continua sendo dono do trabalho.
- **Espera limitada.** O prazo padrão de espera do resultado é dez minutos, incluindo a intervenção manual quando necessária. Um prazo excedido devolve instrução de recuperação, sem repetir credenciais nem iniciar outro login.
- **Descarte não cancela o login.** Ao descarregar o renderer, remove listeners, limpa o timer e resolve as esperas locais com o aviso de visualização fechada. Não envia cancelamento ao serviço.
- **Valores salvos não voltam.** Cadastro e edição enviam o texto recém-digitado, enquanto o estado recebido contém contas públicas e chaves mascaradas. Copiar senha recebe só o resultado da ação de clipboard no main.

## Testes

Testes com IPC, relógio e temporizadores falsos verificam mapeamento das funções (incluindo as três ações da janela do Riot com valor fixo e a ausência de `setModal`), eventos permitidos, avanço do cursor, espera de operação, prazo e descarte sem cancelar o serviço. Não autenticam contas reais.

## Pontos de atenção

- O serviço `events` e o conjunto de canais devem evoluir junto com este módulo e [[renderer]].
- Erros de uma consulta periódica não substituem o estado por uma lista vazia.
