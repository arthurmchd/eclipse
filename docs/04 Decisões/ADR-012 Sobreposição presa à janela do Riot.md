---
tipo: decisão
status: aceita
data: 2026-11-04
tags: [adr, arquitetura, interface, janelas]
---

# ADR-012 Sobreposição presa à janela do Riot

## Contexto

Pela [[ADR-009 Sobreposição no cliente oficial]], a sobreposição era uma janela sempre no topo que só aparecia com o Riot em primeiro plano, e o [[riotWindowObserver]] lia a posição a cada 180 ms. O usuário relatou dois problemas em 2026-11-04:

- ao trocar para outro programa, os cartões somem e só voltam quando o Riot volta ao primeiro plano;
- ao arrastar o Riot Client, os cartões seguem com atraso.

O pedido foi que o gerenciador ficasse "preso com fita" à janela da Riot.

## Decisão

- **A janela da Riot passa a ser dona da sobreposição.** O helper do observador define o dono da janela da sobreposição (`GWLP_HWNDPARENT`) como a janela da Riot escolhida. A partir daí o Windows mantém a sobreposição logo acima da Riot na ordem das janelas, esconde as duas juntas ao minimizar e deixa outros programas cobrirem as duas. A sobreposição deixa de ser `alwaysOnTop`, não chama mais `moveTop` e não depende do foco: aparece sempre que a Riot está visível e na tela de login. Com a Riot minimizada, o gerenciador esconde a sobreposição ele mesmo e a mostra de novo quando a Riot é restaurada, sem refazer a sessão. Deixar o Windows trazer a sobreposição de volta junto com a dona foi testado e descartado: com a Riot real, a janela da Riot voltava sozinha logo depois de minimizar, sem desenhar nada (ver [[riotOverlay]]).
- **A posição segue eventos do Windows.** O helper assina `EVENT_OBJECT_LOCATIONCHANGE` só do processo da Riot escolhida e envia a nova posição assim que a janela se move ou muda de tamanho. A leitura a cada 180 ms continua para descobrir a janela e como sinal de vida.
- O helper só altera a janela da sobreposição, e só se ela pertencer ao processo do gerenciador. Nenhuma janela da Riot é modificada. Se não conseguir definir o dono, o helper encerra com erro e a sobreposição fica oculta.

## Alternativas consideradas

- **Janela filha (`SetParent`) dentro da Riot.** Acompanharia o movimento sem nenhum atraso, mas mete uma janela Electron dentro da árvore de janelas do Chromium da Riot. Foco, pintura transparente e travamentos ficariam acoplados ao Riot de forma frágil.
- **Reordenar a sobreposição por eventos de foco.** Sem relação de dono, seria preciso trazer os cartões de volta para cima toda vez que o Riot fosse ativado. Isso causa um quadro piscando e depende de acertar todos os eventos de ordem.
- **Esconder durante o arraste.** Elimina o atraso visível, mas os cartões sumiriam a cada movimento; o usuário pediu o contrário.

## Consequências

- Os cartões ficam visíveis junto com o Riot mesmo com outro programa em foco, e cobertos quando esse programa está por cima.
- Ao arrastar, os cartões seguem a janela a cada evento de posição. Ainda pode haver um atraso de cerca de um quadro, porque são duas janelas separadas.
- Uma relação de dono entre processos faz o Windows ligar as filas de entrada das duas janelas. Se a interface da Riot travar, a sobreposição pode travar junto até a janela da Riot fechar. Fechar a janela da Riot não destrói a sobreposição: ela só perde o dono (testado em 2026-11-04 com janelas de teste).
- A regra da [[ADR-009 Sobreposição no cliente oficial]] de sumir ao trocar de programa deixa de valer. As demais regras (sem arquivos da Riot alterados, sem injeção, observador sem ler conteúdo) continuam.

## Relacionado

- [[riotOverlay]]
- [[riotWindowObserver]]
- [[Arquitetura]]
