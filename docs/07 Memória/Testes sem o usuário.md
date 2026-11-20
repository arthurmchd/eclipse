---
tipo: memória
categoria: preferência
criada: 2026-11-13
atualizada: 2026-11-20
tags: [memória, testes]
---

# Testes sem o usuário

Para testar o Eclipse sem o usuário, o agente usa só capturas de tela pelo PowerShell limitadas às janelas do próprio Eclipse. O usuário recusou o controle da tela inteira (computer use), uma Riot falsa para testes e o Playwright pelo CDP do WebView2.

**Por quê:** escolha do usuário em 2026-11-13, na [[Migração para Tauri]]. Ele já preferia não ter a tela capturada (Changelog de 2026-11-08) e quer o mínimo de ferramentas.

**Como aplicar:** conferir o visual capturando só janelas do Eclipse, nunca a janela da Riot nem a área de trabalho inteira. O resto vai por testes com dependências falsas injetadas. Pedir antes de qualquer conferência na Riot real.

## Relacionado

- [[Memória]]
- [[Desenvolvimento]]
