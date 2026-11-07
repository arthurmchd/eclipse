---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, login, sessão]
---

# ADR-022 Sessões de antes do modo cartões são descartadas

Complementa [[ADR-021 Riot sempre abre desconectada]].

## Contexto

Pedido do usuário em 2026-11-06:

> fui entrar em uma conta diferente pela primeira vez e o riot client reiniciou e apos a reinilizcao ele fez o login, pode arrumar isso?

O `sign-in.log` real mostra o que aconteceu às 15:12 (UTC):

1. **Havia uma sessão antiga.** A conta tinha uma sessão guardada em 2026-11-04, por um fluxo anterior. Esse fluxo ainda saía da conta com `DELETE` na troca de conta e só atualizava a cópia no fim do login.
2. **O Eclipse tentou usá-la.** Pela [[ADR-019 Sessão salva por conta no modo cartões]], ele fechou a Riot e tentou a sessão em segundo plano.
3. **A Riot a recusou em 15 s.** O Eclipse reabriu a Riot e fez o login visível.

Para o usuário, a Riot reiniciou num "primeiro login".

Não há como saber, sem usar, se uma sessão ainda vale. O `refresh_token` da Riot é cifrado (cinco partes, sem validade legível). A recusa só aparece depois de fechar a Riot e subir os serviços com a sessão.

Sessões guardadas antes de 2026-11-06 vêm de fluxos que podiam deixá-las velhas: trocas de conta com `DELETE` e tokens trocados pela Riot depois da captura. Desde a ADR-019, o Eclipse nunca sai da conta e guarda cada versão nova que a Riot grava.

## Decisão

- **Ao iniciar no modo cartões, o [[sessionKeeper]] apaga as sessões antigas.** São as gravadas antes de 2026-11-06 13:00 UTC, conferidas pela data do arquivo `sessions/<id>.bin` (`store.sessionSavedAt`). Antes desse horário, nenhuma sessão foi guardada pelo modo cartões atual: as primeiras são das 13:47.
- **A conta fica como uma conta nova.** O ícone ⚡ some, e o primeiro Jogar faz o login visível direto na Riot aberta, sem fechar e reabrir. A sessão capturada nesse login substitui a antiga.
- **O log registra só quantas foram apagadas.**

## Alternativas consideradas

- **Ignorar as sessões antigas sem apagá-las:** o ⚡ continuaria prometendo uma entrada direta que não acontece.
- **Julgar pela idade dos tokens (`last_token_creation_time`):** a sessão recusada tinha só dois dias. Não se conhece o prazo da Riot, e um limite curto forçaria login visível (com 2FA) em contas válidas.
- **Tentar a sessão sem fechar a Riot:** a Riot só restaura o login lembrado ao iniciar. Não há rota conhecida na API local para isso.

## Consequências

- **As três contas com sessões de outubro** passam a fazer um login visível no próximo Jogar, sem reinício.
- **Uma sessão de depois de 2026-11-06 que morrer ainda causa o reinício uma vez.** Isso acontece, por exemplo, depois de "Sign Out" no LoL ou de sair da conta pela Riot. A sessão recusada é apagada, e o próximo Jogar dessa conta já vai direto para o login visível.
- **A data depende do arquivo.** Copiar a pasta de dados para outro lugar pode mudar a data e salvar uma sessão antiga do descarte. Nesse caso ela é usada uma vez e, se recusada, apagada.

## Relacionado

- [[sessionKeeper]]
- [[store]]
- [[signInFlow]]
