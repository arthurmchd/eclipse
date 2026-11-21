---
tipo: módulo
arquivo: src-tauri/src/platform/windows/login_form.rs
camada: plataforma
testes: src-tauri/tests/platform/windows/login_form.rs
tags: [módulo]
---

# loginForm

> Preenche o formulário de login do Riot Client por dentro do processo do Eclipse, falando só com a janela da Riot. Rota usada pelo [[riotClient]] quando o [[signInFlow]] cai no formulário nativo.

## Responsabilidade

- Acha a janela de login do Riot, mesmo oculta, e espera o formulário carregar.
- Preenche usuário e senha pelo UI Automation da janela e, se não der, digita por mensagens. Deixa "Stay signed in" no estado pedido (`remember`) quando reconhece a caixa e clica em entrar.
- Não mostra janelas, não injeta teclado global e não move o mouse do usuário. Visibilidade e foco são do [[windowGuard]]; o preenchimento pelo UI Automation pode trazer a Riot para a frente (ver as decisões).
- Não resolve CAPTCHA nem 2FA.

Até a 2.18.1 isso era o `login.ps1`, um PowerShell com C# embutido que o [[riotClient]] abria a cada login ([[ADR-044 Helpers do Windows em Rust]]).

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `LoginForm` | trait | `fill(usuário, senha, remember, cancel) -> Result<FillReport, FillFailure>`. Trocável nos testes do [[riotClient]] |
| `NativeLoginForm` | struct | O real: valida as credenciais e roda o preenchimento numa thread própria com COM em MTA |
| `FillReport` | struct | `input` (`InputMethod::Automation` = `uia`, `Keys` = `keys`) e `remember` (`On`, `Off`, `Unknown`) |
| `FillFailure` | enum | `code()` em lista fechada: `invalid-credentials`, `window-not-found`, `form-not-ready`, `input-failed`, `window-script-failed`, `cancelled` |
| `USERNAME`, `PASSWORD`, `REMEMBER`, `SUBMIT`, `PANEL` | constantes | Posições em fração da área cliente (tabela abaixo) |
| `remember_state`, `form_ready`, `select_fields`, `client_frame`, `Shot`, `valid_credential`, `point`, `scaled` | funções puras | As regras de cor, prontidão, escolha de campos e quadro, testadas sem janela |

## Dependências

- Usa: [[win32]] (processos e janelas), `windows-sys` (`user32`, `gdi32`, `PrintWindow`), o crate `windows` para o UI Automation por COM.
- Usado por: [[riotClient]] (`fill_login_form`), quando o [[signInFlow]] cai no formulário nativo.

## Sequência de `fill`

1. Valida usuário e senha: não vazios, até 256 caracteres, sem CR, LF ou NUL. Falha sem tocar em janela.
2. Abre uma thread `eclipse-login-form`, com `CoInitializeEx` em MTA e consciência de DPI por monitor (`PER_MONITOR_AWARE_V2`) só nessa thread.
3. Por até 60 s, a cada 250 ms, procura a janela. O formulário está pronto após 4 leituras seguidas da mesma janela com `Shot::ready`. O cancelamento é conferido a cada volta.
4. Tenta o UI Automation: por até 3 s, a cada 100 ms, lê os campos `Edit` dentro da janela achada, só de processos `Riot Client` ou `RiotClientUx`. Só segue com exatamente um campo de senha e um outro, ambos habilitados e editáveis (`select_fields`). Preenche a senha, depois o usuário, e espera até 1,5 s, a cada 50 ms, o usuário aparecer igual ao pedido. Qualquer falha cai no passo seguinte.
5. Só sem o UI Automation: clica no campo de usuário, limpa e digita. Repete no campo de senha.
6. Lê a caixa. Se o estado é reconhecido e difere do pedido, clica uma vez e lê de novo. Com `Unknown`, não clica.
7. Clica em entrar e devolve o relatório. O [[riotClient]] o transforma nas linhas `input:…`, `remember:…`, `ok` que o [[signInFlow]] lê.

## Detalhes

- **Janela:** PIDs de `Riot Client` e `RiotClientUx`. Só janelas raiz com área cliente de ao menos 500×300. Pontuação = área + 100 000 000 se tiver título.
- **Pronto:** proporção entre 1,6 e 1,95; painel com RGB ≥ 240; campos de usuário e senha com RGB ≥ 220.
- **Caixa "remember":** 25 amostras em grade 5×5 (passos de 2 px) em volta de `REMEMBER`. Cada amostra é vermelha (R ≥ 150, G e B ≤ 110), cinza (canais entre 205 e 243, com diferença de até 12) ou outra. Uma amostra escura (canal mais alto ≤ 140) dá `Unknown` na hora. 10 ou mais vermelhas e nenhuma cinza → `On`. 20 ou mais cinzas e nenhuma vermelha → `Off`. Senão `Unknown`.
- **Clique:** `WM_MOUSEMOVE`, `WM_LBUTTONDOWN`, 40 ms, `WM_LBUTTONUP`, 300 ms, por `PostMessageW`. Coordenadas são frações da área cliente.
- **Limpeza:** `End`, depois 256 `Backspace` com 3 ms entre eles.
- **Digitação:** um `WM_CHAR` por unidade UTF-16, com 35 ms.
- **Captura:** `PrintWindow` com flag 2 numa DIB do tamanho da janela, até 10000×10000. Os pixels são lidos no quadro da área cliente (`client_frame`); se o quadro não couber no bitmap, a leitura falha e o formulário não conta como pronto.

Posições (fração de largura e altura da área cliente):

| Ponto | Valor |
|---|---|
| `USERNAME` | 0.130, 0.303 |
| `PASSWORD` | 0.130, 0.377 |
| `REMEMBER` | 0.0417, 0.5023 (o [[riotWindowObserver]] lê o mesmo ponto como `BOX` para saber se o formulário sumiu; um teste confere que são iguais) |
| `SUBMIT` | 0.1302, 0.7894 |
| `PANEL` | 0.026, 0.5 (o mesmo ponto é lido pelo [[riotWindowObserver]] para ver se um modal da Riot escureceu a janela; um teste confere) |

## Invariantes e decisões

- **Em Rust, dentro do Eclipse (2026-11-21, [[ADR-044 Helpers do Windows em Rust]]).** Saíram o `powershell.exe -ExecutionPolicy Bypass`, o `Add-Type` a cada login e as credenciais no stdin de outro processo. O código é a mesma lógica do `login.ps1` da 2.18.1, regra por regra; os números e as cores não mudaram. As credenciais agora não saem do processo do Eclipse.
- **Thread própria com COM.** O UI Automation precisa de COM inicializado; a thread de login do [[signInFlow]] não é dona disso, então o preenchimento roda numa thread curta que inicializa e libera o COM. A consciência de DPI também fica só nela.
- **Sem pânico.** O release usa `panic = "abort"`; toda falha vira `FillFailure`, e uma thread que não sobe dá `window-script-failed`.
- **Sempre envia.** Desde 2026-11-07 ([[ADR-028 Modo antigo removido]]) não existe preencher sem enviar.
- **UI Automation primeiro, mensagens de recuo.** Desde 2026-11-21 ([[ADR-043 Preenchimento do login por UI Automation]]). Campos ausentes, a mais, erro ou usuário diferente do pedido caem na digitação por mensagens, que limpa e digita de novo.
- **Só a janela e os processos do Riot.** O UI Automation parte do HWND achado (`ElementFromHandle`) e só procura dentro dele. O campo "Search accounts" dos cartões aparece como descendente da janela da Riot, num processo do WebView2; por isso só contam campos cujo processo é `Riot Client` ou `RiotClientUx`.
- **Senha primeiro, usuário por último, esperando o valor.** No Chromium da Riot, o `SetValue` é assíncrono: lido na hora, o campo vem vazio; 200 ms depois, certo. O usuário certo indica que a senha também já foi aplicada, sem lê-la de volta. Na 2.18.1, 6 de 6 logins reais usaram `input:uia`. O valor do usuário só é comparado aqui dentro e nunca sai; a senha nunca é lida de volta.
- **Foco no UI Automation.** Numa janela WPF de teste, o `SetValue` trouxe a janela para a frente. O [[signInFlow]] já traz a Riot para a frente no começo do login.
- **Limpar sem `Ctrl+A`.** `End` e `Backspace` locais limpam o campo sem depender do estado global das teclas modificadoras.
- **35 ms por caractere.** O Chromium perde caracteres postados rápido demais.
- **`EnumWindows` acha janelas ocultas.** Inclui janelas transparentes e em `SW_HIDE`, prefere a maior janela Riot com título e aceita títulos traduzidos.
- **Posições medidas no Riot Client v141, cores da caixa no v142.** Com a área cliente em 1536×864, a caixa ocupa x 56–71 e y 426–441, centro em (64, 434). Um layout futuro pode exigir novas posições.
- **Imagens só em memória.** Nunca são salvas nem registradas. Os objetos GDI são liberados mesmo quando `PrintWindow` falha.
- **Não clicar em caixa desconhecida.** Alternar no escuro poderia desligar uma sessão persistente ou clicar em outra coisa. O login ainda funciona sem sessão salva se um tema futuro não for reconhecido.
- **Pixels e cliques no mesmo quadro.** A janela do Riot tem bordas invisíveis (1552×872 de janela para 1536×864 de área cliente, em (8, 0)). Toda leitura parte do quadro da área cliente; um teste confere com um bitmap de borda de 8 px.
- **Erro sem dados do pedido.** O erro é só um código da lista fechada; nada do pedido aparece.

## Testes

`src-tauri/tests/platform/windows/login_form.rs`, sem tocar em janelas:

- cores da caixa: cinza e cinza com o mouse dão `Off`; vermelho com o visto dá `On`; painel, poucas cinzas, poucas vermelhas, vermelho com cinza, escuro e cor intermediária dão `Unknown`;
- num bitmap com borda de 8 px, a caixa só é reconhecida no quadro da área cliente; o quadro precisa caber no bitmap;
- prontidão pela proporção, pelo painel e pelos dois campos;
- escolha dos campos do UI Automation: só um usuário e uma senha usáveis;
- credenciais inválidas são recusadas pelo `NativeLoginForm` antes de procurar janela;
- posições, nomes e códigos fixos.

O preenchimento real precisa da janela do Riot e não tem teste automatizado. O [[riotClient]] tem testes com um `LoginForm` falso.

## Pontos de atenção

- **Layout fixo.** As coordenadas e as cores dependem do tema do cliente: [[Atualização do Riot Client]].
- **Precisa da janela renderizando.** A janela não pode estar em `SW_HIDE` para receber a digitação; o login é sempre visível desde 2026-11-07.
- **Tempo total.** Até 60 s para achar o formulário, mais até 4,5 s do UI Automation e a digitação de recuo. Não há mais o limite de 90 s do processo externo; o cancelamento do [[signInFlow]] é conferido entre as etapas.
- **Acessibilidade do Chromium.** Consultado pelo UI Automation, o Chromium da Riot liga a acessibilidade e a mantém enquanto estiver aberto.
- Regra geral: [[Segurança e privacidade]].
