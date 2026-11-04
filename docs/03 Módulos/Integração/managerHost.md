---
tipo: módulo
arquivo: src/integration/manager/managerHost.js
camada: integração
testes: test/integration/manager/managerHost.test.js
tags: [módulo, interface]
---

# managerHost

> Hospeda a interface completa de contas como visualização filha da própria janela Riot, sem criar outra `BrowserWindow`.

## Responsabilidade

Cria e redimensiona um `WebContentsView`, carrega o HTML local do [[renderer]], fornece o [[manager-preload]] isolado e encaminha seus comandos ao serviço de contas. Fechar a visualização volta ao Riot; não encerra o serviço, a janela pai ou o login.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createManagerHost(options)` | função | Recebe Electron e transporte `request(method, args)` injetáveis, os caminhos do renderer/preload e o recuo superior da visualização. |
| `open(window)` | método assíncrono | Cria ou reaproveita a visualização dentro da janela Riot e devolve `{ ready: true, embedded: true }`. |
| `close()` | método | Desanexa e oculta a visualização, preservando seu estado em memória para a próxima abertura. |
| `dispose()` | método | Remove o handler IPC, fecha o `webContents` e impede reabertura. |
| `CHANNEL` | constante | `ram-manager:invoke`. |

## Dependências

- Usa: `electron` (`WebContentsView`, `ipcMain`), [[paths]] e o transporte limitado de gerenciamento fornecido pelo addon main.
- Usado por: [[privateHost]].

## Invariantes e decisões

- **Fundo configurável.** `backgroundColor` conserva o fundo escuro por padrão e aceita transparência para [[cards]]. `rendererFile` determina a URL local exata validada no IPC; usar outro renderer não amplia a lista de métodos permitidos.

- **Pai pode ser a sobreposição.** [[riotOverlay]] reutiliza este host com `topInset: 0` e transporte direto ao serviço; `onClose` recolhe o painel ao botão. As verificações de remetente, frame, URL, permissões e comandos permanecem idênticas. O modo privado continua suportado.

- **Uma janela só.** O módulo cria um `WebContentsView`, nunca uma `BrowserWindow`. A decisão está em [[ADR-007 Interface completa dentro do Riot Client]].
- **Origem de chamada exata.** Exige o `webContents` da própria visualização, seu frame principal e a URL `file:` exata de `MANAGER_RENDERER_FILE`. A página Riot e iframes não ganham a API completa.
- **Isolamento próprio.** `sandbox`, `contextIsolation` e `webSecurity` ligados; `nodeIntegration` desligado. A partição `persist:ram-manager-panel` mantém as preferências do painel separadas da página Riot.
- **Sem navegação para fora.** Navegação de página/frame, `<webview>` e janelas novas são recusados. Um link HTTPS é enviado como ação `openExternal` ao serviço, para abrir no navegador padrão.
- **Permissões negadas.** A sessão da visualização recusa pedidos de permissões e suas verificações.
- **Comandos fechados.** Só os métodos de gerenciamento conhecidos, com array de até quatro argumentos e conteúdo limitado, atravessam o IPC. O [[managerService]] faz a validação semântica adicional.
- **Voltar é local.** `closeManager` sem argumentos fecha somente a visualização e não atravessa a ponte.
- **Redimensionamento solidário.** A visualização acompanha o tamanho de conteúdo da janela Riot e reserva uma faixa superior para os controles da janela.
- **Fechamento durante a carga.** Uma geração de carga impede que uma promessa antiga reative uma visualização descartada.
- **Falha sem dados do formulário.** Erros do transporte voltam com uma mensagem fixa, sem ecoar argumentos de cadastro, senhas ou chaves.

## Testes

Testes com Electron e transporte falsos conferem criação como filho da janela, isolamento, redimensionamento, confiança do remetente, recusa de navegação e comandos, fechamento e descarte. Um teste com Electron real carrega o HTML completo e seu preload sandboxed, confirma o cartão fictício, configurações e retorno ao Riot em uma única janela. Não carregam contas reais nem autenticam no Riot.

## Pontos de atenção

- Depende de `WebContentsView` na versão Electron usada pelo projeto.
- Fechar a visualização conserva preferências e estado não sensível em memória; o [[renderer]] limpa senha e chaves digitadas ao voltar. `dispose` encerra o renderer.
- Os dados persistidos continuam no [[store]], sob responsabilidade do main em segundo plano.
