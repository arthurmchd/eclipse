---
tipo: conceito
tags: [visão-geral]
---

# Visão geral

Painel para Windows que entra em várias contas da Riot com um clique: **League of Legends**, **Teamfight Tactics** e **VALORANT**, mostrando o elo de cada conta com os emblemas oficiais de cada jogo.

## Problema que resolve

Quem tem várias contas precisa sair, digitar usuário e senha e esperar o Riot Client a cada troca. O app guarda as contas criptografadas, reaproveita a sessão que o próprio Riot salvou ("Manter conectado") e pede a abertura do jogo pelo serviço local do Riot, com as janelas do cliente escondidas.

## Interface unificada

O aplicativo abre uma cópia privada da interface Riot. **Contas** abre o gerenciamento completo dentro dessa mesma janela: cadastro, edição, filtros, elos, configurações e progresso. O seletor rápido **MINHAS CONTAS** continua disponível no formulário de login. O serviço fica em segundo plano, sem janela independente.

O acesso completo também funciona quando a Riot já está conectada, sem sair da sessão apenas para gerenciar contas. A arquitetura está em [[ADR-007 Interface completa dentro do Riot Client]] e o uso em [[Integração com o Riot Client]].

## Recursos

- Abas LoL / TFT / VALORANT, cada uma com o visual do seu cliente
- Filas: Solo/Duo e Flex (LoL), Ranked e Double Up (TFT), Competitive (VALORANT)
- Distribuição de elos na barra lateral, com filtro por elo
- Busca (Ctrl+F), filtro de região, ordenação por elo, nome, nível, última partida ou win rate, grade ou lista
- Banimento com contagem regressiva, elo da temporada passada, nota livre, fixar no topo
- Copiar usuário e senha; a senha sai da área de transferência depois de 20 s
- Modo streamer: borra os nomes de usuário
- Atalhos: Ctrl+N nova conta, Ctrl+1/2/3 troca de jogo, F5 atualiza elos, duplo clique edita

## Fontes de dados

| Jogo | Fonte | Chave |
|---|---|---|
| LoL e TFT | Riot API oficial | Chave em developer.riotgames.com; a de desenvolvimento expira em 24 h |
| TFT (opcional) | Riot API oficial | A Riot aprova chave pessoal por jogo, então o TFT pode ter a sua |
| VALORANT | HenrikDev (não oficial) | A API oficial de elo do VALORANT só é liberada para apps aprovados |

Ver [[rankApi]].

## O que o app não faz

- Não contorna CAPTCHA nem 2FA ([[ADR-003 Sem contornar CAPTCHA ou 2FA]])
- Não mexe nos processos dos jogos nem no Vanguard
- Não entra em filas nem inicia partidas
- Não altera a instalação do Riot Client ([[ADR-001 Cópia privada da interface do Riot]])

Automatizar o Riot Client é zona cinzenta nos termos da Riot. O risco é do usuário. Ver [[Limitações conhecidas]].

## Stack

Electron 44, Node.js 22+, JavaScript sem etapa de build, interface em HTML/CSS/JS puro com ES modules, auxiliares em PowerShell com C# compilado via `Add-Type`, testes com `node:test`. Sem dependências de runtime além das fontes `@fontsource/*`.
