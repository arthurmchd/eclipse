---
tipo: guia
tags: [processo, ia]
---

# Trabalhando com agentes

O projeto foi preparado para ser mantido junto com o Claude Code. O vault é a memória compartilhada: o agente lê antes de mexer e escreve depois de mexer.

## Peças

| Peça | Onde | Para quê |
|---|---|---|
| `CLAUDE.md` | raiz do projeto | Regras que todo agente segue: ler a nota do módulo, manter o código sem comentários, atualizar o vault, rodar os testes |
| `vault-keeper` | `.claude/agents/vault-keeper.md` | Depois de uma mudança de código, atualiza as notas afetadas e o [[Changelog]] |
| Templates | `docs/_templates/` | [[Módulo]], [[Decisão]], [[Tarefa]] |

O agente `riot-update-checker` conferia as âncoras da cópia privada e saiu com ela em 2026-11-07 ([[ADR-028 Modo antigo removido]]).

## Ciclo de uma mudança

1. **Contexto.** O agente lê [[00 Início]], a nota do módulo e [[Segurança e privacidade]].
2. **Decisão.** Se a mudança altera uma regra de segurança ou de arquitetura, cria uma nota em `04 Decisões/` primeiro.
3. **Código e teste.** Sem comentários; o teste espelhado em `test/` cobre o comportamento novo.
4. **Vault.** A seção "Invariantes e decisões" da nota do módulo recebe o porquê. O [[Changelog]] ganha uma linha.
5. **Verificação.** `npm test` passando.

## Pedidos úteis

- "Use o vault-keeper para atualizar as notas do que mudou."
- "Pegue o item 1 do Backlog e resolva com teste."
- "A Riot atualizou; confira os pontos de [[Atualização do Riot Client]]."
- "Explique o fluxo de troca de conta usando o vault."

## Abrir o vault

No Obsidian: **Open folder as vault** → `riot-account-manager/docs`. O grafo colore os módulos por camada e as decisões em rosa. Os favoritos já trazem Início, Arquitetura e Backlog.
