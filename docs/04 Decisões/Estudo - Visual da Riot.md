---
tipo: estudo
data: 2026-11-20
tags: [estudo, interface, design]
---

# Estudo - Visual da Riot

Pedido do usuário em 2026-11-20: deixar o Eclipse "com mais cara de Riot Games", em cores, animações, bibliotecas, tamanhos e jeito de usar as coisas.

Fontes, lidas sem escrever nada: o `app.asar` do Riot Client instalado (`C:\Riot Games\Riot Client\RiotClientElectron\resources`), lido como o [[asar]] faz, e o kit de interface do cliente do League (`rcp-fe-lol-uikit`) pela CommunityDragon, já que o instalado vem empacotado em `.wad`. VALORANT não foi lido; as cores dele são as que o Eclipse já usa.

## Riot Client (2026-11-19)

- **Bibliotecas:** React, Redux, TanStack Query, Radix UI, i18next, Rive (3 animações `.riv`) e Lottie. O design system interno se chama RCDS (variáveis `--rcds-*`).
- **Fontes:** Inter (livre, licença OFL) é a principal. Também Riot Sans e Riot Sans 2.0, Neue Haas Grotesk Text Pro, Kensington, Eurostile, Latino Gothic, Readex Pro e Noto para CJK e tailandês. Só a Inter pode ir num Setup público; as outras são da Riot ou licenciadas.
- **Cinzas:** `#0A0A0A` (004), `#1F1F1F` (012), `#4A4A4A` (029), `#636363` (039), `#808080` (050), `#BABABA` (073), `#C7C7C7` (078), `#F5F5F5` (096), `#FCFCFC` (099).
- **Cores de marca e estado:** vermelho Riot `#D53235` (escuro `#BE272A`, claro `#EB6567`); sucesso `#1E9469`; alerta `#FAB514`; erro roxo `#BA27E7`; neutro azul `#27B1DB`.
- **Cantos:** botão grande 24 px, médio 20 px, pequeno 6,4 px; menu 16 px; item de menu e item social 8 px; caixa de seleção e dica 4 px; tag 3,2 px; lista suspensa 2 px.
- **Sombras:** modal `0 0 40px rgba(0,0,0,.8)`; dica `0 0 50px rgba(0,0,0,.25), 0 0 20px rgba(0,0,0,.1)`; botão `0 1px 4px`.
- **Tipografia:** tamanhos 10, 12, 14, 16, 18, 20, 24, 32, 40 e 64 px; `letter-spacing` de -0,01em a -0,02em nos textos, de 0,4 a 0,6 px nos rótulos em maiúsculas.
- **Movimento:** curvas `cubic-bezier(.05,.7,0,1)`, `(.2,0,0,1)` e `(.13,0,0,1)`; durações de 100, 167, 200, 300, 333 e 500 ms. 167 e 333 ms são 10 e 20 quadros a 60 fps.

## Cliente do League

- **Componentes:** elementos próprios `lol-uikit-*` sobre Ember.
- **Fontes:** `--font-display` (Beaufort for LOL) e `--font-body` (Spiegel), ambas da Riot, sem licença para redistribuir.
- **Cores mais usadas:** `#F0E6D2` (texto claro), `#1E2328`, `#463714`, `#A09B8C` (texto secundário), `#785A28` e `#C8AA6E` (dourados), `#CDBE91`, `#010A13` (fundo), `#C89B3C`, `#005A82`, `#0596AA` e `#CDFAFA` (azul hextech).
- **Bordas:** dourado em degradê vertical, `linear-gradient(to bottom, #785a28, #c8aa6e)`, cantos retos.
- **Texto:** botões em maiúsculas com `letter-spacing` de 0,025em a 0,1em.
- **Movimento:** curvas `cubic-bezier(.2,.9,0,1)` e `(.02,.85,.08,.99)`.
- **Sons de interface:** cerca de 30 `.ogg` (passar o mouse e clicar no botão dourado, caixa de seleção, lista suspensa, botão "mágico", aviso de recompensa).

## Cuidados

- As fontes da Riot, os sons e as artes ficam fora do Setup. Se usados, vêm da instalação da própria pessoa ou da CommunityDragon na hora, como os ícones e emblemas.
- O Eclipse não pode usar o logo da Riot como marca própria. Desde a 2.31.0 a [[overlayCover]] mostra o logo da Riot só onde a própria Riot o desenha, sobre a janela dela, lido da instalação da pessoa ([[riotLogo]]); ele não aparece em nenhum outro lugar do Eclipse. A política da Riot para projetos de fãs pede o aviso "não é endossado pela Riot Games".
