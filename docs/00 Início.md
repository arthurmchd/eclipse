---
tipo: índice
tags: [moc]
---

# Eclipse

Nome do app desde 2026-11-04 (antes Riot Account Manager). A pasta do projeto, o `name` do `package.json` e a pasta de dados continuam `riot-account-manager`; ver [[main]].

Este vault é o cérebro do projeto. O código não tem comentários: o **porquê** de cada decisão, as regras de segurança e o mapa dos módulos ficam aqui. Antes de mudar um módulo, leia a nota dele; depois de mudar, atualize a nota.

## Comece por aqui

- [[Visão geral]]: o que o app faz e para quem
- [[Como usar]]: abrir, cadastrar contas, jogar
- [[Arquitetura]]: processos, camadas e como os módulos conversam
- [[Estrutura de pastas]]: onde fica cada coisa e o mapa da reorganização

## Arquitetura

- [[Fluxo de login]]: o que acontece entre o clique em Play e o jogo aberto
- [[Integração com o Riot Client]]: seleção e gerenciamento completo de contas dentro da janela Riot
- [[Armazenamento e dados]]: `data.json`, backups, sessões salvas e logs
- [[Segurança e privacidade]]: todas as regras que protegem senhas, tokens e sessões

## Módulos

Modo padrão: [[riotOverlay]] · [[overlayToggle]] · [[overlayCover]] · [[riotWindowObserver]].
Interface compacta: [[cards]].

| Camada | Notas |
|---|---|
| Aplicação | [[main]] · [[preload]] · [[paths]] · [[store]] · [[managerService]] · [[signInService]] · [[sessionKeeper]] · [[riotWakeup]] · [[language]] · [[rankApi]] |
| Riot | [[riotClient]] · [[signInFlow]] · [[riotAuthentication]] · [[riotInterface]] · [[riotAppControls]] · [[riotTransport]] · [[riotProcess]] |
| Windows | [[windowController]] · [[windowGuard.ps1]] · [[login.ps1]] · [[windowsEnvironment]] · [[windowsDpapi]] |
| Integração | [[privateClient]] · [[hostEntry]] · [[privateHost]] · [[privateHostCore]] · [[privateRendererCore]] · [[managerHost]] · [[manager-preload]] · [[addons]] · [[bridgeServer]] · [[bootstrapChannel]] · [[backend]] · [[asar]] · [[status]] · [[Scripts de integração]] |
| Interface | [[renderer]] |

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

- [[ADR-001 Cópia privada da interface do Riot]]
- [[ADR-002 Segredos protegidos pelo DPAPI]]
- [[ADR-003 Sem contornar CAPTCHA ou 2FA]]
- [[ADR-004 Monitor persistente de janelas]]
- [[ADR-005 Código sem comentários e conhecimento no vault]]
- [[ADR-006 Estrutura de pastas por camada]]
- [[ADR-007 Interface completa dentro do Riot Client]]
- [[ADR-008 Recuperação visual sem reexibir o Riot]]
- [[Estudo - Comparação com o Rose]]

## Guias

- [[Desenvolvimento]]: comandos, testes, prévia no navegador
- [[Atualização do Riot Client]]: o que fazer quando a Riot lança uma versão nova
- [[Solução de problemas]]: logs, backups e recuperação
- [[Publicar no GitHub]]
- [[Trabalhando com agentes]]: como o Claude Code usa este vault

## Roadmap

- [[Backlog]]: próximas melhorias, por prioridade
- [[Limitações conhecidas]]
- [[Changelog]]
- [[Glossário]]
