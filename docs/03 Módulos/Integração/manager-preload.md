---
tipo: módulo
arquivo: src/integration/manager/manager-preload.js
camada: integração
testes: test/integration/manager/manager-preload.test.js
tags: [módulo, interface]
---

# manager-preload

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Preserva a API funcional da interface de contas, agora isolada dentro da visualização filha da janela Riot.

## Responsabilidade

Expõe `window.api` por `contextBridge`, encaminha métodos nomeados ao IPC de [[managerHost]] e transforma a consulta periódica de eventos em assinaturas usadas pelos [[cards]]. Não oferece acesso ao Node, ao IPC arbitrário ou às senhas armazenadas.

## API pública

`createManagerApi(options)` permite testes com `ipcRenderer`, relógio e temporizadores falsos. O preload expõe os métodos de contas (`init`, `saveAccount`, `deleteAccount`), elos (`refresh`), login (`runningGames`, `signIn`, `cancelSignIn`), configurações (`saveSettings`), as assinaturas de eventos e as ações das cópias dos controles do Riot: `minimizeRiot()` e `closeRiot()`. Cada uma manda `windowAction` com um valor fixo e ignora argumentos (revisão de 2026-11-04, [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]; substituem `setModal`). `revealRiot()` saiu em 2026-11-06, com a cópia do perfil nos [[cards]]. `patchAccount`, `forgetSession`, `copy`, `showRiotClient`, `pickClientPath`, `openDataFolder` e `closeManager` saíram em 2026-11-07 com a janela antiga ([[ADR-028 Modo antigo removido]]).

As assinaturas públicas continuam `onAccountUpdated`, `onRefreshProgress`, `onNextRefresh`, `onSignInStatus` e `onSignInOperation`; cada uma devolve o cancelamento do listener.

## Dependências

- Usa: `electron` (`contextBridge`, `ipcRenderer`), relógio e temporizadores injetáveis.
- Usado por: [[managerHost]] e [[cards]].

## Invariantes e decisões

- **Só o que os cartões usam.** Cada função da API corresponde a um comando do [[managerService]] chamado pelos [[cards]]; nada sobra para outra interface.
- **Só um canal nomeado.** Toda chamada passa por `ram-manager:invoke`, com método e argumentos da função pública correspondente. O consumidor não recebe um `invoke` genérico.
- **Eventos com cursor.** Consulta `events(cursor)` em intervalos de 500 ms, sem requisições simultâneas. Só entrega os cinco canais permitidos e avança o cursor válido.
- **Recupera perda de histórico.** Quando a fila pública informa reinício do histórico, lê `init` novamente e sincroniza contas, horário de atualização e operação.
- **Login sobrevive à visualização.** `signIn` recebe imediatamente o identificador da operação e aguarda seu fim por eventos ou `operation`, mantendo o retorno esperado pela interface. O serviço em segundo plano continua sendo dono do trabalho.
- **Espera limitada.** O prazo padrão de espera do resultado é dez minutos, incluindo a intervenção manual quando necessária. Um prazo excedido devolve instrução de recuperação, sem repetir credenciais nem iniciar outro login.
- **Descarte não cancela o login.** Ao descarregar o renderer, remove listeners, limpa o timer e resolve as esperas locais com o aviso de visualização fechada. Não envia cancelamento ao serviço.
- **Valores salvos não voltam.** Cadastro e edição enviam o texto recém-digitado, enquanto o estado recebido contém contas públicas e chaves mascaradas. Nenhuma função lê ou copia uma senha guardada.
- **Versão Rust (fase 4 da [[Migração para Tauri]]).** O mesmo arquivo é embutido no executável (`include_str!`) e vira o script de inicialização da webview `cards` (`bridge_script` em `manager_host.rs`): dentro de uma função, com `process` e `module` vazios para os trechos do Electron não rodarem, e com o `ipcRenderer.invoke` trocado pelo `invoke('manager', { method, args })` do Tauri. O `window.api` sai congelado, com os mesmos métodos; conferido no Node com um `invoke` falso. Diferença: sem `contextIsolation`, a ponte vive no mesmo mundo da página; a defesa é a validação no Rust ([[ADR-033 Sobreposição no Tauri]]).

## Testes

Testes com IPC, relógio e temporizadores falsos verificam mapeamento das funções (incluindo as ações da janela do Riot com valor fixo e a ausência de `setModal` e das funções removidas), eventos permitidos, avanço do cursor, espera de operação, prazo e descarte sem cancelar o serviço. Não autenticam contas reais.

## Pontos de atenção

- O serviço `events` e o conjunto de canais devem evoluir junto com este módulo e os [[cards]].
- Erros de uma consulta periódica não substituem o estado por uma lista vazia.
