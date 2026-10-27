---
tipo: decisão
status: aceita
data: 2026-10-26
tags: [adr, processo]
---

# ADR-005 Código sem comentários e conhecimento no vault

## Contexto

O código tinha cerca de 330 linhas de comentários, quase todas boas: explicavam invariantes de segurança e decisões ("nunca reenviar a senha sobre um CAPTCHA"). O dono do projeto quer o código limpo, sem comentários, e um lugar único onde humanos e agentes de IA encontrem o porquê.

## Decisão

- O código-fonte (JS, CSS, HTML, PowerShell e o C# embutido) não tem comentários.
- O conhecimento que estava neles foi transferido para as notas dos módulos em `03 Módulos/`, seção **Invariantes e decisões**.
- Regras transversais ficam em [[Segurança e privacidade]] e nas notas de arquitetura.
- Nomes de funções e variáveis devem carregar o "o quê"; o vault carrega o "porquê".

**Exceção:** os blocos `/* RAM_... */` dentro de template strings em [[privateHostCore]] e [[privateRendererCore]] **não são comentários do projeto**. São marcadores injetados no código do Riot e conferidos em tempo de execução. Não remova.

## Como foi feito

Um script com analisador léxico (respeitando strings, template literals e expressões regulares) removeu os comentários, e o diff foi conferido para garantir que só comentários saíram. Os originais continuam no histórico do git: `git show 5c5b7e0:<caminho antigo>`.

## Consequências

- Mudou um invariante? A nota do módulo muda no mesmo commit. O `CLAUDE.md` na raiz do projeto obriga isso para agentes.
- Quem lê só o código perde o contexto; o vault precisa estar aberto ou ser consultado.
- Testes passam a ser a documentação executável mais importante: um invariante sem teste deve ganhar um.

## Relacionado

- [[Trabalhando com agentes]] · [[Estrutura de pastas]]
