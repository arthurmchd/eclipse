---
tipo: conceito
tags: [visão-geral]
---

# Visão geral

Painel para Windows que entra em várias contas da Riot com um clique: **League of Legends** (e o TFT, que roda no mesmo cliente) e **VALORANT**, mostrando o elo de cada conta com os emblemas oficiais de cada jogo.

## Problema que resolve

Quem tem várias contas precisa sair, digitar usuário e senha e esperar o Riot Client a cada troca. O app guarda as contas criptografadas, preenche o formulário da Riot na primeira entrada de cada conta, guarda a sessão de cada uma ("Manter login") e, das próximas vezes, entra em segundo plano e pede a abertura do jogo pelo serviço local do Riot.

## Cartões sobre a Riot

O Eclipse roda na bandeja e desenha os cartões de contas sobre a arte à direita da janela oficial da Riot, presos a ela ([[ADR-009 Sobreposição no cliente oficial]]). A coluna de login da Riot continua dela; a caixa "Ocultar contas" mostra a arte de volta. Não há janela própria do gerenciador nem cópia da interface da Riot: o modo antigo, com a cópia privada, saiu em 2026-11-07 ([[ADR-028 Modo antigo removido]]). O uso está em [[Como usar]] e a arquitetura em [[Integração com o Riot Client]].

## Recursos

- Ícones de jogo no rodapé: Riot (só entrar), League e VALORANT, cada um com as cores e o botão Jogar do seu cliente
- Dois visuais, trocados por ícones no rodapé: placas verticais (padrão) e lista compacta ([[cards]]). No League, Solo/Duo e Flex com os emblemas de elo que vêm com o app; em Mestre ou acima, quanto falta para o corte de Grão-Mestre ou Desafiante. No VALORANT, a arte do cartão de jogador, o Competitivo e a barra de RR
- Adicionar conta pelo **+** do rodapé; editar e remover pelo menu ⋯ do cartão
- ⚙ Configurações: idioma (português ou inglês), **Manter login**, chaves de API e intervalo de atualização dos elos
- ↻ atualiza os elos; o rodapé mostra quantas contas existem e quando foram atualizadas
- Jogar vira Cancelar durante o login
- Cópias dos botões de minimizar e fechar da Riot, desenhadas sobre os originais

O elo do TFT ainda é consultado ([[rankApi]]), mas não aparece nos cartões.

## Fontes de dados

| Jogo | Fonte | Chave |
|---|---|---|
| LoL | OP.GG, endpoint público (não oficial) | Nenhuma. Desde 2026-11-15, a fonte principal sem chave ([[ADR-037 Elo do League pelo OP.GG]]). Recebe o Riot ID e o servidor de cada conta; o dado chega com o atraso de um ciclo de atualização |
| LoL e TFT | Riot API oficial | Chave em developer.riotgames.com; a de desenvolvimento expira em 24 h. Com ela, o LoL vem daqui primeiro |
| TFT (opcional) | Riot API oficial | A Riot aprova chave pessoal por jogo, então o TFT pode ter a sua |
| VALORANT | HenrikDev (não oficial) | A API oficial de elo do VALORANT só é liberada para apps aprovados |
| LoL, TFT e VALORANT, sem chave | O jogo aberto no PC ([[gameRanks]]) | Nenhuma. Desde 2026-11-08 ([[ADR-031 Elo lido do próprio jogo, sem chave]]): a conta ganha elo quando joga. Sem RR no VALORANT nem cortes de Mestre+ |

Ver [[rankApi]].

## O que o app não faz

- Não contorna CAPTCHA nem 2FA ([[ADR-003 Sem contornar CAPTCHA ou 2FA]])
- Não mexe nos processos dos jogos nem no Vanguard
- Não entra em filas nem inicia partidas
- Não altera a instalação do Riot Client: só lê o lockfile e o certificado dela ([[ADR-028 Modo antigo removido]])

Automatizar o Riot Client é zona cinzenta nos termos da Riot. O risco é do usuário. Ver [[Limitações conhecidas]].

## Stack

Electron 44, Node.js 22+, JavaScript sem etapa de build, interface em HTML/CSS/JS puro com ES modules, auxiliares em PowerShell com C# compilado via `Add-Type`, testes com `node:test`. Sem dependências de runtime além das fontes `@fontsource/*`.
