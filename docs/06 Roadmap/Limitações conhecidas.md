---
tipo: roadmap
tags: [limitações]
---

# Limitações conhecidas

## Riot

- **API local não é contrato público.** Os endpoints do Riot Client usados para sessão, autenticação e abertura de produtos podem mudar sem aviso. A [própria Riot](https://developer.riotgames.com/docs/lol#league-client-api) não garante documentação, disponibilidade nem aviso de mudanças.
- **Cópia privada presa a versões.** Só 141.0.0 e 142.0.0. Cada atualização exige [[Atualização do Riot Client]].
- **Preenchimento de compatibilidade depende do layout.** [[login.ps1]] usa posições medidas na v141. Um redesenho pode exigir ajuste. O caminho direto pela API não usa posições.
- **Elo da temporada passada e banimentos são manuais.** A Riot API não informa. No VALORANT, a HenrikDev preenche quando disponível.
- **Termos de uso.** Automatizar o Riot Client é zona cinzenta. O app não mexe nos jogos nem no Vanguard, mas o risco é do usuário.

## Windows

- **Flashes de janela.** Eventos entre processos são assíncronos; o monitor reduz, mas não elimina em todas as combinações de versão, driver e permissão ([[ADR-004 Monitor persistente de janelas]]).
- **DPAPI amarra os dados ao usuário e à máquina** ([[ADR-002 Segredos protegidos pelo DPAPI]]).
- **Só Windows.**

## Validação

- O fluxo foi validado com testes isolados e os auxiliares foram compilados no Windows. **Não houve autenticação com contas reais nem abertura de partida durante a validação.** Falta conferir sessão nova, expirada e 2FA na instalação real.
- Para LoL e TFT, o "jogo aberto" é o lobby do League. O app não entra em filas.
