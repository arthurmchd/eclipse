---
tipo: módulo
arquivo: src/platform/windows/login.ps1
camada: plataforma
testes: test/platform/windows/login.test.js
tags: [módulo]
---

# login.ps1

> Preenche o formulário de login do Riot Client com mensagens enviadas só à janela dele. Rota de compatibilidade usada pelo [[riotClient]].

## Responsabilidade

- Acha a janela de login do Riot, mesmo oculta, e espera o formulário carregar.
- Digita usuário e senha, deixa "Stay signed in" no estado pedido (`remember`) quando reconhece a caixa e clica em entrar.
- Não mostra nem ativa janelas, não injeta teclado global e não move o mouse do usuário. Visibilidade e foco são só do [[windowGuard.ps1]].
- Não resolve CAPTCHA nem 2FA.

## API pública

Entrada: um único JSON UTF-8 no stdin.

| `action` | Campos | Efeito |
|---|---|---|
| `type` | `username`, `password`, `remember`, `submit` | Preenche o formulário. |
| `self-test` | — | Testa `Point`, as cores da caixa "remember" e a leitura num bitmap com borda invisível, sem procurar nem tocar janelas. Imprime `ok`. |

Até 2026-11-07 o [[riotClient]] também enviava `hide`, que o script ignorava.

Saída: `remember:on|off|unknown`, depois `ok`. Em falha, `error:<código>` e código de saída 1.

Códigos permitidos: `invalid-request`, `invalid-action`, `invalid-credentials`, `window-not-found`, `form-not-ready`, `input-failed`, `point-test-failed`, `checkbox-test-failed`. Qualquer outro vira `window-script-failed`.

## Dependências

- Usa: `System.Drawing` e C# embutido (`RiotWindow`) com `user32.dll`.
- Usado por: [[riotClient]] (`runWindowScript`), quando o [[signInFlow]] cai no formulário nativo. Caminho via [[paths]].

## Sequência de `type`

1. Valida usuário e senha: strings não vazias, até 256 caracteres, sem CR, LF ou NUL.
2. `SetProcessDPIAware`.
3. Por até 60 s, a cada 250 ms: procura a janela. O formulário está pronto após 4 leituras seguidas da mesma janela com `Test-FormReady`.
4. Clica no campo de usuário, limpa e digita. Repete no campo de senha.
5. Lê a caixa. Se o estado é reconhecido e difere do pedido (`on` com `remember: true`, `off` com qualquer outro valor), clica uma vez e lê de novo. Com `unknown`, não clica. Imprime o estado. Até 2026-11-04 só marcava, nunca desmarcava. Até 2026-11-06 a leitura usava as cores da v141 e o quadro da janela inteira, e a caixa marcada da v142 nunca era reconhecida, então na prática também não desmarcava.
6. Com `submit`: clica em entrar.

## Detalhes

- **Janela:** PIDs de `Riot Client` e `RiotClientUx`. Só janelas raiz com área cliente de ao menos 500×300. Pontuação = área + 100 000 000 se tiver título.
- **Pronto:** proporção entre 1,6 e 1,95; painel com RGB ≥ 240; campos de usuário e senha com RGB ≥ 220.
- **Caixa "remember":** 25 amostras em grade 5×5 (passos de 2 px) em volta de `$REMEMBER`. Cada amostra é vermelha (R ≥ 150, G e B ≤ 110), cinza (canais entre 205 e 243, com diferença de até 12) ou outra. Uma amostra escura (canal mais alto ≤ 140) dá `unknown` na hora. 10 ou mais vermelhas e nenhuma cinza → `on`. 20 ou mais cinzas e nenhuma vermelha → `off`. Senão `unknown`, inclusive quando só aparece o painel.
- **Clique:** `WM_MOUSEMOVE`, `WM_LBUTTONDOWN`, 40 ms, `WM_LBUTTONUP`, 300 ms. Coordenadas são frações da área cliente.
- **Limpeza:** `End` (`0x23`), depois 256 `Backspace` com 3 ms entre eles.
- **Digitação:** um `WM_CHAR` por caractere, com 35 ms.
- **Captura:** `PrintWindow` com flag 2 num `Bitmap` do tamanho da janela (`GetWindowRect`), até 10000×10000. Os pixels são lidos no quadro da área cliente: origem por `ClientToScreen` menos o canto da janela, tamanho por `GetClientRect`. Se o quadro não couber no bitmap, a leitura falha e o formulário não conta como pronto.

Posições (fração de largura e altura da área cliente):

| Ponto | Valor |
|---|---|
| `$USERNAME` | 0.130, 0.303 |
| `$PASSWORD` | 0.130, 0.377 |
| `$REMEMBER` | 0.0417, 0.5023 (o [[riotWindowObserver]] lê o mesmo ponto para saber se o formulário sumiu; um teste confere que são iguais) |
| `$SUBMIT` | 0.1302, 0.7894 |
| `$PANEL` | 0.026, 0.5 (o mesmo ponto é lido pelo [[riotWindowObserver]] para ver se um modal da Riot escureceu a janela; mudar aqui pede mudar lá) |

## Invariantes e decisões

- **Mensagens só para o HWND do Riot.** Tudo vai por `PostMessage` à janela encontrada.
- **Credenciais só pelo stdin.** Nunca aparecem nos argumentos do processo.
- **Limpar sem `Ctrl+A`.** `End` e `Backspace` locais limpam um campo preenchido. `Ctrl+A` dependeria do estado global das teclas modificadoras e interferiria no usuário.
- **35 ms por caractere.** O Chromium perde caracteres postados rápido demais.
- **`EnumWindows` em vez de `MainWindowHandle`.** `EnumWindows` inclui janelas transparentes e em `SW_HIDE`. Prefere a maior janela Riot com título e aceita títulos traduzidos ou alterados, sem exigir "Riot Client".
- **Posições medidas no Riot Client v141, cores da caixa no v142.** As posições continuam valendo na v142: com a área cliente em 1536×864, a caixa ocupa x 56–71 e y 426–441, com centro em (64, 434), que é `$REMEMBER`. As amostras de prontidão e da caixa são conservadoras de propósito. Um layout futuro pode exigir novas posições.
- **Imagens só em memória.** Nunca são salvas nem registradas. Os handles GDI são liberados mesmo quando `PrintWindow` falha enquanto o cliente recria a janela de login.
- **Cores da v142.** Desmarcada, a caixa é `rgba(126,126,126,.15)` sobre o painel `#fcfcfc`, perto de 233 (220 com o mouse em cima). Marcada, é `#d53235` (`#bc252a` com o mouse) com um visto `#f9f9f9` no meio. Por isso a leitura conta a grade inteira, não um pixel central, e `on` pede só 10 vermelhas. O [[riotWindowObserver]] usa as mesmas faixas de cor para saber se o formulário sumiu.
- **Não clicar em caixa desconhecida.** Alternar no escuro poderia desligar uma sessão persistente existente ou clicar em outra coisa. Painel sem caixa, modal escuro por cima ou mistura de vermelho e cinza dão `unknown`. Até 2026-11-06 o painel sem caixa contava como `off` e podia receber o clique. O login ainda funciona sem sessão salva se um tema futuro não for reconhecido.
- **Pixels e cliques no mesmo quadro.** A janela do Riot tem bordas invisíveis: na v142, 1552×872 de janela para 1536×864 de área cliente, com a área cliente em (8, 0). Lida no quadro da janela, a grade caía 7 px à esquerda e 4 px abaixo do centro da caixa, e só 12 das 25 amostras ficavam dentro dela. É a mesma correção que o [[riotWindowObserver]] já fazia ao medir a janela. Um teste confere que toda leitura de pixel parte do quadro da área cliente.
- **Erro sem dados do pedido.** Nem dados do pedido nem diagnóstico do parser (que poderia conter credenciais) saem. Por isso o `ConvertFrom-Json` tem `try` próprio e o motivo passa por uma lista fechada.

## Testes

`test/platform/windows/login.test.js`:

- roda o `self-test` (só no Windows): cinza e cinza com o mouse dão `off`; vermelho e vermelho com o mouse, com o visto, dão `on`; painel, poucas cinzas, poucas vermelhas, vermelho com cinza, escuro e cor intermediária dão `unknown`; num bitmap com borda de 8 px, a caixa só é reconhecida no quadro da área cliente;
- confere no código que as duas leituras de pixel partem do quadro da área cliente e que os cliques usam `GetClientRect`.

A ação `type` não tem teste automatizado: precisa da janela real do Riot.

## Pontos de atenção

- **Layout fixo.** As coordenadas, medidas na v141, e as cores da caixa, medidas na v142, dependem do tema do cliente: [[Atualização do Riot Client]].
- **Precisa da janela renderizando.** A janela não pode estar em `SW_HIDE` para renderizar e receber a digitação. Desde 2026-11-07 o login é sempre visível; antes, o [[signInFlow]] trocava para o modo `hide` (alpha 1) do monitor antes de chamar o script.
- **`error:focus` não existe aqui.** O [[riotClient]] trata esse código, mas o script nunca o emite.
- **Tempo total.** 60 s para achar o formulário, mais a digitação, dentro do limite de 90 s do [[riotClient]].
- Regra geral: [[Segurança e privacidade]].
