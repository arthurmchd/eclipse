---
tipo: roadmap
tags: [changelog]
---

# Changelog

Mudanças relevantes, da mais nova para a mais antiga.

## 2026-10-26 · Reorganização profissional

- Código movido para `src/{main,core,riot,platform/windows,integration,renderer}`, scripts para `scripts/{dev,integration,legacy}`, testes espelhando `src/` ([[ADR-006 Estrutura de pastas por camada]], [[Estrutura de pastas]]).
- `src/paths.js` centraliza todos os caminhos do projeto ([[paths]]).
- `src/riotApi.js` renomeado para `src/core/rankApi.js`; `scripts/run-private-riot-host.js` virou `src/integration/host/hostEntry.js`.
- Comentários removidos de JS, CSS, HTML, PowerShell e C# embutido; o conhecimento foi para as notas dos módulos ([[ADR-005 Código sem comentários e conhecimento no vault]]).
- Documentação transformada neste vault do Obsidian; `ANALISE.md`, `INTEGRACAO-RIOT.md`, `COMPARACAO-ROSE.md` e `GUIA-GITHUB.md` viraram notas.
- `CLAUDE.md` e agentes do projeto em `.claude/agents/` ([[Trabalhando com agentes]]).
- `package.json`: `main` aponta para `src/main/index.js`; novo `start:riot-login`; `integration:prepare` virou `legacy:prepare-install`; `engines.node >= 22`.
- `.gitattributes` e `.editorconfig` para finais de linha e formatação consistentes.
- 230 testes passando antes e depois.

## Antes da reorganização

Melhorias já implementadas, registradas na antiga `ANALISE.md`:

- **Monitor persistente** de janelas no lugar do de três minutos ([[ADR-004 Monitor persistente de janelas]]).
- **Abertura em etapas:** monitor pronto antes do cliente; jogo só depois do Riot ID; sucesso exige janela visível.
- **Abertura direta:** conta atual reaproveitada sem reinício; trocas com `--headless`.
- **Intervenção controlada:** 2FA, CAPTCHA e atualizações informados no painel, sem abrir o cliente sozinho.
- **Cancelamento e recuperação** com liberação do botão Play mesmo em falha; restauração das janelas ao fechar.
- **Sessões corretas:** tokens da conta anterior salvos antes de carregar a escolhida; identidade desconhecida não é associada.
- **Armazenamento:** caminhos de sessão validados, gravação atômica, backups de edições sem churn de elo.
- **Falhas de execução** do Riot Client e dos auxiliares tratadas; comandos do monitor serializados.
- **Contexto de login:** limpar e inicializar antes de enviar a senha; CAPTCHA pré-submissão na interface escondida.
- **Painel MINHAS CONTAS** na tela de login real 141/142 ([[Integração com o Riot Client]]).
- **Serviço compartilhado** de login para a janela e o painel ([[signInService]]).
