---
tipo: roadmap
tags: [changelog]
---

# Changelog

Mudanças relevantes, da mais nova para a mais antiga.

## 2026-10-26 · "The Riot Client window did not open"

- **Causa:** quando a Riot exige CAPTCHA antes da senha, o login cai no formulário nativo escondido. Para abrir a interface, o código chamava `RiotClientServices.exe` de novo, mas os serviços já rodavam em `--headless`, e a chamada não abria janela. O [[login.ps1]] esperava 60 s e falhava. Acontecia em toda troca de conta sem sessão salva válida, inclusive pelo painel MINHAS CONTAS.
- **Correção:** novo módulo [[riotInterface]]. Ele pede a interface aos serviços (`POST /riot-client-lifecycle/v1/show`) e, se ela não aparecer em 10 s, reinicia os serviços com interface (oculta pelo monitor). É seguro porque nenhuma senha foi enviada nesse ponto.
- O caminho usado vai para o `sign-in.log`. 7 testes novos; 240 passando (1 pulado por exigir o Riot fechado).
- Diagnóstico registrado em [[Solução de problemas]], incluindo a cópia virtualizada do `sign-in.log` vista por apps empacotados.

## 2026-10-26 · Segurança do login

- **Sem segundo envio de senha.** Uma resposta 404/405/501 ao `complete` (senha já enviada) agora é erro, em vez de `{ supported: false }`, que levava o [[signInFlow]] a digitar a senha de novo no formulário nativo ([[riotAuthentication]]).
- **Sessão do jogador falha fechada.** `sessionState` troca a lista de bloqueios por uma lista de estados permitidos (`NON_BLOCKING_SESSION_STATES`). Estados desconhecidos e 19 estados de bloqueio que o projeto não conhecia (restrições de idade e de jogo, e-mail dos pais, 2FA negado, escolhas de conta e plataforma…) agora exigem intervenção em vez de liberar o jogo. Lista tirada da enumeração `PlayerSessionStateType` do Riot 142.
- 4 testes novos; 234 passando.

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
