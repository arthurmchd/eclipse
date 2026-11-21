---
tipo: decisão
status: aceita
data: 2026-11-19
tags: [adr]
---

# ADR-038 TFT, 2XKO e Runeterra no Eclipse

## Contexto

O usuário mandou a barra lateral de jogos do Riot Client (League of Legends, VALORANT, Teamfight Tactics, 2XKO e Legends of Runeterra) e pediu os mesmos ícones no rodapé do Eclipse, só ícones, com os três jogos que faltavam. Até aqui o Eclipse abria só o League e o VALORANT. O `tft` existia no backend, mas abria o produto `league_of_legends` e nenhum botão o mandava.

## Decisão

Os cinco jogos ficam no rodapé, na ordem da Riot, e o Jogar abre cada um pelo seu próprio produto no `product-launcher` da Riot: `league_of_legends`, `valorant`, `teamfighttactics`, `lion` (2XKO) e `bacon` (Legends of Runeterra). O login espera o processo e a janela do próprio jogo: `TFTClient.exe`/`TFTClient-Win64-Shipping.exe`, `Lion.exe`/`Lion-Win64-Shipping.exe` e `LoR.exe`. Esses processos também entram na lista que o Eclipse fecha ao trocar de conta, como os do League e do VALORANT, sempre depois da confirmação do usuário.

## De onde vieram os nomes

- Produtos: os nomes das pastas em `C:\ProgramData\Riot Games\Metadata\` (`<produto>.<patchline>`), só lidas.
- Processos do TFT: o executável instalado em `C:\Riot Games\Teamfight Tactics\Live\`.
- Processos do 2XKO e do Runeterra: os nomes de arquivo nos manifestos `lion.live.preview.manifest` e `bacon.live.preview.manifest` da mesma pasta (corpo zstd), só lidos. Os dois jogos não estão instalados nesta máquina, então o login deles não foi visto funcionando.

## Alternativas consideradas

- **Só os ícones, sem abrir os jogos novos:** o pedido era trazer os jogos para o Eclipse; um botão que não abre nada confundiria.
- **TFT pelo produto do League:** a Riot instala o TFT como produto próprio (`teamfighttactics`), com pasta e executável próprios; abrir o League no lugar estaria errado.
- **Copiar os ícones dos arquivos do Riot Client:** não há imagens soltas na instalação, e o anexo tem só 20 px. Os ícones foram redesenhados em SVG a partir do anexo; não ficaram bons, e o usuário baixou e mandou os ícones usados hoje.

## Consequências

- O TFT mostra nos cartões o elo de Ranqueada e Dupla (`stats.tft`), com os emblemas do League. 2XKO e Runeterra não têm elo no Eclipse: os cartões mostram o último jogo com elo escolhido, como a aba Riot, e a linha da conta diz o nome do jogo.
- Se a Riot mudar o nome de um produto ou executável, o login daquele jogo espera até o tempo limite e diz que o jogo não abriu. Os nomes ficam em `riot_client.rs` (`TFT_PROCESSES`, `XKO_PROCESSES`, `LOR_PROCESSES`, `product`) e no `GameProcess` do [[windowGuard]].

## Relacionado

- [[cards]] · [[signInFlow]] · [[riotClient]] · [[windowGuard]] · [[riotState]] · [[appPorts]] · [[managerService]]
