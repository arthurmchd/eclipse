---
tipo: índice
tags: [moc]
---

# Eclipse

Nome do app desde 2026-11-04 (antes Riot Account Manager). A pasta do projeto, o `name` do `package.json` e a pasta de dados continuam `riot-account-manager`; ver [[main]].

Desde 2026-11-15, na versão 2.0.0, o Eclipse é só Tauri e Rust (`src-tauri/`); o Electron saiu e está na tag `electron-final` ([[ADR-032 Migração para Tauri e Rust]], [[ADR-034 Troca do Electron pelo Tauri]], [[Migração para Tauri]]). Em `src/` ficam os cartões, a caixa, a cobertura e o preload dos cartões, que o Tauri serve. Desde a 2.19.0 não há mais `.ps1`: os helpers do Windows são Rust ([[ADR-044 Helpers do Windows em Rust]]).

Este vault é o cérebro do projeto. O código não tem comentários: o **porquê** de cada decisão, as regras de segurança e o mapa dos módulos ficam aqui. Antes de mudar um módulo, leia a nota dele; depois de mudar, atualize a nota.

## Comece por aqui

- [[Visão geral]]: o que o app faz e para quem
- [[Como usar]]: abrir, cadastrar contas, jogar
- [[Arquitetura]]: processos, camadas e como os módulos conversam
- [[Estrutura de pastas]]: onde fica cada coisa e o mapa da reorganização

## Arquitetura

- [[Fluxo de login]]: o que acontece entre o clique em Play e o jogo aberto
- [[Integração com o Riot Client]]: os cartões de contas sobre a janela oficial da Riot
- [[Armazenamento e dados]]: `data.json`, backups, sessões salvas e logs
- [[Segurança e privacidade]]: todas as regras que protegem senhas, tokens e sessões

## Módulos

Um modo só desde 2026-11-07 ([[ADR-028 Modo antigo removido]]): os [[cards]] sobre a Riot oficial, por [[riotOverlay]] · [[overlayToggle]] · [[overlayCover]] · [[riotWindowObserver]] · [[overlayDrag]] (Tauri).

| Camada | Notas |
|---|---|
| Aplicação | [[main]] · [[paths]] · [[store]] · [[managerService]] · [[signInService]] · [[sessionKeeper]] · [[riotWakeup]] · [[language]] · [[rankApi]] · [[opgg]] · [[rankWatcher]] · [[timers]] · [[refresher]] · [[appPorts]] · [[notices]] · [[updates]] (Tauri) |
| Riot | [[riotClient]] · [[riotState]] · [[gameRanks]] · [[signInFlow]] · [[riotAuthentication]] · [[riotInterface]] · [[riotAppControls]] · [[riotTransport]] · [[riotProcess]] · [[riotVersion]] |
| Windows | [[safeStorage]] (Tauri) · [[windowController]] · [[windowGuard]] · [[loginForm]] · [[win32]] · [[windowsEnvironment]] · [[riotWindowObserver]] · [[startWithWindows]] · [[toasts]] · [[electronInstance]] (Tauri) |
| Integração | [[riotOverlay]] · [[overlayToggle]] · [[overlayCover]] · [[overlayDrag]] (Tauri) · [[managerHost]] · [[manager-preload]] · [[backend]] · [[asar]] · [[assetProtocol]] · [[appUpdater]] (Tauri) |
| Interface | [[cards]] · [[sounds]] |

Notas dos módulos do modo antigo ficam em `03 Módulos/Removidos/`, só como histórico.

## Decisões

- [[ADR-009 Sobreposição no cliente oficial]]
- [[ADR-010 Login visível com progresso]]
- [[ADR-011 Cartões sobre a arte do Riot]]
- [[ADR-012 Sobreposição presa à janela do Riot]]
- [[ADR-013 Caixa para ocultar as contas na coluna de login]]
- [[ADR-014 Interface em português e inglês]]
- [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]
- [[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]
- [[ADR-017 Cartões cedem a vez aos avisos da Riot]]
- [[ADR-018 Arte da Riot desfocada atrás dos cartões]]
- [[ADR-019 Sessão salva por conta no modo cartões]]
- [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]
- [[ADR-021 Riot sempre abre desconectada]]
- [[ADR-022 Sessões de antes do modo cartões são descartadas]]
- [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]
- [[ADR-024 Coluna de login coberta durante o login]]
- [[ADR-025 Caixa some junto com o formulário da Riot]]
- [[ADR-026 Riot fechada depois do jogo reabre na tela de login]]
- [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]
- [[ADR-028 Modo antigo removido]]
- [[ADR-029 Estado da Riot definido num lugar só]]
- [[ADR-030 Eclipse instalado por um Setup próprio]]
- [[ADR-031 Elo lido do próprio jogo, sem chave]]
- [[ADR-032 Migração para Tauri e Rust]]
- [[ADR-033 Sobreposição no Tauri]]
- [[ADR-034 Troca do Electron pelo Tauri]]
- [[ADR-035 Posição da sobreposição movida pelo helper]]
- [[ADR-036 Arraste da Riot assumido pelo Eclipse]]
- [[ADR-037 Elo do League pelo OP.GG]]
- [[ADR-038 TFT, 2XKO e Runeterra no Eclipse]]
- [[ADR-039 Aparecer offline pelo chat da Riot]]
- [[ADR-040 Visual da Riot e sons da interface]]
- [[ADR-041 Arraste da Riot pela área do Eclipse]]
- [[ADR-042 CAPTCHA do formulário não bloqueia conta autorizada]]
- [[ADR-043 Preenchimento do login por UI Automation]]
- [[ADR-044 Helpers do Windows em Rust]]
- [[ADR-045 Atualização pelo GitHub]]
- [[ADR-046 Aviso do Manter login marcado como visto]]
- [[ADR-047 Fundo claro e estilo do jogo só nos cartões]]
- [[ADR-048 Arraste só pela faixa de cima]]
- [[ADR-049 Fundo escuro opcional]]
- [[ADR-050 Estandarte reduzido nos cartões]]
- [[ADR-051 Certificado guardado e conexão reaproveitada na API local]]
- [[ADR-052 Webviews da sobreposição num processo só]]

- [[ADR-001 Cópia privada da interface do Riot]] (substituída)
- [[ADR-002 Segredos protegidos pelo DPAPI]]
- [[ADR-003 Sem contornar CAPTCHA ou 2FA]]
- [[ADR-004 Monitor persistente de janelas]] (substituída)
- [[ADR-005 Código sem comentários e conhecimento no vault]]
- [[ADR-006 Estrutura de pastas por camada]]
- [[ADR-007 Interface completa dentro do Riot Client]] (substituída)
- [[ADR-008 Recuperação visual sem reexibir o Riot]] (substituída)
- [[Estudo - Comparação com o Rose]]
- [[Estudo - Gerenciadores no GitHub]]
- [[Estudo - Regras da Riot para vender o Eclipse]]
- [[Estudo - Visual da Riot]]

## Guias

- [[Desenvolvimento]]: comandos, testes, prévia no navegador
- [[Atualização do Riot Client]]: o que fazer quando a Riot lança uma versão nova
- [[Solução de problemas]]: logs, backups e recuperação
- [[Publicar no GitHub]]
- [[Trabalhando com agentes]]: como o Claude Code usa este vault
- [[Memória]]: o que o agente lembra entre conversas

## Roadmap

- [[Backlog]]: próximas melhorias, por prioridade
- [[Migração para Tauri]]: fases e onde cada módulo fica no Rust
- [[Limitações conhecidas]]
- [[Changelog]]
- [[Glossário]]
