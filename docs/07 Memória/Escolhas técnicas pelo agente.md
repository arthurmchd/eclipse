---
tipo: memória
categoria: perfil
criada: 2026-11-13
atualizada: 2026-11-23
tags: [memória]
---

# Escolhas técnicas pelo agente

O usuário não avalia sozinho escolhas de tecnologia (linguagem, framework, biblioteca) e conta com a recomendação do agente.

**Por quê:** foi assim na troca do Electron pelo Tauri em 2026-11-13 ([[ADR-032 Migração para Tauri e Rust]]): o pedido era deixar o Eclipse mais leve, e a escolha da pilha ficou com o agente.

Vale também para design de tela: em 2026-11-23 ele pediu um visual para a aba Riot dizendo "não sei e não tenho ideias de design para colocar ali".

**Como aplicar:** diante de uma escolha técnica ou de design, dar uma recomendação clara com o motivo em linguagem simples, em vez de uma lista de opções para ele decidir. No design, implementar a proposta, conferir na prévia e mostrar o resultado; ele ajusta a partir do que vê.

## Relacionado

- [[Memória]]
