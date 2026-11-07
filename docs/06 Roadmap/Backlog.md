---
tipo: roadmap
atualizado: 2026-11-07
tags: [backlog]
---

# Backlog

Ordenado por prioridade. Use o template [[Tarefa]] para detalhar um item antes de começar. Todos os itens abaixo foram conferidos no código em 2026-10-26, durante a documentação dos módulos. Eles já existiam antes da reorganização.

## Validar no Riot real

- **Recuperação do monitor de janelas.** Fora de uso desde 2026-11-07: só o login escondido do modo antigo armava o monitor que esconde a Riot, e o login visível não o arma ([[ADR-028 Modo antigo removido]]). A recuperação continua no [[windowController]].

- **Caixa "Stay signed in" na v142.** Até 2026-11-06 o [[login.ps1]] usava as cores da v141 e lia a grade fora da área cliente, 7 px à esquerda do centro da caixa: a caixa marcada nunca era reconhecida e os logins visíveis registravam `remember:unknown`. Corrigido em 2026-11-06 e conferido numa réplica do formulário. Falta, num login visível real: (1) ver `remember:on` ou `remember:off` no `sign-in.log`; (2) com "Manter login" desligado, ver a caixa da Riot desmarcada antes de entrar, já que o clique para desmarcar nunca foi exercitado.
- **Jogo desatualizado: confirmar no Riot real.** O 424 `launch_failed_product_not_up_to_date` visto em 2026-11-04 12:36 agora faz o [[signInFlow]] esperar a atualização e repetir o pedido a cada 15 s (até 20 min). Coberto por testes; falta ver no `sign-in.log` um login real em que o jogo estava desatualizado e abriu depois da atualização.
- **Sobreposição presa à Riot.** Desde 2026-11-04 a janela da Riot é dona dos cartões, e os movimentos chegam por evento ([[ADR-012 Sobreposição presa à janela do Riot]]). No Riot real, o usuário confirmou em 2026-11-04 que os cartões somem e voltam com a Riot ao minimizar, mas voltavam com atraso; corrigido no mesmo dia mantendo a sessão com a Riot minimizada. A primeira correção deixava o Windows trazer os cartões de volta e fez a Riot voltar vazia logo depois de minimizar (cartões sozinhos na tela); trocada por `hide` explícito com a sessão mantida. Com a versão corrigida, o registro de janelas de 2026-11-04 mostrou o gerenciador aberto com a Riot minimizada ficando escondido e os cartões voltando menos de 0,1 s depois de restaurar; o usuário considerou o comportamento aceitável. Minimizar com a versão nova aberta não ficou registrado; se a Riot voltar vazia logo após minimizar, revisar [[riotOverlay]]. Cartões invisíveis ao restaurar a Riot depois de abrir o gerenciador: corrigido em 2026-11-04 desligando a detecção de oclusão do Chromium ([[main]]); o usuário confirmou no Riot real no mesmo dia. Falta confirmar: a volta sem atraso, cartões visíveis com outro programa em foco e cobertos por ele, arraste sem atraso visível, e o Riot respondendo normalmente com os cartões presos.
- **Cópias dos controles do Riot.** Desde 2026-11-04 os cartões cobrem a arte inteira e desenham minimizar e fechar por cima dos nativos (o perfil real, desde 2026-11-06, só com as contas ocultas) ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]). Falta conferir na Riot real:
  - as cópias alinhadas com os nativos;
  - minimizar e restaurar com os cartões voltando;
  - o X indo para o segundo plano com a opção da Riot ligada e saindo com ela desligada;
  - com as contas ocultas pela caixa, o perfil real da Riot à mostra e abrindo o menu.

  Se a faixa de arrastar coberta no topo da arte fizer falta, avaliar arrastar a Riot pela área dos cartões.
- **Minimizar sem arte e pontas arredondadas.** Desde 2026-11-04 ([[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]) falta conferir na Riot real:
  - minimizar sem a arte aparecer;
  - a arte sem aparecer ao restaurar (Chromium sem animação de janela desde a revisão do mesmo dia);
  - a coluna de login da Riot visível, com só a caixa "Ocultar contas" por cima;
  - as pontas direitas sem fundo branco para fora;
  - a animação da Riot de volta depois de fechar o Eclipse.
- **Aviso de inatividade por cima dos cartões.** Desde 2026-11-05 ([[ADR-017 Cartões cedem a vez aos avisos da Riot]]). Falta deixar a Riot parada no login até o aviso "Você ainda está aí?" aparecer e conferir:
  - os cartões e a caixa somem e o aviso fica todo clicável;
  - depois de Sim, os cartões voltam;
  - nada some sem aviso na tela de login normal, inclusive com o mouse ou um texto selecionado perto do canto esquerdo da coluna de login.
- **Riot ID renomeado e cortes de Mestre+.** Desde 2026-11-05 ([[rankApi]], [[cards]]). Falta:
  - ver uma conta renomeada no site da Riot mudar de nome no Eclipse na atualização seguinte;
  - comparar os cortes com um site de ranking, numa região com conta em Mestre+;
  - conferir se as listas de Mestre não deixam a atualização lenta demais.
- **Cartões no visual do jogo.** Desde 2026-11-05 ([[cards]]). Falta:
  - ver no app, com as contas do usuário, os ícones, os banners por elo e os cartões do VALORANT reais;
  - ler o banner escolhido no cliente e preencher `stats.lol.banner` no [[rankApi]]. Provável fonte: `lol-challenges` `player-data`, `preferences.bannerAccent`, que deve ser o `id` do `regalia.json` (1 padrão, 2 ranqueado, 3+ temáticos). Confirmar o formato com a chave do usuário antes;
  - opcional: título do jogador no VALORANT (a HenrikDev v2 devolve o UUID; o texto vem de valorant-api `playertitles`).
- **Gerenciador some ao entrar na conta.** Login real em 2026-11-04 12:29 entrou e abriu o jogo com o código novo; falta o usuário confirmar que os cartões sumiram logo após "Signed in", antes do jogo abrir.

- **Saída pela Riot apaga a sessão.** Desde 2026-11-07 ([[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]). Falta conferir na Riot real:
  - sair da conta pela Riot e ver "forgot the saved session of an account signed out in Riot" no `sign-in.log`, com o ⚡ do cartão sumindo;
  - o "Sign Out" do League fazendo o mesmo;
  - o Jogar seguinte dessa conta indo direto ao login visível, sem reiniciar a Riot;
  - um jogo fechado normalmente sem apagar a sessão.

## Segurança do login

Itens 1 e 2 (segundo envio de senha e `loginState` desconhecido liberando o jogo) foram resolvidos em 2026-10-26. Ver [[Changelog]] e [[riotAuthentication]].

## Correções

3. **Tratado na migração da interface:** o [[main]] agora trata a rejeição da atualização agendada e reagenda em `finally`, inclusive após falhas. Ver [[Changelog]].
4. **Chave ilegível derruba todo refresh.** `getKeys()` em [[store]] não protege o `decrypt`, ao contrário de `publicSettings`. Enquanto a tela mostra a chave como ilegível, todo refresh falha.
5. **Timeout nas consultas de elo.** `getJson` em [[rankApi]] usa `fetch` sem prazo numa fila compartilhada; uma conexão presa trava todas as atualizações e o `refreshing` do main. Um `retry-after` em formato de data vira `NaN` e a nova tentativa sai sem espera.
6. **Tratado na migração da interface:** o [[main]] só publica `account-updated` quando a atualização devolve uma conta. Conta removida durante o refresh não gera evento nulo.
7. **`refreshAll(ids)` ignora `ids` se já houver refresh.** Conta recém-salva só ganha elo no ciclo seguinte ([[main]]).
8. **`onClosed` sem proteção.** Em [[signInService]], `onClosed` é repassado direto, sem o `notify` que protege os outros callbacks. Uma exceção em `saveLeavingSession` aborta o login com o Riot já fechado.
9. **Resolvido em 2026-11-07:** a preferência `closeRiotClient` saiu, e o login visível sempre fecha a janela da Riot depois que o jogo abre. A opção `closeClient` do [[signInFlow]] só vale no ramo escondido, que o app não usa ([[ADR-028 Modo antigo removido]]).
10. **Corpo de resposta no log.** `requestLaunch` em [[riotClient]] grava até 300 caracteres das respostas de abertura do jogo no `sign-in.log`. Risco baixo, mas contraria "só valores fixos no log" ([[Segurança e privacidade]]).
11. **Saiu com a janela antiga em 2026-11-07.** Era sobre rejeições sem aviso na janela antiga ([[renderer]]); os [[cards]] não têm essas ações de menu.
12. **Saiu com o modo antigo em 2026-11-07.** O [[hostEntry]] foi removido.
13. **Tratado na migração da interface:** [[managerService]] centraliza métodos, quantidade de argumentos, formatos de conta, tipos de configurações e campos de patch; [[managerHost]] valida o remetente IPC isolado.

## Investigar

- **Serviço único de estado da Riot.** Item 4 da análise de remendos de 2026-11-06: o [[sessionKeeper]], o [[riotWakeup]] e o login têm cada um a sua regra para saber se a Riot está fechada, em segundo plano, na tela de login, conectada ou em jogo. Antes de juntar, conferir na Riot real, só lendo e com autorização, se a API local tem canal de eventos (`/help`). A [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]] não precisou dele.
- **Validar o reinício com interface do [[riotInterface]].** O caminho `show` foi validado em 2026-10-26; o reinício (reserva) ainda não rodou numa instalação real.

## Estrutura

14. **Reavaliar depois da migração:** o [[main]] deixou de criar a janela e os handlers da interface; a validação de contas foi extraída para [[managerService]] e a UI para [[managerHost]]/[[manager-preload]]. O harness de inicialização foi atualizado. Separar a bandeja ou o agendamento só se a complexidade voltar a justificar.
15. **Saiu com a janela antiga em 2026-11-07.** O `src/renderer/app.js` foi removido.
16. **Lint e formatação.** ESLint (flat config) e Prettier como `devDependencies`, com `npm run lint` e uma regra que barre comentários novos.
17. **Limpar código morto.** O que era do modo antigo saiu em 2026-11-07 ([[ADR-028 Modo antigo removido]]). Os ramos do login escondido saíram do [[signInFlow]] no mesmo dia. Resta: o monitor de ocultação no [[windowController]] e no [[windowGuard.ps1]] (`hide`, `conceal`, `park`, `assertHealthy`, `drainIncidents`), sem chamador; o `visible: false` do [[riotInterface]], que ninguém passa; o ramo `error:focus` em [[riotClient]]; `dryRun` só usado em testes; `signIn` do [[signInService]], sem chamador no app; mensagens em inglês que citam "Show Riot Client".
18. **Feito em 2026-11-07.** O experimento legado, a cópia privada e a janela antiga saíram ([[ADR-028 Modo antigo removido]]). O código está na tag `modo-antigo-final`.
19. **Resolvido.** `scripts/dev/mock-api.js` define `onSignInOperation`; desde 2026-11-07 ele só tem o que os cartões usam.

## Produto

20. **Instalador e atualização.** Instalador assinado, versionamento do formato de `data.json` e atualização controlada. Os auxiliares PowerShell precisam ficar fora do `app.asar` (já suportado por `unpackedPath` em [[paths]]).
21. **Validar o fluxo dos cartões com contas reais**: sessão nova, sessão expirada e 2FA ([[Integração com o Riot Client]]).

## Ferramentas de desenvolvimento

22. **Servidor de prévia só local.** `scripts/dev/preview-server.js` escuta em todas as interfaces e `decodeURIComponent` pode lançar com URL inválida. Limitar a `127.0.0.1` e tratar o erro.

Mais riscos de menor impacto estão em "Pontos de atenção" de cada nota de módulo.

## Feito

Ver [[Changelog]].
