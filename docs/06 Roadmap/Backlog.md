---
tipo: roadmap
atualizado: 2026-11-04
tags: [backlog]
---

# Backlog

Ordenado por prioridade. Use o template [[Tarefa]] para detalhar um item antes de começar. Todos os itens abaixo foram conferidos no código em 2026-10-26, durante a documentação dos módulos. Eles já existiam antes da reorganização.

## Validar no Riot real

- **Recuperação do monitor de janelas.** O login abortava quando o monitor caía logo depois do preenchimento nativo (três falhas reais em 2026-10-26). O [[windowController]] agora reergue o monitor e grava o motivo no `sign-in.log`. Falta: (1) confirmar que o jogo abre numa tentativa real; (2) ler o código registrado ("window guard restarted after …"). Se for sempre o mesmo (por exemplo `window-style-timeout`), tratar a causa no [[windowGuard.ps1]] em vez de depender da recuperação.

- **Caixa "Stay signed in" nem sempre reconhecida.** Com "Manter login" desmarcado, três logins reais em 2026-11-04 (12:31, 12:36, 12:38) leram `remember:off`, que já era o estado pedido; o clique para desmarcar ainda não foi exercitado. Com a opção ligada, vários logins anteriores registraram `remember:unknown`: o [[login.ps1]] não reconhece a caixa na janela visível do Riot 142 e, por segurança, não clica. Com "Manter login" ligado isso não atrapalha, porque a Riot já vinha guardando a sessão. Com "Manter login" desligado, a caixa não seria desmarcada no formulário nativo, que é o caminho usado no modo sobreposto. Falta: conferir a posição e as cores da caixa em `$REMEMBER` com uma captura da janela real.
- **Jogo desatualizado: confirmar no Riot real.** O 424 `launch_failed_product_not_up_to_date` visto em 2026-11-04 12:36 agora faz o [[signInFlow]] esperar a atualização e repetir o pedido a cada 15 s (até 20 min). Coberto por testes; falta ver no `sign-in.log` um login real em que o jogo estava desatualizado e abriu depois da atualização.
- **Sobreposição presa à Riot.** Desde 2026-11-04 a janela da Riot é dona dos cartões, e os movimentos chegam por evento ([[ADR-012 Sobreposição presa à janela do Riot]]). No Riot real, o usuário confirmou em 2026-11-04 que os cartões somem e voltam com a Riot ao minimizar, mas voltavam com atraso; corrigido no mesmo dia mantendo a sessão com a Riot minimizada. A primeira correção deixava o Windows trazer os cartões de volta e fez a Riot voltar vazia logo depois de minimizar (cartões sozinhos na tela); trocada por `hide` explícito com a sessão mantida. Com a versão corrigida, o registro de janelas de 2026-11-04 mostrou o gerenciador aberto com a Riot minimizada ficando escondido e os cartões voltando menos de 0,1 s depois de restaurar; o usuário considerou o comportamento aceitável. Minimizar com a versão nova aberta não ficou registrado; se a Riot voltar vazia logo após minimizar, revisar [[riotOverlay]]. Cartões invisíveis ao restaurar a Riot depois de abrir o gerenciador: corrigido em 2026-11-04 desligando a detecção de oclusão do Chromium ([[main]]); o usuário confirmou no Riot real no mesmo dia. Falta confirmar: a volta sem atraso, cartões visíveis com outro programa em foco e cobertos por ele, arraste sem atraso visível, e o Riot respondendo normalmente com os cartões presos.
- **Cópias dos controles do Riot.** Desde 2026-11-04 os cartões cobrem a arte inteira e desenham minimizar, fechar e perfil por cima dos nativos ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]). Falta conferir na Riot real:
  - as cópias alinhadas com os nativos;
  - minimizar e restaurar com os cartões voltando;
  - o X indo para o segundo plano com a opção da Riot ligada e saindo com ela desligada;
  - o perfil ocultando as contas e o botão real abrindo o menu no segundo clique.

  Se a faixa de arrastar coberta no topo da arte fizer falta, avaliar arrastar a Riot pela área dos cartões.
- **Minimizar sem arte e pontas arredondadas.** Desde 2026-11-04 ([[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]) falta conferir na Riot real:
  - minimizar sem a arte aparecer;
  - a arte sem aparecer ao restaurar (Chromium sem animação de janela desde a revisão do mesmo dia);
  - a coluna de login da Riot visível, com só a caixa "Ocultar contas" por cima;
  - as pontas direitas sem fundo branco para fora;
  - a animação da Riot de volta depois de fechar o Eclipse.
- **Gerenciador some ao entrar na conta.** Login real em 2026-11-04 12:29 entrou e abriu o jogo com o código novo; falta o usuário confirmar que os cartões sumiram logo após "Signed in", antes do jogo abrir.

## Segurança do login

Itens 1 e 2 (segundo envio de senha e `loginState` desconhecido liberando o jogo) foram resolvidos em 2026-10-26. Ver [[Changelog]] e [[riotAuthentication]].

## Correções

3. **Tratado na migração da interface:** o [[main]] agora trata a rejeição da atualização agendada e reagenda em `finally`, inclusive após falhas. Ver [[Changelog]].
4. **Chave ilegível derruba todo refresh.** `getKeys()` em [[store]] não protege o `decrypt`, ao contrário de `publicSettings`. Enquanto a tela mostra a chave como ilegível, todo refresh falha.
5. **Timeout nas consultas de elo.** `getJson` em [[rankApi]] usa `fetch` sem prazo numa fila compartilhada; uma conexão presa trava todas as atualizações e o `refreshing` do main. Um `retry-after` em formato de data vira `NaN` e a nova tentativa sai sem espera.
6. **Tratado na migração da interface:** o [[main]] só publica `account-updated` quando a atualização devolve uma conta. Conta removida durante o refresh não gera evento nulo.
7. **`refreshAll(ids)` ignora `ids` se já houver refresh.** Conta recém-salva só ganha elo no ciclo seguinte ([[main]]).
8. **`onClosed` sem proteção.** Em [[signInService]], `onClosed` é repassado direto, sem o `notify` que protege os outros callbacks. Uma exceção em `saveLeavingSession` aborta o login com o Riot já fechado.
9. **`closeClient` não fecha o cliente.** Em [[signInFlow]], a opção só chama `conceal()`. Decidir: renomear a preferência ou implementar o fechamento.
10. **Corpo de resposta no log.** `requestLaunch` em [[riotClient]] grava até 300 caracteres das respostas de abertura do jogo no `sign-in.log`. Risco baixo, mas contraria "só valores fixos no log" ([[Segurança e privacidade]]).
11. **Erros sem toast na interface.** `submitSettings`, `deleteAccount` e as ações do menu (`pin`, `unban`, `forget`, `delete`) em [[renderer]] não tratam rejeição; recusas como "Wait for sign-in to finish…" somem.
12. **`hostEntry` sem `return` após `app.exit(1)`.** Sem o argumento do pipe, a linha seguinte ainda roda com `flag` indefinido ([[hostEntry]]).
13. **Tratado na migração da interface:** [[managerService]] centraliza métodos, quantidade de argumentos, formatos de conta, tipos de configurações e campos de patch; [[managerHost]] valida o remetente IPC isolado.

## Investigar

- **Validar o reinício com interface do [[riotInterface]].** O caminho `show` foi validado em 2026-10-26; o reinício (reserva) ainda não rodou numa instalação real.

## Estrutura

14. **Reavaliar depois da migração:** o [[main]] deixou de criar a janela e os handlers da interface; a validação de contas foi extraída para [[managerService]] e a UI para [[managerHost]]/[[manager-preload]]. O harness de inicialização foi atualizado. Separar a bandeja ou o agendamento só se a complexidade voltar a justificar.
15. **Dividir `src/renderer/app.js`** (≈840 linhas) em ES modules: `state`, `format`, `render/cards`, `render/sidebar`, `modals`, `actions`, `shortcuts`. Sem testes hoje; verificar pela prévia no navegador.
16. **Lint e formatação.** ESLint (flat config) e Prettier como `devDependencies`, com `npm run lint` e uma regra que barre comentários novos.
17. **Limpar código morto.** `SUPPORTED_VERSION` e `UNSAFE_STARTUP_LOG` não usados em [[privateHostCore]]; ramo `error:focus` em [[riotClient]]; ramo "The game did not start" em [[renderer]]; `dryRun` só usado em testes ([[signInFlow]]).
18. **Remover o experimento legado** (`scripts/legacy/`, [[status]] e os testes associados) se ele não for mais retomado.
19. **Mock da prévia fora de sincronia.** `scripts/dev/mock-api.js` não define `onSignInOperation`.

## Produto

20. **Instalador e atualização.** Instalador assinado, versionamento do formato de `data.json` e atualização controlada. Os auxiliares PowerShell precisam ficar fora do `app.asar` (já suportado por `unpackedPath` em [[paths]]); `.client-integration/` também precisaria sair de dentro do pacote.
21. **Validar o fluxo integrado com contas reais**: sessão nova, sessão expirada e 2FA ([[Integração com o Riot Client]]).

## Ferramentas de desenvolvimento

22. **Servidor de prévia só local.** `scripts/dev/preview-server.js` escuta em todas as interfaces e `decodeURIComponent` pode lançar com URL inválida. Limitar a `127.0.0.1` e tratar o erro.

Mais riscos de menor impacto estão em "Pontos de atenção" de cada nota de módulo.

## Feito

Ver [[Changelog]].
