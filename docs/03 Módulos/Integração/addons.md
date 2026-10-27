---
tipo: módulo
arquivo: [src/integration/addon/addon-main.js, src/integration/addon/addon-preload.js, src/integration/addon/addon-renderer.js, src/integration/addon/preview.html]
camada: integração
testes: test/integration/addon/clientAddon.test.js
tags: [módulo]
---

# addons

> Os três scripts anexados à interface do Riot (main, preload e renderer) que mostram o painel "MINHAS CONTAS" na tela de login e falam com a ponte do gerenciador.

## Responsabilidade

- `addon-main.js`: no processo main do Riot, lê a descoberta, decifra o token da ponte e registra quatro handlers IPC que chamam o [[bridgeServer]].
- `addon-preload.js`: expõe `window.riotAccountManager` com quatro métodos fixos.
- `addon-renderer.js`: desenha o painel quando o formulário de login está visível e consulta o estado a cada segundo.
- `preview.html`: página de demonstração local, com dados fictícios, para ver o painel sem o Riot.

Os addons não fazem login nem tocam a senha digitada. Quem entra na conta é o gerenciador ([[signInService]]).

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `ram-client:state` | IPC | `GET /v1/state`, devolve contas e operação filtradas. |
| `ram-client:sign-in` | IPC | `(accountId, game)` → `POST /v1/sign-in`, devolve `operationId`. |
| `ram-client:cancel`, `ram-client:open-manager` | IPC | `POST` sem campos. |
| `window.riotAccountManager` | objeto congelado | `state()`, `signIn(accountId, game)`, `cancel()`, `openManager()`. |
| `#ram-login-account-panel-v1` | elemento | `aside` com shadow DOM fechado. |

## Dependências

- Usa: [[bridgeServer]] (HTTP), o helper DPAPI de [[windowsDpapi]] (embutido na preparação).
- Usado por: [[Scripts de integração]], que anexam os arquivos via [[asar]]. [[privateHost]] confere a carga. `scripts/dev/preview-riot-integration.js` (`npm run preview:riot-login`) abre `preview.html`.

## Invariantes e decisões

- **Opcional por natureza.** Cada addon roda dentro de `try/catch`. Uma falha da integração não pode impedir o Riot de abrir nem quebrar o preload original.
- **Uma vez só.** Cada addon marca `globalThis[Symbol.for('riot-account-manager.<main|preload|renderer>.v1')]`. Anexar duas vezes não registra handlers duplicados. O símbolo do renderer também é a prova que [[privateHost]] procura.
- **Marcador fora dos arquivos.** O `RAM_LOGIN_INTEGRATION_V1` não está mais nos fontes; ele vem do separador que [[asar]] insere antes de cada addon.
- **Placeholder do DPAPI.** `__RAM_DPAPI_HELPER_BASE64__` em `addon-main.js` é trocado, na preparação, pelo `encodedCommand` de [[windowsDpapi]]. O token é decifrado por `powershell.exe -EncodedCommand`, com a entrada por stdin e prazo de 6 s.
- **Token só no main.** O token da ponte nunca chega ao renderer. As chamadas HTTP saem do processo main, sem `Origin`.
- **Remetente confiável.** Cada handler exige: frame principal da janela; título `Riot Client`; URL `http:` em `127.0.0.1` ou `localhost`, sem usuário ou senha, com porta numérica válida; e URL do frame igual à do `webContents`. Páginas remotas e iframes recebem erro.
- **Descoberta validada.** Lê `%APPDATA%\riot-account-manager\riot-client-bridge.json` (até 8 KiB). Exige `version` 1, PID e porta válidos e token em Base64. O token decifrado tem de 32 a 256 caracteres, sem CR, LF ou NUL. A conexão fica em cache enquanto blob, PID e porta não mudam.
- **Resposta limitada.** Prazo de 4 s, até 512 KiB, objeto JSON. Status fora de 2xx ou `ok: false` viram erro curto.
- **Estado filtrado de novo.** Até 1000 contas com `id` válido; `gameName` até 64 e `tagLine` até 32 caracteres; só os booleanos `hasPassword` e `hasSession`. A operação só passa com status `running`, `succeeded`, `failed` ou `cancelled`.
- **API mínima no preload.** Só quatro métodos, sem um `invoke` genérico.
- **Painel fora do layout do Riot.** As regras inline do `aside` (fixo, `z-index` alto) mantêm o painel fora do fluxo de layout do Riot/League. O shadow DOM é fechado. Nomes de conta entram como `textContent`.
- **Só na tela de login.** Os seletores pegam o `LoginForm` da 141 instalada (`[data-testid="login-form"]`, `.login-form`) e excluem formulários de criação de conta ou troca de senha, que também podem ter campo de senha. O campo precisa ter tamanho e nenhum ancestral com `display: none`, `visibility: hidden/collapse` ou opacidade 0. O valor da senha nunca é lido.
- **Consulta só quando visível.** Um `MutationObserver` agenda a checagem (100 ms). Com o login visível, `refresh` roda a cada 1 s; oculto, o intervalo para. Tudo é limpo em `beforeunload`.
- **Login exige senha salva.** O botão "Entrar e jogar" e cada conta só ficam ativos se a conta tiver senha no gerenciador.
- **Prévia sem Riot.** `preview.html` define um `window.riotAccountManager` falso com três contas fictícias e um formulário com `data-testid="login-form"`, e carrega `addon-renderer.js` do mesmo diretório. Não envia credenciais nem conecta à Riot. Ver [[Desenvolvimento]].

## Testes

`clientAddon.test.js` roda os fontes num `vm` com Electron, `fs` e `http` falsos. Cobre: token decifrado só no main e campos sensíveis removidos; recusa de páginas remotas, iframes e outro título; descobertas malformadas; DPAPI indisponível e token com injeção de cabeçalho; validação do sign-in; respostas inválidas e grandes; anexação dupla; preload com quatro métodos; nomes renderizados como texto; painel oculto e sem polling quando o login some ou fica transparente.

## Pontos de atenção

- O caminho da descoberta é fixo e depende do nome do app no Electron. Ver [[bridgeServer]].
- Os seletores do login foram feitos para a 141. Na 142 não há teste próprio. Ver [[Atualização do Riot Client]].
- `region` vem da ponte mas não é exibido.
