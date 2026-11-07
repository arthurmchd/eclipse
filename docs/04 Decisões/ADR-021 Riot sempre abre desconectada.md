---
tipo: decisão
status: aceita
data: 2026-11-06
tags: [adr, login, sessão, privacidade]
---

# ADR-021 Riot sempre abre desconectada

Revisa [[ADR-019 Sessão salva por conta no modo cartões]] e [[ADR-020 Riot conectada é encerrada quando fica sem jogo]].

## Contexto

Pedido do usuário em 2026-11-06, depois de testar a ADR-020:

> teste e ainda continua com problema, quero que SEMPRE que eu abrir a riot games eu esteja desconectado de qualquer conta

O `sign-in.log` e o log da própria Riot (v142) mostram o que aconteceu no teste:

1. **Primeiro login visível.** Às 14:14 (UTC), o login foi visível, com 2FA. O LoL abriu e a sessão foi guardada.
2. **A Riot não saiu.** Às 14:15:46 o LoL fechou. A Riot registrou "Running in background is enabled, so not quitting" e passou para o **modo segundo plano**. Nesse modo ela descarta a conta da memória, mas `RiotClientServices` continua rodando. O login lembrado ficou no arquivo.
3. **O guardião não limpou o arquivo.** Pela regra da ADR-019, ele só limpava com a Riot parada, e ela nunca parou.
4. **A Riot abriu conectada.** Às 14:16:00 a Riot foi aberta ("We are now in AppFull") e restaurou a sessão a partir do arquivo ("PSL state changed to RestoreAuthorization"). Ela mostrou a conta conectada.
5. **A sessão morreu.** Às 14:16:17 a conta foi desconectada pela Riot ("RSO_AUTH_DELETE"), o que encerra a sessão no servidor. O Jogar das 14:16:22 foi recusado e caiu no login visível.

A ADR-020 tentava encerrar a Riot conectada depois do jogo. No modo segundo plano, porém, a Riot já não está conectada na memória: o perigo está só no arquivo.

## Decisão

- **O arquivo da Riot não guarda login quando a Riot não está usando a conta.**
  - O [[sessionKeeper]] guarda o login na conta dona e o tira do `RiotGamesPrivateSettings.yaml` sempre que a Riot não segura essa conta conectada na memória. Isso inclui:
    - a Riot fechada;
    - a Riot no modo segundo plano;
    - a Riot na tela de login.
  - A conferência é `clientRunning()` e depois `isAuthorized()`.
  - Não espera mais a Riot sair.
- **Com a Riot conectada, o arquivo fica como está.** A conta está na memória dela, e o arquivo não muda o que aparece na tela. Assim que a Riot solta a conta (sai, passa para o segundo plano ou desconecta), o login é guardado e limpo.
- **Vale para qualquer conta.** Um login lembrado de conta que não está no Eclipse também é tirado do arquivo, sem ser guardado, porque o Eclipse não tem onde guardá-lo. O log registra "cleared a remembered Riot login that is not from an account in Eclipse". Isso revisa a regra da ADR-019 de deixar intacto o login sem dona comprovada.
- **Nada sobrescreve uma gravação mais nova.** Antes de limpar, o arquivo é lido de novo. Se a Riot o regravou durante a conferência, nada é escrito, e a mudança agenda outra conferência.
- **Mais rápido e com rede de segurança.**
  - A conferência roda 1 s depois da última mudança no arquivo (antes, 2 s).
  - A olhada de 4 s nos processos também confere o arquivo quando a Riot está fechada ou sem conta conectada. Assim o login é limpo mesmo que o aviso do Windows falhe ou a Riot passe ao segundo plano sem regravar o arquivo.
  - As repetições enquanto a Riot roda deixam de existir.
- **O resto da ADR-020 continua.**
  - A Riot conectada sem jogo, depois de um jogo ou sem janela, é encerrada com a saída normal.
  - Trocar de conta nunca usa `DELETE`.
  - O primeiro login de cada conta é visível.

## Alternativas consideradas

- **Limpar sempre, mesmo com a Riot conectada:** não muda o que aparece na tela, porque a conta está na memória da Riot. Além disso, não se sabe se a Riot volta a gravar o login lembrado depois que ele some do arquivo. A troca do `refresh_token` poderia deixar a cópia do Eclipse velha.
- **Desconectar a Riot quando o jogo fecha (`DELETE`):** encerra a sessão no servidor. É exatamente o que destruiu a sessão no teste.
- **Encerrar o processo de segundo plano da Riot:** não adianta sozinho. Quem restaura a conta é o arquivo, na próxima abertura.

## Consequências

- **Abrir a Riot sem jogo aberto mostra sempre a tela de login com os cartões**, desde que o Eclipse esteja aberto.
- **Durante um jogo, abrir a Riot mostra a conta conectada.** O jogo depende dessa sessão, e o Eclipse não desconecta (isso derrubaria o jogo e a sessão). Quando o jogo fecha, a Riot solta a conta e o arquivo é limpo em poucos segundos.
- **Abrir a Riot no mesmo segundo em que o jogo fecha** ainda pode restaurar a conta, antes da conferência (até uns 5 s). Se acontecer, feche a Riot pelo X em vez de sair da conta.
- **Com o Eclipse fechado, nada limpa o arquivo.** Ao abrir, o Eclipse limpa o que ficou.
- **Logins de contas fora do Eclipse com "Manter conectado" deixam de ser lembrados pela Riot** enquanto o Eclipse estiver aberto.
- **Não mexe na instalação da Riot.** Escreve só o `RiotGamesPrivateSettings.yaml`, como antes.

## Relacionado

- [[sessionKeeper]]
- [[riotClient]]
- [[Fluxo de login]]
- [[Segurança e privacidade]]
