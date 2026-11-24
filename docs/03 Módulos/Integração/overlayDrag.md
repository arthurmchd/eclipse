---
tipo: módulo
arquivo: src-tauri/src/integration/overlay/overlay_drag.rs
camada: integração
testes: src-tauri/tests/integration/overlay/overlay_drag.rs
tags: [módulo, tauri]
---

# overlayDrag

> Só no Tauri: quando o usuário arrasta a Riot pela barra de cima com os cartões à vista, ou aperta na faixa de cima dos cartões, assume o arraste e move a Riot e a sobreposição juntas, para os cartões não ficarem para trás.

## Responsabilidade

Cumpre a [[ADR-036 Arraste da Riot assumido pelo Eclipse]]. Recebe o aviso de começo de arraste do helper do [[riotWindowObserver]], decide se assume, toma a captura do mouse e, a cada movimento, põe as duas janelas no lugar num único `DeferWindowPos`.

Não move a Riot fora desse arraste, não redimensiona, não trata o arraste pelo teclado e não manda nenhum evento à Riot. No Electron não existe.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `install(hwnd, log)` | função | Na thread principal: registra `Eclipse.RiotDragStart` e prende o controle à janela da sobreposição (`SetWindowSubclass`) |
| `OverlayDrag` | struct | As decisões do arraste, sem Win32: `start`, `moved`, `released`, `capture_changed`, `beat` |
| `DragPlatform` | trait | O que as decisões pedem ao Windows; `WindowsDrag` é a real |
| `Outcome` | enum | Os quatro desfechos registrados no `sign-in.log` |
| `request_from_cards(hwnd)` | função | Posta `Eclipse.RiotDragStart` com `lParam` `FROM_CARDS` (1) na janela da sobreposição; vale de qualquer thread |
| `START_MESSAGE`, `BEAT_MS`, `MAX_RETAKES`, `LOOP_BEATS`, `FROM_CARDS` | constantes | Nome da mensagem, 15 ms, 3 retomadas, 3 batidas, origem nos cartões |

## Dependências

- Usa: aviso do [[riotWindowObserver]]
- Usado por: a janela do [[riotOverlay]] (`overlay_window.rs`), ligada pelo [[main]] com o `sign-in.log`

## Invariantes e decisões

- **Arraste pela área do Eclipse.** Desde 2026-11-21 ([[ADR-041 Arraste da Riot pela área do Eclipse]]), pedido do usuário: arrastar a Riot e o Eclipse juntos pela área dos cartões, que cobre a barra da Riot; desde 2026-11-23, só pela faixa de cima dela ([[ADR-048 Arraste só pela faixa de cima]]). A página dos [[cards]] pede `windowAction` `drag`, o [[riotOverlay]] chama `begin_drag` e a janela recebe a mensagem com `lParam` 1. `grab` assume sem o teste de `HTCAPTION`: a Riot é a dona da sobreposição, que o helper conferiu pelo executável oficial, e o ponto é da página do Eclipse. Exige sobreposição visível, dona e botão principal ainda apertado; um clique rápido já solto não faz nada. Toma a captura e confere com `GetCapture`; se não ficou com ela, registra uma vez e não mexe em nada. Daí segue igual ao arraste pela barra, sem laço da Riot para disputar a captura. O helper só posta `lParam` 0, então os dois caminhos não se confundem.
- **Quando assume.** Só se a sobreposição estiver visível, se a janela avisada for a dona dela (a que o helper conferiu pelo executável oficial), se o botão principal estiver apertado (`SM_SWAPBUTTON` decide qual) e se a Riot responder `HTCAPTION` ao `WM_NCHITTEST` no ponto do cursor. O teste de ponto usa `SendMessageTimeoutW` com `SMTO_ABORTIFHUNG` e 100 ms, para uma Riot travada não segurar a thread principal ali. Um aviso durante um arraste em curso é ignorado.
- **Captura.** A sobreposição chama `SetCapture` e confere, por `GetGUIThreadInfo` da thread da Riot, que a captura da fila agora é dela. Se não for, as filas não estão juntas: solta a sua, registra e não mexe em nada. O arraste segue com a Riot e o helper acompanha como antes.
- **Posição.** No começo, guarda o ponto agarrado (cursor menos o canto da janela da Riot) e o deslocamento da área cliente (`ClientToScreen` menos o canto da janela). A cada movimento: Riot no cursor menos o ponto agarrado, sobreposição na Riot mais o deslocamento. As duas vão juntas num `DeferWindowPos`, só com posição, sem ordem nem foco.
- **Fim.** Botão solto (`WM_LBUTTONUP`/`WM_RBUTTONUP` com o botão principal já solto), movimento com o botão solto, captura tomada por outra janela ou batida com o botão solto. A última posição é aplicada antes de soltar a captura.
- **Retomada.** Captura que vai para ninguém (`WM_CAPTURECHANGED` com `0`, ou batida sem captura) é tomada de novo, no máximo 3 vezes por arraste. Acontece quando o laço da Riot termina e solta a captura da fila, que já era nossa.
- **Batida.** `SetTimer` de 15 ms só durante o arraste: repete a posição (corrige a volta da Riot ao ponto inicial) e desiste se a Riot ainda estiver no próprio laço (`GUI_INMOVESIZE`) por 3 batidas.
- **Reentrada.** O estado mora num `thread_local` da thread principal. O `SetCapture`, o `ReleaseCapture` e o `DeferWindowPos` mandam mensagens à própria janela no meio de uma decisão; elas vão direto para o Tauri (`try_borrow_mut` falha e cai no `DefSubclassProc`), sem pânico dentro do procedimento da janela.
- **Mensagens tomadas.** Durante o arraste, `WM_MOUSEMOVE` e os botões soltos não chegam ao Tauri nem às webviews. `WM_CAPTURECHANGED` chega depois de lido. Fora do arraste, só a mensagem de começo e a batida são tomadas.
- **Registro.** Uma linha em inglês por desfecho, uma vez por execução, numa thread à parte (a thread principal não pega a trava do [[store]]). Sem posição, conta ou janela na linha. Se `install` falhar, uma linha diz que os cartões seguem como antes.
- **Fecho.** No `WM_NCDESTROY`, solta o controle e limpa o estado.

## Testes

Com uma plataforma falsa: pela área dos cartões, assume sem perguntar a barra, move pelo ponto agarrado e termina ao soltar; não assume oculta, sem dona ou com o botão solto; captura recusada registra uma vez e não move; segundo pedido ignorado e batida mantendo o arraste sem laço da Riot. Assume na barra e põe as duas janelas pelo ponto agarrado; cada movimento mantém o ponto sob o cursor, também em coordenadas negativas; não assume com a sobreposição oculta, outra dona, botão solto ou janela `0`; ponto fora da barra e captura que fica com a Riot não movem nada e registram uma vez; soltar o botão encerra e solta a captura; retomada até 3 vezes, pelo aviso e pela batida; captura de outra janela encerra sem soltá-la; batida repete a posição, encerra com o botão solto e desiste depois de 3 batidas no laço da Riot; segundo começo ignorado; linhas distintas, em inglês, uma vez por execução. Constantes conferidas com a ADR e o nome da mensagem conferido com o `DRAG_MESSAGE` do [[riotWindowObserver]]. Com duas janelas reais fora da tela: dona, posições, teste de ponto fora da barra, movimento conjunto, captura, temporizador e a mensagem postada por `request_from_cards`.

O laço de arraste do Windows não pode ser testado sem um mouse de verdade. Na Riot real, quem confere é o usuário.

## Pontos de atenção

- A captura entre processos depende de as filas de entrada estarem juntas pela relação de dona que o helper mantém. Sem ela, o Eclipse desiste e nada muda.
- Cada movimento espera a Riot aplicar a posição. Se a Riot travar no meio de um arraste, a thread principal do Eclipse espera junto.
- Esses arrastes não têm o encaixe do Windows nas bordas da tela.
- Se não funcionar na Riot real, a saída prevista na ADR é esconder os cartões durante o arraste.
