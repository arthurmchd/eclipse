---
tipo: roadmap
tags: [limitações]
---

# Limitações conhecidas

## Riot

- **API local não é contrato público.** Os endpoints do Riot Client usados para sessão, autenticação e abertura de produtos podem mudar sem aviso. A [própria Riot](https://developer.riotgames.com/docs/lol#league-client-api) não garante documentação, disponibilidade nem aviso de mudanças.
- **Cartões dependem do desenho da tela de login.** A largura da coluna de login, a caixa "Ocultar contas" e os pontos que o [[riotWindowObserver]] lê são frações da janela da Riot. Um redesenho pode exigir ajuste ([[Atualização do Riot Client]]). A cópia privada presa a versões saiu em 2026-11-07 ([[ADR-028 Modo antigo removido]]).
- **Preenchimento de compatibilidade depende do layout.** [[login.ps1]] usa posições medidas na v141 e as cores da caixa "Stay signed in" da v142. Um redesenho pode exigir ajuste. O caminho direto pela API não usa posições.
- **Elo da temporada passada e banimentos são manuais.** A Riot API não informa. No VALORANT, a HenrikDev preenche quando disponível.
- **Termos de uso.** Automatizar o Riot Client é zona cinzenta. O app não mexe nos jogos nem no Vanguard, mas o risco é do usuário.

## Windows

- **Cartões um instante atrás da Riot.** Os movimentos da janela da Riot chegam por evento entre processos; os cartões podem seguir com um pequeno atraso ([[ADR-012 Sobreposição presa à janela do Riot]]). Os flashes do login escondido saíram com ele em 2026-11-07.
- **DPAPI amarra os dados ao usuário e à máquina** ([[ADR-002 Segredos protegidos pelo DPAPI]]).
- **Só Windows.**

## Validação

- O fluxo foi validado com testes isolados e os auxiliares foram compilados no Windows. **Não houve autenticação com contas reais nem abertura de partida durante a validação.** Falta conferir sessão nova, expirada e 2FA na instalação real.
- Para LoL e TFT, o "jogo aberto" é o lobby do League. O app não entra em filas.
