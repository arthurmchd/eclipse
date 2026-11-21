---
tipo: decisão
status: substituída
data: 2026-10-27
tags: [adr, arquitetura, janelas, recuperação]
---

# ADR-008 Recuperação visual sem reexibir o Riot

> Substituída em 2026-11-07 pela [[ADR-028 Modo antigo removido]]. O monitor que escondia o Riot saiu do código, e com ele a recuperação, o `handoff` e os snapshots de estilo.

## Contexto

O usuário percebe o Riot reaparecendo rapidamente entre selecionar uma conta e abrir o jogo. Os registros locais mostram `window-style-denied` após o formulário nativo e `window-style-timeout` perto da abertura do jogo. A recuperação do monitor permite concluir o login, mas o encerramento do monitor anterior restaura a aparência das janelas antes de o substituto ficar pronto.

A mudança de estilos também compara todos os bits de `EXSTYLE`, embora o monitor só controle opacidade, ativação, interação e presença na barra de tarefas. O Chromium pode mudar outros bits durante o login. Isso não deve provocar a queda de todo o monitor.

## Decisão

O monitor verifica somente os bits que controla ao esconder uma janela, com tentativas limitadas e tolerância à destruição da janela durante a operação. Uma camada ou opacidade que realmente não pôde ser aplicada continua produzindo falha.

Complemento de 2026-10-28: a tentativa real de recuperar a interface também falhou com `window-style-denied`. A restauração passa a repor somente os bits controlados pelo monitor, preservando mudanças que o próprio cliente fez nos demais bits. A reinicialização de camada altera exclusivamente `WS_EX_LAYERED`. O snapshot continua registrando o estilo original, mas não dá ao monitor propriedade sobre todo o `EXSTYLE`. Metadados de diagnóstico devem excluir títulos, conteúdo, credenciais e tokens.

O protocolo inclui `initialMode` na mensagem inicial, para o substituto aplicar `hide` ou `conceal` antes de confirmar `ready`. Um comando `handoff` encerra o monitor sem restaurar as janelas enquanto seu processo dono vive. Uma falha interna em modo oculto segue a mesma regra; os snapshots ficam nas próprias janelas e são herdados pelo monitor seguinte.

`stop`, fim normal do stdin e fim do processo dono continuam restaurando as janelas. O controlador executa restauração avulsa quando o monitor já morreu ou precisou ser forçado a encerrar. O helper aceita `activate: false` para esse encerramento não trazer o Riot à frente. A recuperação manual mantém a ativação padrão.

Um worker com timeout continua impedindo restauração simultânea dentro do mesmo helper, pois ainda pode estar alterando estilos. A conclusão do login, a verificação do Riot ID e a detecção de janela do jogo não mudam.

## Consequências

- A recuperação não mostra deliberadamente uma janela de login por alguns instantes.
- Snapshots conservam o formato atual e não são sobrescritos durante a troca de monitores.
- A recuperação continua limitada e pode falhar; a interface precisa manter a recuperação manual disponível.
- O encerramento definitivo assume a obrigação de restaurar snapshots deixados por um monitor perdido.
- A mudança reduz uma causa confirmada de reaparecimento. Um evento externo de criação de janela ainda chega após a criação; não se promete invisibilidade absoluta sem validação visual na instalação do usuário.

## Relacionado

- [[windowController]] · [[windowGuard]] · [[signInFlow]]
- [[ADR-004 Monitor persistente de janelas]] · [[Segurança e privacidade]]
