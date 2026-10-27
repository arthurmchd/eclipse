---
tipo: índice
tags: [moc]
---

# Riot Account Manager

Este vault é o cérebro do projeto. O código não tem comentários: o **porquê** de cada decisão, as regras de segurança e o mapa dos módulos ficam aqui. Antes de mudar um módulo, leia a nota dele; depois de mudar, atualize a nota.

## Comece por aqui

- [[Visão geral]]: o que o app faz e para quem
- [[Como usar]]: abrir, cadastrar contas, jogar
- [[Arquitetura]]: processos, camadas e como os módulos conversam
- [[Estrutura de pastas]]: onde fica cada coisa e o mapa da reorganização

## Arquitetura

- [[Fluxo de login]]: o que acontece entre o clique em Play e o jogo aberto
- [[Integração com o Riot Client]]: o painel MINHAS CONTAS dentro da tela de login do Riot
- [[Armazenamento e dados]]: `data.json`, backups, sessões salvas e logs
- [[Segurança e privacidade]]: todas as regras que protegem senhas, tokens e sessões

## Módulos

| Camada | Notas |
|---|---|
| Aplicação | [[main]] · [[preload]] · [[paths]] · [[store]] · [[signInService]] · [[rankApi]] |
| Riot | [[riotClient]] · [[signInFlow]] · [[riotAuthentication]] · [[riotInterface]] · [[riotTransport]] · [[riotProcess]] |
| Windows | [[windowController]] · [[windowGuard.ps1]] · [[login.ps1]] · [[windowsEnvironment]] · [[windowsDpapi]] |
| Integração | [[privateClient]] · [[hostEntry]] · [[privateHost]] · [[privateHostCore]] · [[privateRendererCore]] · [[addons]] · [[bridgeServer]] · [[bootstrapChannel]] · [[backend]] · [[asar]] · [[status]] · [[Scripts de integração]] |
| Interface | [[renderer]] |

## Decisões

- [[ADR-001 Cópia privada da interface do Riot]]
- [[ADR-002 Segredos protegidos pelo DPAPI]]
- [[ADR-003 Sem contornar CAPTCHA ou 2FA]]
- [[ADR-004 Monitor persistente de janelas]]
- [[ADR-005 Código sem comentários e conhecimento no vault]]
- [[ADR-006 Estrutura de pastas por camada]]
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
