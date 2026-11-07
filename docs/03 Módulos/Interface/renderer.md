---
tipo: módulo
arquivo: [src/renderer/app.js, src/renderer/ranks.js, src/renderer/index.html, src/renderer/styles.css]
camada: interface
testes: test/renderer/integratedNavigation.test.js
tags: [módulo]
---

# renderer

> Interface completa de contas hospedada na própria janela Riot: lista elos, filtra e ordena, abre os modais de conta/configurações e dispara ações pelo `window.api` isolado.

## Responsabilidade

- `index.html`: estrutura fixa (barra de título com abas, barra lateral, toolbar, banner, painel de lançamento, lista, toasts, três `<dialog>` e o menu do card) e a CSP.
- `app.js`: estado, renderização por `innerHTML`, eventos, modais e chamadas ao [[managerService]] pelo [[manager-preload]].
- `ranks.js`: tabelas de tiers, URLs de emblemas e pontuação de elo por jogo e fila.
- `styles.css`: tema por jogo, grade ou lista, modo streamer.
- **Não** recebe senhas salvas nem chaves (só `hasPassword` e chaves mascaradas), não acessa a rede nem o Node. Tudo passa pelo main.

## API pública

Nada é exportado para o app. `ranks.js` exporta para `app.js`:

| Export | Tipo | Descrição |
|---|---|---|
| `LOL_TIERS`, `VAL_GROUPS` | constantes | Tiers com nome e cor; grupos de VALORANT com seus números de tier |
| `QUEUES` | constante | `lol`: `solo`, `flex`; `tft`: `ranked`, `doubleUp`; `val`: `competitive` |
| `rankOf(acc, game, queue)` | função | Tudo que um card precisa para mostrar o elo de uma conta num jogo e fila: `group`, `color`, `emblem`, `emblemKind`, `label`, `sub`, `progress`, `score`, `level`, `wins`, `losses`, `winrate`, `hotStreak`, `climb`, `extra`, `lastSeason`, `lastChange`, `updatedAt`, `error` |
| `climbOf(entry)` | função | Desde 2026-11-05: para uma entrada de Mestre+ com `cutoffs`, `{ tier, cutoff, gap, holding }`. Mestre mira Grão-Mestre; Grão-Mestre e Desafiante miram Desafiante (`holding` no Desafiante); `gap` é corte menos PdL. Sem corte, `null`. Usado pelos [[cards]] |
| `distributionGroups(game)` | função | Grupos da barra lateral, com ícone |
| `lolEmblem`, `lolCrest`, `valIcon`, `valGroupIcon`, `profileIcon` | funções | URLs no CommunityDragon e no valorant-api |
| `lolBanner(lol)` | função | Desde 2026-11-05: URL do banner do League. `lol.banner` (só `[a-z0-9_]`, em minúsculas) ou o banner ranqueado do melhor elo entre `solo` e `flex`; sem elo, `default`. Usado pelos [[cards]] |
| `valCardArt(card)` | função | Desde 2026-11-05: URL da arte larga (`wideart.png`) do cartão de jogador. Tira o UUID de `card` (URL ou UUID puro); sem UUID, o cartão padrão do VALORANT. Usado pelos [[cards]] |

Chamadas a `window.api`: `init`, `saveAccount`, `deleteAccount`, `patchAccount`, `forgetSession`, `copy`, `refresh`, `runningGames`, `signIn`, `showRiotClient`, `cancelSignIn`, `saveSettings`, `pickClientPath`, `openDataFolder`, `closeManager`. Eventos: `onAccountUpdated`, `onSignInStatus`, `onSignInOperation`, `onRefreshProgress`, `onNextRefresh`.

## Dependências

- Usa: [[manager-preload]] (`window.api`), fontes `@fontsource` (`../../node_modules/…`), imagens de `raw.communitydragon.org` e `media.valorant-api.com`.
- Usado por: [[managerHost]], que carrega `MANAGER_RENDERER_FILE` dentro da janela Riot ([[paths]]). `scripts/dev/preview-server.js` serve a mesma página com `mock-api.js` no lugar do preload ([[Desenvolvimento]]).

## Estado, renderização e preferências

- `state`: `accounts`, `settings`, `regions`, `valRegions`, `nextRefresh`, `refreshing` (`{ done, total }`), `signingIn` (`{ id, text, needsAttention, cancelling }`), `clientFound`, `nativeIntegration`, `search`, `tierFilter` e as preferências.
- Preferências de interface lembradas entre sessões em `localStorage['ram-prefs']`: `game`, `queue`, `view`, `sort`, `region`, `hideBanned`. Busca e filtro de tier não são salvos.
- `render()` põe `data-game`, `data-view` e a classe `streamer` no `body` e redesenha fila, distribuição, banner e lista.
- `visibleAccounts()` filtra por região, banidas, tier e busca (nome, `#tag`, usuário, nota, região). Ordem: fixadas primeiro, banidas por último, depois `rank`, `name`, `level`, `played` ou `winrate`, com o nome como desempate.
- O banner avisa: Riot Client não encontrado, integração pedida mas inativa (com `reason`), chave de API ausente para o jogo da aba. Fica oculto sem contas.
- Contagem do próximo refresh a cada 1 s; lista redesenhada a cada 60 s, salvo durante um login.

## Modais, ações e atalhos

- **Conta**: Riot ID, servidor, região de VALORANT ("Auto (XX)"), usuário, senha, nota, última temporada por jogo, ban (`none`, `until`, `permanent`, e o jogo). Abre por botão, `Ctrl+N` ou clique duplo no card.
- **Configurações**: três chaves, intervalo de refresh, comportamento, modo streamer, caminho do cliente ("Browse") e "Show Riot Client".
- **Confirmação**: `confirmDialog` resolve `true` só com `returnValue === 'ok'`.
- **Menu do card**: editar, copiar Riot ID, atualizar elo, fixar, esquecer login salvo (se `hasSession`), limpar ban (se houver), apagar.
- **`play(acc)`**: confirma conta banida e jogo aberto, marca `signingIn`, assina `onSignInStatus`, chama `signIn` e mostra o resultado num toast que fecha em 4 s (sucesso) ou 8 s.
- **Painel de lançamento**: progresso, "Show Riot Client" só com `needsAttention`, e "Cancel".
- **Atalhos** (ignorados com um `<dialog>` aberto): `Ctrl+F` busca, `Ctrl+N` nova conta, `Ctrl+1/2/3` LoL/TFT/VALORANT, `F5` atualiza elos.
- **Voltar ao Riot:** botão visível na barra superior e `Escape` quando não há modal aberto. Chama `closeManager`, sem encerrar a janela Riot nem cancelar uma operação.

## Invariantes e decisões

- **CSP fechada.** `script-src 'self'`, `connect-src 'none'`, imagens só de `self`, `data:`, CommunityDragon e valorant-api. O renderer não faz requisições; tudo vem do main.
- **Escapar texto do usuário.** `esc()` em nome, tag, usuário, nota, erros e URL do card antes de `innerHTML`.
- **Banner e cartão só por ID.** `lolBanner` aceita só letras minúsculas, números e `_` no nome do banner, e `valCardArt` só aproveita um UUID. O host e o caminho são sempre montados em `ranks.js`, então um valor salvo estranho não vira outra URL.
- **Chave em branco mantém a salva.** Campos de chave vazios não são enviados. Chave nova com contas existentes dispara refresh.
- **Senha vazia mantém a atual.** `password` vai `undefined`; o campo só é obrigatório se a conta ainda não tem senha.
- **Colar "Name#TAG" divide.** No campo de nome, o que vem depois de `#` vai para a tag e o foco passa para ela.
- **Quem limpa é o `signIn`.** A requisição `signIn` cuida da limpeza e reativa o Play quando termina. `cancelSignIn` só marca `cancelling`.
- **Confirmação de troca é da visualização.** O aviso de banimento/jogo aberto continua aqui; `startFromManager` preserva esse fluxo, mantendo o cliente oculto. O seletor rápido segue recusando troca com jogo aberto.
- **Login vindo da ponte aparece.** `onSignInOperation` mantém `signingIn` em sincronia com operações iniciadas fora da janela. No `init`, uma operação `running` é restaurada.
- **Falha de carga visível.** `loadData` pede os dados ao main com até 3 tentativas, espaçadas de 1 s. Se ainda falhar, diz na tela que as contas continuam na pasta de dados, em vez de mostrar lista vazia, e oferece "Try again".
- **Redesenho de 60 s.** Existe para atualizar os prazos de ban e os rótulos "há x minutos".
- **Escopo do ban.** `val` vale para VALORANT, `lol` para LoL e TFT, `all` para todos. Ban vencido conta como sem ban.
- **Pontuação.** LoL/TFT: índice do tier × 1000 + divisão × 100 + LP; Master+ sem divisão, barra até 1500 LP. VALORANT: tier × 1000 + RR, ranqueado a partir do tier 3, Radiant (27) com barra até 1000 RR. Sem elo na fila (ou VALORANT abaixo do tier 3): `score = -1`.
- **Tema por aba.** Cada aba troca a paleta: LoL dourado e azul-petróleo hextech, TFT dourado e roxo arcano, VALORANT vermelho e angular. O botão Play imita o visual de cada cliente.
- **Sem janela própria.** A barra superior pertence à visualização de contas. Não arrasta uma janela nem desenha controles de fechar/minimizar do sistema; os controles continuam sendo os da janela Riot. Ver [[ADR-007 Interface completa dentro do Riot Client]].
- **Campos sensíveis digitados são transitórios.** Ao fechar os modais e ao voltar ao Riot, limpa os campos de senha e chaves recém-digitadas. Não preenche esses campos com valores salvos. Falha ao fechar a visualização mantém o rascunho e apresenta erro.
- **Preferências antigas preservadas.** Com `embedded: true`, as opções de janela independente deixam de ser oferecidas e a interface explica o comportamento em segundo plano. Os valores antigos não são apagados do armazenamento.
- **Emblemas de LoL.** Os arquivos têm 1280×720 com o emblema no meio; a imagem é ampliada (410%) para passar do preenchimento.
- **Modo streamer.** Desfoca `.username`; passar o mouse revela.

## Testes

`test/renderer/integratedNavigation.test.js` cobre a navegação integrada, o retorno ao Riot, o tratamento de `Escape` com modal, a limpeza de campos sensíveis e a preservação de funcionalidades no HTML/CSS. A prévia com `mock-api.js` continua sendo uma ferramenta de conferência visual, sem contas reais ([[Desenvolvimento]]).

## Pontos de atenção

- `submitSettings`, `deleteAccount` e as ações `pin`, `unban` e `forget` do menu não tratam erro. Recusas do main ("Wait for sign-in to finish…") viram rejeição sem toast.
- `onSignInOperation` recria `signingIn` com `cancelling: false` a cada atualização; o "Cancelling…" pode sumir antes do fim.
- O ramo "The game did not start" de `play` é inalcançável: o [[signInService]] nunca devolve `ok` sem `gameStarted`.
- `loadPrefs` copia qualquer chave salva para `state`; um `sort` inválido quebra `visibleAccounts`.
- `onAccountUpdated` não trata `null` (ver [[main]]) e ignora contas fora da lista.
- Não há como remover uma chave de API pela interface. O nível na aba TFT vem de `stats.lol.level`.
