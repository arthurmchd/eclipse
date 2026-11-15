---
tipo: módulo
arquivo: src/integration/manager/manager-preload.js
camada: integração
testes: [test/integration/manager/manager-preload.test.js, src-tauri/tests/integration/manager/manager_host.rs]
tags: [módulo, interface]
---

# manager-preload

> Monta o `window.api` da webview dos cartões sobre o comando único `manager` do [[managerHost]].

## Responsabilidade

Cria `window.api`, encaminha métodos nomeados ao comando `manager` do [[managerHost]] e transforma a consulta periódica de eventos em assinaturas usadas pelos [[cards]]. O arquivo é JavaScript, mas não roda no Node: o [[managerHost]] o embute no executável e o injeta na webview `cards` como script de inicialização. Não oferece acesso a comandos arbitrários nem às senhas armazenadas.

## API pública

`createManagerApi(options)` recebe um `ipcRenderer` com `invoke`, relógio, temporizadores e um `onUnload`, para os testes trocarem tudo. O `window.api` tem os métodos de contas (`init`, `saveAccount`, `deleteAccount`), elos (`refresh`), login (`runningGames`, `signIn`, `cancelSignIn`), configurações (`saveSettings`), as assinaturas de eventos e as ações das cópias dos controles da Riot: `minimizeRiot()` e `closeRiot()`. Cada uma manda `windowAction` com um valor fixo e ignora argumentos ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]). `revealRiot()` saiu em 2026-11-06, com a cópia do perfil nos [[cards]]. `patchAccount`, `forgetSession`, `copy`, `showRiotClient`, `pickClientPath`, `openDataFolder` e `closeManager` saíram em 2026-11-07 com a janela antiga ([[ADR-028 Modo antigo removido]]).

As assinaturas são `onAccountUpdated`, `onRefreshProgress`, `onNextRefresh`, `onSignInStatus` e `onSignInOperation`; cada uma devolve o cancelamento do listener.

## Dependências

- Usa: o `invoke` do Tauri, que o `bridge_script` do [[managerHost]] passa no lugar do `ipcRenderer`, e relógio e temporizadores injetáveis.
- Usado por: [[managerHost]] (`bridge_script`) e [[cards]].

## Invariantes e decisões

- **Só o que os cartões usam.** Cada função da API corresponde a um comando do [[managerService]] chamado pelos [[cards]]; nada sobra para outra interface.
- **Só um comando nomeado.** Toda chamada vira `invoke('manager', { method, args })`, com método e argumentos da função pública correspondente. O consumidor não recebe um `invoke` genérico.
- **Eventos com cursor.** Consulta `events(cursor)` em intervalos de 500 ms, sem requisições simultâneas. Só entrega os cinco canais permitidos e avança o cursor válido.
- **Recupera perda de histórico.** Quando a fila pública informa reinício do histórico, lê `init` novamente e sincroniza contas, horário de atualização e operação.
- **Login sobrevive à visualização.** `signIn` recebe imediatamente o identificador da operação e aguarda seu fim por eventos ou `operation`, mantendo o retorno esperado pela interface. O serviço em segundo plano continua sendo dono do trabalho.
- **Espera limitada.** O prazo padrão de espera do resultado é dez minutos, incluindo a intervenção manual quando necessária. Um prazo excedido devolve instrução de recuperação, sem repetir credenciais nem iniciar outro login.
- **Descarte não cancela o login.** Ao descarregar a página, remove listeners, limpa o timer e resolve as esperas locais com o aviso de visualização fechada. Não envia cancelamento ao serviço.
- **Valores salvos não voltam.** Cadastro e edição enviam o texto recém-digitado, enquanto o estado recebido contém contas públicas e chaves mascaradas. Nenhuma função lê ou copia uma senha guardada.
- **Embutido no executável.** O `bridge_script` do [[managerHost]] põe o arquivo (`include_str!`) dentro de uma função, com `module` vazio, e troca o `ipcRenderer.invoke` pelo `invoke` do Tauri. O `window.api` sai congelado. Desde 2026-11-15 o arquivo não tem mais o ramo do Electron (`contextBridge`). Sem `contextIsolation`, a ponte vive no mesmo mundo da página; a defesa é a validação no Rust ([[ADR-033 Sobreposição no Tauri]]).

## Testes

`test/integration/manager/manager-preload.test.js`, no Node com `invoke`, relógio e temporizadores falsos, confere o mapeamento das funções e a forma dos argumentos, os eventos depois do cursor inicial e só nos canais permitidos, a espera da operação depois da resposta curta do login, falha e cancelamento sem repetir credenciais, e prazo e descarte sem cancelar o serviço. `src-tauri/tests/integration/manager/manager_host.rs` confere que o `bridge_script` traz este arquivo inteiro sobre o comando `manager`. Não autenticam contas reais.

## Pontos de atenção

- O serviço `events` e o conjunto de canais devem evoluir junto com este módulo e os [[cards]].
- Erros de uma consulta periódica não substituem o estado por uma lista vazia.
