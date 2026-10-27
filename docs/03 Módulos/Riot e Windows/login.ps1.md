---
tipo: módulo
arquivo: src/platform/windows/login.ps1
camada: plataforma
testes: nenhum
tags: [módulo]
---

# login.ps1

> Preenche o formulário de login do Riot Client com mensagens enviadas só à janela dele. Rota de compatibilidade usada pelo [[riotClient]].

## Responsabilidade

- Acha a janela de login do Riot, mesmo oculta, e espera o formulário carregar.
- Digita usuário e senha, marca "Stay signed in" quando reconhece a caixa desmarcada e clica em entrar.
- Não mostra nem ativa janelas, não injeta teclado global e não move o mouse do usuário. Visibilidade e foco são só do [[windowGuard.ps1]].
- Não resolve CAPTCHA nem 2FA.

## API pública

Entrada: um único JSON UTF-8 no stdin.

| `action` | Campos | Efeito |
|---|---|---|
| `type` | `username`, `password`, `remember`, `submit` | Preenche o formulário. |
| `self-test` | — | Testa `Point` e a leitura da caixa "remember". Imprime `ok`. |

O [[riotClient]] também envia `hide`; o script ignora esse campo.

Saída: `remember:on|off|unknown` (só com `remember`), depois `ok`. Em falha, `error:<código>` e código de saída 1.

Códigos permitidos: `invalid-request`, `invalid-action`, `invalid-credentials`, `window-not-found`, `form-not-ready`, `input-failed`, `point-test-failed`, `checkbox-test-failed`. Qualquer outro vira `window-script-failed`.

## Dependências

- Usa: `System.Drawing` e C# embutido (`RiotWindow`) com `user32.dll`.
- Usado por: [[riotClient]] (`runWindowScript`), quando o [[signInFlow]] cai no formulário nativo. Caminho via [[paths]].

## Sequência de `type`

1. Valida usuário e senha: strings não vazias, até 256 caracteres, sem CR, LF ou NUL.
2. `SetProcessDPIAware`.
3. Por até 60 s, a cada 250 ms: procura a janela. O formulário está pronto após 4 leituras seguidas da mesma janela com `Test-FormReady`.
4. Clica no campo de usuário, limpa e digita. Repete no campo de senha.
5. Com `remember`: lê a caixa. Só clica se estiver `off`, e lê de novo. Imprime o estado.
6. Com `submit`: clica em entrar.

## Detalhes

- **Janela:** PIDs de `Riot Client` e `RiotClientUx`. Só janelas raiz com área cliente de ao menos 500×300. Pontuação = área + 100 000 000 se tiver título.
- **Pronto:** proporção entre 1,6 e 1,95; painel com RGB ≥ 240; campos de usuário e senha com RGB ≥ 220.
- **Caixa "remember":** 25 amostras em grade 5×5 (passos de 2 px). 10 ou mais escuras (RGB < 120) → `on`. 22 ou mais claras (RGB ≥ 180) → `off`. Senão `unknown`.
- **Clique:** `WM_MOUSEMOVE`, `WM_LBUTTONDOWN`, 40 ms, `WM_LBUTTONUP`, 300 ms. Coordenadas são frações da área cliente.
- **Limpeza:** `End` (`0x23`), depois 256 `Backspace` com 3 ms entre eles.
- **Digitação:** um `WM_CHAR` por caractere, com 35 ms.
- **Captura:** `PrintWindow` com flag 2 num `Bitmap` do tamanho da janela, até 10000×10000.

Posições (fração de largura, altura):

| Ponto | Valor |
|---|---|
| `$USERNAME` | 0.130, 0.303 |
| `$PASSWORD` | 0.130, 0.377 |
| `$REMEMBER` | 0.0417, 0.5023 |
| `$SUBMIT` | 0.1302, 0.7894 |
| `$PANEL` | 0.026, 0.5 |

## Invariantes e decisões

- **Mensagens só para o HWND do Riot.** Tudo vai por `PostMessage` à janela encontrada.
- **Credenciais só pelo stdin.** Nunca aparecem nos argumentos do processo.
- **Limpar sem `Ctrl+A`.** `End` e `Backspace` locais limpam um campo preenchido. `Ctrl+A` dependeria do estado global das teclas modificadoras e interferiria no usuário.
- **35 ms por caractere.** O Chromium perde caracteres postados rápido demais.
- **`EnumWindows` em vez de `MainWindowHandle`.** `EnumWindows` inclui janelas transparentes e em `SW_HIDE`. Prefere a maior janela Riot com título e aceita títulos traduzidos ou alterados, sem exigir "Riot Client".
- **Posições medidas no Riot Client v141.** As amostras de prontidão e da caixa são conservadoras de propósito. Um layout futuro pode exigir novas posições.
- **Imagens só em memória.** Nunca são salvas nem registradas. Os handles GDI são liberados mesmo quando `PrintWindow` falha enquanto o cliente recria a janela de login.
- **A caixa marcada pode ter um centro branco.** O visto branco ocupa o meio da caixa escura. Por isso a leitura usa o entorno, não um pixel central.
- **Não clicar em caixa marcada ou desconhecida.** Alternar no escuro poderia desligar uma sessão persistente existente. O login ainda funciona sem sessão salva se um tema futuro não for reconhecido.
- **Erro sem dados do pedido.** Nem dados do pedido nem diagnóstico do parser (que poderia conter credenciais) saem. Por isso o `ConvertFrom-Json` tem `try` próprio e o motivo passa por uma lista fechada.

## Testes

Nenhum teste automatizado executa este script. A ação `self-test` existe, mas nenhum arquivo em `test/` a chama.

## Pontos de atenção

- **Layout fixo da v141.** Coordenadas e cores dependem do tema do cliente: [[Atualização do Riot Client]].
- **Retângulos diferentes.** As amostras de pixel usam `GetWindowRect` (janela inteira); os cliques usam `GetClientRect`. Só coincidem em janelas sem moldura.
- **Depende do modo `hide`.** A janela precisa estar em alpha 1, não em `SW_HIDE`, para renderizar e receber a digitação. O [[signInFlow]] troca para `hide` antes de chamar o script.
- **`error:focus` não existe aqui.** O [[riotClient]] trata esse código, mas o script nunca o emite.
- **Tempo total.** 60 s para achar o formulário, mais a digitação, dentro do limite de 90 s do [[riotClient]].
- Regra geral: [[Segurança e privacidade]].
