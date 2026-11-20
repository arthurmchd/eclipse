---
tipo: roadmap
atualizado: 2026-11-15
tags: [backlog]
---

# Backlog

Ordenado por prioridade. Use o template [[Tarefa]] para detalhar um item antes de começar. Todos os itens abaixo foram conferidos no código em 2026-10-26, durante a documentação dos módulos. Eles já existiam antes da reorganização.

## Lista de recursos de 2026-11-15, bloco por bloco

Pedido do usuário depois de comparar o Eclipse com outros gerenciadores. Cada bloco sai numa versão instalada, para ele testar antes do próximo.

1. **Organizar muitas contas.** Feito na 2.5.0 ([[Changelog]], [[cards]]). Copiar usuário ou senha saiu da lista por decisão do usuário. Falta conferir na Riot real: o arraste dentro da sobreposição e a sugestão da conta aberta.
2. **Informações da conta.** Aviso de banimento, suspensão, decaimento e restrição de ranqueada; histórico do elo com gráfico, PdL e partidas de hoje, elo-alvo e pico da temporada; elo do TFT nos cartões; Essência Azul e RP no LoL, VP, Radianite e loja diária no VALORANT; campeões e skins com busca; "quem pode fazer duo com meu amigo"; abrir no OP.GG ou tracker.gg. O usuário aceitou em 2026-11-15 que os dados que exigem a conta logada apareçam como "visto em <data>", lidos quando a conta entra.
3. **Uso no dia a dia.** Atualização automática (exige assinar as atualizações, item 20), atalhos e paleta Ctrl+K, entrar pela bandeja ou pela barra de tarefas, atalho por conta e link `eclipse://`, modo streamer com o OBS aberto, temas e tamanho da interface.
4. **Otimizações.** Atualizar só o que mudou no cartão, limitar consultas de elo simultâneas e reaproveitar conexões, logs com códigos fixos, copiar as configurações do jogo da main para as alts. No League isso escreve em `C:\Riot Games\League of Legends\Config`: o usuário autorizou a exceção em 2026-11-15, mas ela exige um ADR antes do código, com backup antes de cada cópia.

## Conferir o Eclipse 2.0.0 (Tauri) no Riot real

Desde 2026-11-15 o Eclipse é só Tauri ([[ADR-034 Troca do Electron pelo Tauri]]). O comportamento é o mesmo do Electron, mas foi reescrito em Rust e conferido só com uma Riot falsa nos testes. O que foi visto na Riot real até agora:

- **Feito em 2026-11-14**, com o app de desenvolvimento e uma pasta de dados de teste: um login de LoL e o jogo aberto ([[signInFlow]]), os cartões sobre a Riot ([[riotOverlay]]) e o certificado da API local ([[riotTransport]]).
- **Feito em 2026-11-15**, com o app instalado: as contas reais abriram normalmente, segundo o usuário. Foi a primeira leitura, pelo Rust, do `data.json`, das senhas e das sessões gravadas pelo Electron ([[store]], [[safeStorage]]).
- **Feito em 2026-11-15**, com a 2.0.1 instalada, segundo o usuário: o arraste rápido da Riot com os cartões colados e a caixa "Ocultar contas" à vista durante o arraste ([[ADR-036 Arraste da Riot assumido pelo Eclipse]]), e os cartões indo para trás junto com a Riot no Alt+Tab e no clique em outro programa ([[riotWindowObserver]]).

Falta:

- caixa "Ocultar contas", cobertura da coluna durante o login e cópias de minimizar e fechar ([[overlayToggle]], [[overlayCover]]);
- elo do League vindo do OP.GG para as contas reais, sem chave: todas as contas ganhando elo, o servidor certo e a leitura do jogo mantida quando é mais nova ([[opgg]]);
- placas verticais e lista compacta sobre a Riot real, com a troca pelos ícones e a escolha mantida ao reabrir ([[cards]]);
- login com e sem "Manter login" e troca entre contas com sessão guardada ([[signInService]], [[sessionKeeper]]);
- elos atualizando, pela API e pelo jogo aberto ([[rankWatcher]], [[gameRanks]]);
- bandeja, notificações do Windows e "Iniciar com o Windows" ([[main]], [[toasts]], [[startWithWindows]]).

Os itens da seção seguinte foram conferidos, quando foram, no Electron; ao conferir no Tauri, vale olhar os mesmos pontos.

## Validar no Riot real

- **Elo pelo VALORANT aberto.** Desde 2026-11-08 ([[gameRanks]], [[rankWatcher]], [[ADR-031 Elo lido do próprio jogo, sem chave]]). O LoL foi conferido no mesmo dia; o VALORANT não, porque estava fechado. Com o VALORANT aberto numa conta salva, ver em até 1 min o cartão com o elo e no `data.log` "updated a saved account from the Riot Client". Se aparecer "could not read the ranks from the Riot Client", conferir, só lendo, a presença da própria conta em `/chat/v4/presences`: se o elo vem em `private` (base64 com `competitiveTier`) ou em `privateJwt` ou `packedData`.
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
4. **Resolvido em 2026-11-07:** chave ilegível derrubava todo refresh. O `getKeys()` do [[store]] agora devolve vazia a chave que não abre e registra só o nome do campo; o refresh segue com as outras.
5. **Resolvido em 2026-11-07:** timeout nas consultas de elo. Cada consulta do [[rankApi]] tem prazo de 15 s, do pedido ao corpo, e é abortada ao estourar. O `retry-after` vale em segundos ou como data HTTP, e um pedido de espera acima de 60 s vira erro em vez de travar a fila.
6. **Tratado na migração da interface:** o [[main]] só publica `account-updated` quando a atualização devolve uma conta. Conta removida durante o refresh não gera evento nulo.
7. **Resolvido em 2026-11-07:** `refreshAll(ids)` ignorava `ids` se já houvesse refresh. O [[main]] agora junta os pedidos feitos no meio numa passada extra logo depois.
8. **Resolvido em 2026-11-07:** `onClosed` sem proteção. O [[signInService]] agora embrulha o `onClosed`: uma falha em `saveLeavingSession` registra uma linha fixa e para o login com um erro fixo traduzível, sem o texto da exceção. Continua parando de propósito, porque seguir tiraria da Riot o login lembrado da conta que saiu sem guardá-lo.
9. **Resolvido em 2026-11-07:** a preferência `closeRiotClient` saiu, e o login visível sempre fecha a janela da Riot depois que o jogo abre. A opção `closeClient` do [[signInFlow]], que só valia no ramo escondido, saiu com ele no mesmo dia ([[ADR-028 Modo antigo removido]]).
10. **Resolvido em 2026-11-07:** corpo de resposta no log. O `requestLaunch` do [[riotClient]] grava só status, elegibilidade e um `errorCode` com formato de código ([[Segurança e privacidade]]).
11. **Saiu com a janela antiga em 2026-11-07.** Era sobre rejeições sem aviso na janela antiga ([[renderer]]); os [[cards]] não têm essas ações de menu.
12. **Saiu com o modo antigo em 2026-11-07.** O [[hostEntry]] foi removido.
13. **Tratado na migração da interface:** [[managerService]] centraliza métodos, quantidade de argumentos, formatos de conta, tipos de configurações e campos de patch; [[managerHost]] valida o remetente IPC isolado.

## Investigar

- **Canal de eventos da API local.** A regra única do estado da Riot saiu em 2026-11-07 ([[riotState]], [[ADR-029 Estado da Riot definido num lugar só]]), ainda com olhadas periódicas. Falta conferir na Riot real, só lendo e com autorização, se a API local tem canal de eventos (`/help`). Se tiver, pode trocar a olhada a cada 4 s do [[sessionKeeper]].
- **Validar o reinício com interface do [[riotInterface]].** O caminho `show` foi validado em 2026-10-26; o reinício (reserva) ainda não rodou numa instalação real.

## Estrutura

14. **Reavaliar depois da migração:** o [[main]] deixou de criar a janela e os handlers da interface; a validação de contas foi extraída para [[managerService]] e a UI para [[managerHost]]/[[manager-preload]]. O harness de inicialização foi atualizado. Separar a bandeja ou o agendamento só se a complexidade voltar a justificar.
15. **Saiu com a janela antiga em 2026-11-07.** O `src/renderer/app.js` foi removido.
16. **Lint e formatação.** No Rust, `cargo fmt --check` e `cargo clippy --all-targets` sem avisos (em 2026-11-15 ainda há avisos antigos nos testes: tipos complexos e `clone` desnecessário). Nos cartões, ESLint e Prettier como `devDependencies`, com uma regra que barre comentários novos.
17. **Resolvido em 2026-11-07:** limpar código morto. O que era do modo antigo saiu ([[ADR-028 Modo antigo removido]]). No mesmo dia saíram os ramos do login escondido do [[signInFlow]], o monitor de ocultação do [[windowController]] e do [[windowGuard.ps1]], a interface aberta escondida do [[riotInterface]] e do [[riotProcess]], o ramo `error:focus` do [[riotClient]], o `dryRun` do [[signInFlow]] (com o `submit` do [[login.ps1]]), o `signIn` do [[signInService]], as mensagens em inglês que citavam "Show Riot Client" e uma tradução sem uso no [[language]].
18. **Feito em 2026-11-07.** O experimento legado, a cópia privada e a janela antiga saíram ([[ADR-028 Modo antigo removido]]). O código está na tag `modo-antigo-final`.
19. **Resolvido.** `scripts/dev/mock-api.js` define `onSignInOperation`; desde 2026-11-07 ele só tem o que os cartões usam.
23. **Juntar o branch da migração.** Todo o trabalho do Tauri está no branch `migracao/tauri`, fora da `main` e ainda não enviado ao GitHub. Juntar e enviar depois da conferência acima, com o ok do usuário.

## Produto

20. **Instalador e atualização.** Desde 2026-11-15, `cargo tauri build` gera o Setup do Tauri, por usuário, com atalhos, desinstalador e só os arquivos de uma lista fechada ([[ADR-034 Troca do Electron pelo Tauri]]); a opção "Iniciar com o Windows" fica na bandeja. Falta: assinatura de código (certificado pago), atualização automática (o plugin `updater` do Tauri exige assinar as atualizações) e versionamento do formato de `data.json`. Os fuses do Electron deixaram de valer com a saída dele.
21. **Validar o fluxo dos cartões com contas reais**: sessão nova, sessão expirada e 2FA ([[Integração com o Riot Client]]), agora no Tauri.

## Ferramentas de desenvolvimento

22. **Resolvido em 2026-11-07:** servidor de prévia só local. Escuta em `127.0.0.1`, responde 400 a endereço malformado e serve só os arquivos dos cartões ([[Desenvolvimento]]).

Mais riscos de menor impacto estão em "Pontos de atenção" de cada nota de módulo.

## Feito

Ver [[Changelog]].
