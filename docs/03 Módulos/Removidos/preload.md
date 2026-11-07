---
tipo: referência
status: removido
removido-em: 2026-11-07
arquivo-anterior: src/main/preload.js
tags: [módulo, histórico]
---

# preload

> [!note] Removido em 2026-11-07
> O preload da janela independente já tinha saído; a API da view é a do [[manager-preload]]. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

O preload da janela independente foi substituído pelo [[manager-preload]]. A interface completa mantém `window.api`, mas agora o IPC pertence somente ao `WebContentsView` hospedado na janela Riot por [[managerHost]].

Os antigos canais globais da janela não são o contrato da migração. Comandos de contas, configurações, elos e clipboard são validados pelo [[managerService]] e encaminhados pela ponte local autenticada; eventos são consultados por cursor.

## Invariantes e decisões

- A API completa não é exposta à página Riot nem a iframes.
- O renderer de contas conserva sandbox e isolamento de contexto, com Node desabilitado.
- Senhas e chaves persistidas nunca são devolvidas à interface; ela só envia valores recém-digitados.
- A decisão está em [[ADR-007 Interface completa dentro do Riot Client]].

## Relacionado

- [[manager-preload]] · [[managerHost]] · [[renderer]] · [[managerService]] · [[Segurança e privacidade]]
