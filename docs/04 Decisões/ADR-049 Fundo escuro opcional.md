---
tipo: decisão
status: aceita
data: 2026-11-23
tags: [adr, interface]
---

# ADR-049 Fundo escuro opcional

## Contexto

Pedido do usuário em 2026-11-23: "consegue criar um botao para mudar o tema de claro para escuro? mude apenas o fundo por enquanto". Desde a [[ADR-047 Fundo claro e estilo do jogo só nos cartões]], a página tem um fundo claro fixo.

## Decisão

**Um botão na faixa da lista alterna o fundo da página entre claro (o padrão da ADR-047) e escuro.** A escolha fica salva como `pageTheme` (`light` ou `dark`) nas configurações, como o visual dos cartões.

- No escuro muda só o fundo: `#111316`, com o brilho do canto e a grade de pontos em branco suave. O texto e os ícones que ficam direto sobre o fundo clareiam para continuar legíveis.
- Busca, filtros, caixas, avisos, rodapé e cartões ficam como na ADR-047. O usuário pediu "apenas o fundo por enquanto".

## Alternativas consideradas

- **Seguir o tema do Windows:** o usuário pediu um botão.
- **Tema escuro na página inteira:** fica para depois, a pedido do usuário.

## Consequências

- Uma configuração nova, `pageTheme`, validada no [[managerService]] e com padrão `light` no [[store]].
- A webview abre com `#f2f1ee` ([[riotOverlay]]); com o fundo escuro, pode aparecer um instante claro enquanto a página carrega.
- Conferido só na prévia. Não conferido sobre a Riot real.

## Relacionado

- [[ADR-047 Fundo claro e estilo do jogo só nos cartões]] · [[cards]] · [[store]] · [[managerService]]
