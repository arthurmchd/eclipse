---
tipo: roadmap
tags: [changelog]
---

# Changelog

Mudanças relevantes, da mais nova para a mais antiga.

## 2026-11-26 · Eclipse 2.32.2: termos recusados logo depois do login são pedidos de novo

- Relato do usuário: a conta entrou, o LoL não abriu e a interface do Eclipse sumiu, sem pedido de termos na Riot. O log mostrou HTTP 464 `eula_not_accepted` 2 s depois do login, e o Jogar seguinte, 38 s depois, foi aceito sem aceitar nada. Agora o pedido do jogo é repetido a cada 3 s por até 20 s antes de mostrar a Riot ([[signInFlow]], [[ADR-053 Etapas do login na tela até o jogo abrir]]).
- Dois testes novos e dois ajustados. Não conferido na Riot real.

## 2026-11-26 · Eclipse 2.32.1: sessão guardada não some depois do jogo

- Pedido do usuário: o primeiro login de cada conta deve ficar salvo e os seguintes entrarem direto. O `sign-in.log` real mostrou que isso parou em 2026-11-20: com a Riot 143, de 30 s a 2 min depois de o jogo abrir, o guardião via o arquivo sem login e a Riot "sem conta" e apagava a sessão como se a conta tivesse saído. Agora, com um jogo aberto, nada é apagado ([[sessionKeeper]], revisão na [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]).
- Teste novo no guardião. Não conferido na Riot real; o próximo jogo e o Jogar seguinte mostram no log se a sessão continua valendo.

## 2026-11-25 · Vault: segunda busca de gerenciadores no GitHub

- 142 repositórios, 17 READMEs novos lidos; resultado em [[Estudo - Gerenciadores no GitHub]] (seção "Segunda busca"). Nenhum código mudou.

## 2026-11-25 · Eclipse 2.32.0: cartões indisponíveis durante o login

- Pedido do usuário: a área dos cartões indisponível enquanto o login roda. Entre cinco exemplos desenhados, ele escolheu o 3.
- Os outros cartões ficam cinza e apagados e param de receber o ponteiro. O cartão da conta em login fica colorido, com borda vermelha e o selo "Entrando…" (em cima nos cartões, ao lado do nome na lista). O Cancelar continua no rodapé ([[cards]], [[ADR-053 Etapas do login na tela até o jogo abrir]]).
- Teste novo no JS (`signingState`). Conferido na prévia, nos cartões e na lista, com contas fictícias.

## 2026-11-25 · Eclipse 2.31.0: linha do tempo e logo da Riot na tela de carregamento

- Pedido do usuário: entre seis layouts desenhados num canvas, usar a opção 2 (linha do tempo) e o logo da Riot Games "exatamente no mesmo lugar e tamanho" do Riot Client.
- A [[overlayCover]] mostra as etapas numeradas, ligadas por uma linha, com um resumo nas feitas e o status na atual.
- O logo vem do `app.asar` da instalação da Riot, só lido, conferido e guardado na memória ([[riotLogo]]), e aparece no ponto que o CSS da Riot dá a ele (64 px do topo, centralizado, 113 × 32). Nada da Riot entra no Setup ([[Segurança e privacidade]], [[Estudo - Visual da Riot]]).
- Testes novos no Rust e no JS. Conferido num Edge sem janela com dados fictícios; não conferido sobre a Riot real.

## 2026-11-25 · Eclipse 2.30.1: jogo recusado pela Riot mostra a Riot

- Relato do usuário na 2.30.0: "meu lol nao abrir". O `sign-in.log` mostrou HTTP 464 `eula_not_accepted` no pedido do jogo: a Riot pedia o aceite dos termos do League, e o Eclipse cobria a janela dela até o prazo de 180 s acabar.
- O [[signInFlow]] agora trata qualquer recusa do pedido do jogo como pedido de atenção: mostra a Riot (abre a janela se for preciso) e continua esperando o jogo, que abre quando o usuário aceita e clica em Jogar. Sem aceite, o erro diz para aceitar os termos ([[ADR-053 Etapas do login na tela até o jogo abrir]]).
- Quatro testes novos no Rust. Não conferido na Riot real.

## 2026-11-25 · Eclipse 2.30.0: etapas do login na tela até o jogo abrir

- Pedido do usuário, depois de comparar com o Tariolle/LeagueAccounts: no lugar do anel, a coluna de login mostra a lista do que está acontecendo, e o Eclipse fica na tela até o jogo abrir ([[ADR-053 Etapas do login na tela até o jogo abrir]], [[Estudo - Gerenciadores no GitHub]]).
- **Etapas.** O [[signInFlow]] marca cada status com `prepare`, `sign_in`, `verify`, `launch` ou `done`, e a operação do [[signInService]] leva o campo `step`. "Game opened" sai assim que a janela do jogo fica pronta. O aviso de jogo demorando deixou de pedir atenção ("The game is taking longer to open or is updating…").
- **Lista.** A [[overlayCover]] mostra Preparar a Riot, Entrar na conta, Conferir a conta e Abrir o jogo, com o texto do status embaixo da etapa atual. A página ganhou `cover.js`, que só recebe dados, sem comando nem dado de conta ([[Segurança e privacidade]]).
- **Na tela até o jogo.** O [[riotOverlay]] não esconde mais a janela quando a conta entra durante um login do Eclipse; fecha o furo do observador nessa fase, fica no lugar quando a janela da Riot fecha e segue a próxima. Pedidos de atenção, falha, cancelamento e a etapa `done` devolvem a regra antiga.
- Testes novos no Rust e no JS. A lista conferida num Edge sem janela com etapas fictícias. Não conferido na Riot real: a sobreposição sem dono no login com sessão salva, o furo fechado sobre a tela inicial e a saída quando o jogo abre.

## 2026-11-25 · Eclipse 2.29.2: correções do /code-review

- Pedido do usuário: rodar o `/code-review` nas mudanças da 2.29.0 e 2.29.1 e corrigir os quatro achados.
- **Diálogo fechado por uma piscada da Riot.** Desde a 2.29.0 as webviews descansavam no primeiro retrato sem a janela da Riot, e a página `hidden` fechava o cadastro com o que estava digitado. Agora só descansam depois de 2 s sem a Riot ([[riotOverlay]]).
- **Volta da Riot minimizada.** Depois de mais de 2,5 s minimizada, os cartões esperavam uma leitura nova ao restaurar. Agora voltam na hora com a última leitura, e a leitura nova corrige ([[riotOverlay]]). A 2.29.0 já prometia a volta instantânea.
- **Estandarte atrasado.** A cópia reduzida que fica pronta depois dos 15 s é liberada, e o temporizador é limpo pela mesma dependência que o criou ([[cards]], [[ADR-050 Estandarte reduzido nos cartões]]).
- **Vault.** `banners.js`, `cardPatch.js` e seus testes entraram na nota [[cards]], e a linha que ainda falava de `loading="lazy"` no estandarte foi corrigida.
- Na mesma conversa, sem mudança de código: varredura de segurança com roteiros do repositório Claude-BugHunter (fora do projeto, não instalado): segredos nos arquivos e no histórico, XSS e DOM nos cartões, CI e publicação. Nada encontrado além de um endereço falso de teste; as actions do CI usam versão por nome, não por hash.
- Testes novos para cada correção. Não conferido na Riot real.

## 2026-11-25 · Eclipse 2.29.1: estandarte de volta nos cartões

- Relato do usuário: na 2.29.0 instalada os cartões do League mostravam só um retângulo vazio no lugar do estandarte. Na prévia do Chrome a redução funcionava, então a falha é do WebView2; a causa exata não foi vista na Riot real. A redução em `banners.js` deixava a promessa pendurada quando algo falhava dentro do `onload` (erro do `canvas`), e o cartão ficava sem `src` para sempre. Agora toda falha rejeita, a cópia `blob:` só vale se carregar, há limite de 15 s, e em qualquer desses casos o cartão mostra a original. O `img` sem `src` fica invisível até ter imagem ([[cards]], [[ADR-050 Estandarte reduzido nos cartões]]). Testes novos simulam cada falha. Conferido na prévia; não conferido na Riot real.

## 2026-11-24 · Eclipse 2.29.0: menos processador com a Riot aberta e escondida

- Pedido do usuário: aplicar as quatro primeiras otimizações do relatório de processador e memória ([[Medição de CPU e memória]]).
- **API local.** O certificado da Riot fica guardado enquanto o `app.asar` não muda, e os `GET` reaproveitam a conexão; os pedidos que mudam a Riot continuam com conexão própria e sem repetição ([[ADR-051 Certificado guardado e conexão reaproveitada na API local]], [[riotTransport]], [[backend]], [[Segurança e privacidade]]). Conferido com um servidor TLS de teste fora do repositório: 5 `GET` numa conexão, uma conexão por `POST`, `PUT` e `DELETE`, raiz errada recusada.
- **Observador.** Cada janela é conferida contra o caminho da Riot uma vez, não a cada 180 ms, e o caminho do executável é lido num buffer pequeno ([[riotWindowObserver]], [[win32]]).
- **Sobreposição.** Nada de leitura do login com a Riot minimizada; na volta, uma leitura na hora ([[riotOverlay]]). Com a Riot fechada, a conta conectada ou o login fora da tela, as três webviews descansam, e a página dos cartões para de perguntar por eventos ([[manager-preload]], [[managerHost]]). Riot minimizada ou com aviso não põe as webviews para descansar, para a volta continuar instantânea.
- **Menos processos de renderização.** A WebView2 recebe o limite de um processo, e a cobertura e a caixa deixaram o perfil anônimo. Ficaram dois processos em vez de três: os cartões num, a cobertura e a caixa no outro ([[ADR-052 Webviews da sobreposição num processo só]], [[overlayCover]], [[overlayToggle]]).
- Medido na 2.29.0 instalada, com a Riot visível e os cartões à vista, em 60 s depois de alguns minutos aberto: `eclipse.exe` com 0,62% de um núcleo (a 2.28.4 tinha 1,4% a 1,7%) e 16,9 MB privados (19 MB); WebView2 com 258 MB em 8 processos (288 MB em 9); nenhuma conexão à API local em TIME_WAIT (eram ~317); o serviço da Riot com 0,73% de um núcleo (2,8%) ([[Medição de CPU e memória]]).
- Testes novos para cada parte. Não conferido na Riot real: a volta dos cartões depois do descanso e depois de restaurar a Riot.

## 2026-11-24 · Eclipse 2.28.4: só o cartão que mudou é redesenhado

- Pedido do usuário: a lista inteira era recriada a cada atualização (passo do login, conta atualizada, letra da busca). Agora só os cartões cujo conteúdo mudou são recriados; os outros são mantidos ou só mudam de lugar, com as imagens já carregadas ([[cards]]). Conferido na prévia num Edge sem janela, contando os cartões mantidos em seleção, busca, atualização, troca de ordem pelo teclado, aba e layout. Não conferido na Riot real.

## 2026-11-24 · Eclipse 2.28.3: estandarte reduzido

- Pedido do usuário: procurar o que ainda carrega de um jeito que não deveria. O estandarte do League vinha em 580×1480 para aparecer em 140×357; agora os cartões guardam uma cópia de 280×714, de 3,3 MB para 0,8 MB por estandarte, com o mesmo tamanho na tela ([[ADR-050 Estandarte reduzido nos cartões]], [[cards]], [[Segurança e privacidade]]). Conferido na prévia a 200%, lado a lado com a versão antiga. Não medido na Riot real. Na mesma busca: processador parado em 0,5% de um núcleo, leituras de fundo em ritmo normal, sons carregados só ao tocar e o emblema grande do League sem uso; a lista inteira redesenhada a cada aviso ficou para quando houver muitas contas.

## 2026-11-24 · Eclipse 2.28.2: menos memória

- Relato do usuário: o Eclipse aparecia como "WebView2 Manager" no Gerenciador de Tarefas, ocupando bem mais que no começo. O outro grupo "WebView2 Manager" da captura era de outro programa. Com a sobreposição escondida, as três webviews pedem à WebView2 a meta de memória baixa ([[riotOverlay]]), e o fundo dos cartões do League usa a versão quadrada da arte, seis vezes menor ([[cards]]). Medido com a Riot fechada, 90 s depois de abrir: memória ativa de 538 MB para 178 MB; memória reservada de 264 para 234 MB. A arte menor não foi medida na Riot real, só conferida pelos testes.

## 2026-11-23 · Eclipse 2.28.1: ordem de tamanho fixo e hexágono menor

- Pedido do usuário: a caixa de ordem mudava de largura a cada opção ("Jogada recente", "Maior elo" …) e mexia a barra. Agora ela tem a largura fixa da opção mais longa. O hexágono do cartão do TFT ficou um pouco menor ([[cards]]). Conferido na prévia em 900 e 636 px.
- Publicado em 2026-11-23 a pedido do usuário: PR #9 no `main` e release `v2.28.1` com Setup, `.sig` e `latest.json`; o endereço da atualização responde com a 2.28.1 e o SHA-256 do Setup confere. Testes do CI verdes. Sem a conferência na Riot real do guia ([[Publicar no GitHub]]): o usuário escolheu publicar sem ela.

## 2026-11-23 · Eclipse 2.28.0: filtros num botão só

- Pedido do usuário: os botões da barra estavam amontoados. De sete propostas, ele escolheu a E: servidor e elo foram para um botão "Filtros", que abre um painel com fichas e mostra quantos filtros estão ligados; "+ Adicionar conta" virou um botão vermelho com texto na linha da busca ([[cards]]). Conferido na prévia em 900 e 636 px, no fundo claro e no escuro.

## 2026-11-23 · Eclipse 2.27.0: novos cartões do League e do TFT

- Pedido do usuário: os cartões do LoL e do TFT ficavam "um pé atrás" do VALORANT. De uma página com nove propostas, ele escolheu a C para o League (estandarte com a ilustração do campeão do perfil desfocada ao fundo) e a H para o TFT (Pequena Lenda num hexágono dourado sobre um tabuleiro). O Eclipse passa a ler do cliente do LoL o fundo de perfil e a Pequena Lenda escolhidos, só com GET, e guarda só os nomes de arquivo validados ([[gameRanks]], [[cards]], [[rankWatcher]], [[rankApi]]). Conferido na prévia; não conferido num cliente do LoL real.

## 2026-11-23 · Eclipse 2.26.0: cartão próprio na aba Riot

- Pedido do usuário: a aba Riot (só entrar) mostrava os cartões do último jogo clicado. Agora tem um cartão da conta Riot: faixa vermelha, ícone de perfil, nome, servidor e os elos de League, VALORANT e TFT juntos; na lista, uma coluna por jogo ([[cards]]). Conferido na prévia.

## 2026-11-23 · Eclipse 2.25.0: botão de fundo escuro

- Pedido do usuário: um botão para trocar o tema de claro para escuro, por enquanto só no fundo. O botão de lua (ou sol) fica ao lado de Configurações e a escolha é salva ([[ADR-049 Fundo escuro opcional]], [[cards]], [[store]], [[managerService]]). Conferido na prévia.

## 2026-11-23 · Eclipse 2.24.1: placas do VALORANT na mesma altura

- Pedido do usuário: a placa sem elo ficava com nível, nome e elo mais baixos que as outras. Sem elo, a placa mostra a barra de RR vazia, e a linha da barra tem altura fixa, para as placas com e sem variação de RR também ficarem iguais ([[cards]]). Conferido na prévia.

## 2026-11-23 · Eclipse 2.24.0: nomes do VALORANT como são e ícone de sem elo

- Pedido do usuário: na placa do VALORANT, o nome aparece como o jogador escreveu, sem maiúsculas forçadas. Conta sem elo mostra o ícone de sem classificação do jogo na placa e na lista, para manter o padrão dos cartões ([[cards]]). Conferido na prévia.

## 2026-11-23 · Eclipse 2.23.0: arraste só pela faixa de cima

- Pedido do usuário: o Eclipse e a Riot se arrastavam por qualquer espaço vazio dos cartões; agora só pela faixa de cima (30 px acima da busca), como a barra de qualquer aplicativo ([[ADR-048 Arraste só pela faixa de cima]], [[cards]], [[overlayDrag]]). Não conferido na Riot real.

## 2026-11-23 · Eclipse 2.22.4: aparência do jogo não some na atualização

- Relato do usuário: a borda aparecia padrão e não acompanhava o League. Na conta aberta no League, a borda salva era a mesma que o cliente informa. Corrigidos dois defeitos achados na investigação: a atualização pela chave ou pelo OP.GG apagava o banner lido do jogo ([[rankApi]]), e a borda de elo usava o elo da temporada passada no lugar do elo mais alto atual, ao contrário do cliente ([[gameRanks]]). Contas que nunca foram abertas com o League aberto ficam com a borda padrão do nível até a primeira leitura.

## 2026-11-23 · Eclipse 2.22.3: banner padrão do LoL como padrão

- Pedido do usuário: o banner padrão do LoL substitui o do elo como padrão. Conta ainda não lida, conta sem banner escolhido e id que não se resolve mostram o padrão; o do elo só aparece quando o jogador o escolheu no jogo. O TFT usa o mesmo banner do League ([[gameRanks]], [[ranks]], [[cards]]).

## 2026-11-23 · Eclipse 2.22.2: banner do jogo atualiza ao entrar

- Relato do usuário: depois de entrar na conta, só a borda mudava. Duas causas: o banner lido do jogo era descartado ao juntar a leitura com os dados salvos ([[rankWatcher]]), e só se lia o banner do elo, não o escolhido em Personalizar identidade. Agora o Eclipse segue a regra do cliente do LoL: banner escolhido (evento, desafio), padrão ou elo da temporada passada, pelo resumo de desafios e pelo inventário de banners ([[gameRanks]], [[ranks]], [[Segurança e privacidade]]). Não conferido num cliente real.

## 2026-11-23 · Eclipse 2.22.1: borda equipada substitui a padrão

- Pedido do usuário: a borda de nível do invocador é só o padrão; quando o Eclipse lê do jogo a borda que a conta está usando (ao entrar com o League aberto), ela passa a valer na placa do League e do TFT ([[cards]], [[ranks]], [[gameRanks]]).

## 2026-11-23 · Eclipse 2.22.0: borda de nível para todos e arte do VALORANT na placa inteira

- Pedido do usuário: no League e no TFT, toda conta mostra a borda de nível padrão do próprio nível, no lugar da borda equipada ([[ranks]], [[cards]]). No VALORANT, a arte do cartão de jogador cobre a placa inteira a partir do topo, com nível, nome e elo no pé, escolhida entre três desenhos. Conferido só na prévia.

## 2026-11-23 · Eclipse 2.21.0: cartões com banner e arte do jogo, todos do mesmo tamanho

- Pedido do usuário: cartões o mais perto possível do jogo, com banner e borda, e todos do mesmo tamanho. No League e no TFT, o banner do elo fica pendurado no topo, com o ícone e a borda equipada por cima; no VALORANT, a arte vertical do cartão de jogador com o selo de nível. Toda placa tem 356 px de altura em qualquer aba, e o emblema do elo foi para o lado do nome do elo ([[cards]], [[ranks]]). A leitura do cliente do LoL passa a guardar o banner padrão do perfil, o elo mais alto da temporada passada, da mesma resposta que já dava a borda ([[gameRanks]]). Sem título do jogo por enquanto. Conferido só na prévia.

## 2026-11-23 · Eclipse 2.20.0: fundo claro e cada jogo só nos cartões

- Pedido do usuário: estética diferente por jogo, mas mudando só os cartões, e um fundo estático, moderno, parecido com a Riot e em tom de branco. A página (fundo, busca, filtros, caixas e rodapé) ficou clara e igual em todas as abas, com o Jogar no vermelho da Riot; as placas e a lista têm o estilo de cada jogo: League dourado em azul-noite, VALORANT com canto cortado, TFT roxo e dourado, 2XKO preto e limão, Runeterra pergaminho e Riot branco ([[ADR-047 Fundo claro e estilo do jogo só nos cartões]], [[cards]], [[riotOverlay]]). Conferido só na prévia.

## 2026-11-23 · Eclipse 2.19.2: primeiro login sem o aviso do Manter login

- Relato do usuário: no primeiro uso, o Jogar ficava carregando e acabava pedindo para conferir a tela da Riot, que mostrava o aviso de como funciona o "Manter login". Causa, lida na interface da Riot 143: ligar a caixa pela primeira vez numa instalação abre esse aviso, que cobre o botão de entrar, e o clique do Eclipse em entrar se perdia. Agora o Eclipse marca o aviso como visto pelo serviço local antes de preencher, como a própria Riot faz ao mostrá-lo ([[ADR-046 Aviso do Manter login marcado como visto]], [[riotClient]], [[loginForm]], [[Segurança e privacidade]]). Não conferido na Riot real numa instalação nova.

## 2026-11-21 · Eclipse 2.19.1: cartões voltam a acompanhar a Riot

- O observador em Rust da 2.19.0 nunca reconhecia a janela da Riot, porque comparava o caminho do `RiotClientInstalls.json` (com `/`) com o do processo (com `\`). Agora os dois lados são normalizados ([[riotWindowObserver]]). Achado pelo `riot_check` na Riot real, com autorização do usuário.
- `riot_check` e o preenchimento esperam os campos do UI Automation pelo mesmo laço de até 3 s; a checagem tentava uma vez só e falhava enquanto o Chromium ligava a árvore de acessibilidade ([[loginForm]]).
- Conferido na Riot real com uma cópia temporária dos dados e contas sem 2FA: `riot_check` todo verde; login com a Riot na tela de login em 33,7 s e com a Riot fechada em 36,7 s e 44,7 s, sempre `input:uia` e com o jogo percebido. Uma primeira tentativa, com a Riot parada na tela de login havia muito tempo, não achou o formulário pronto em 60 s ("authenticator captcha: hcaptcha"); não se repetiu nas três seguintes, e a busca da janela é a mesma do `.ps1`. Numa das tentativas a caixa "Stay signed in" saiu `remember:unknown`.
- Publicada a pedido do usuário: PR #8 no `main` com a CI verde na primeira rodada e release `v2.19.1` com Setup, `.sig` e `latest.json`, o primeiro com atualização automática ([[Publicar no GitHub]]).

## 2026-11-21 · Eclipse 2.19.0: sem PowerShell

- Pedido do usuário: deixar o Eclipse pronto para muita gente usar. Os três helpers em PowerShell com C# embutido viraram Rust dentro do próprio Eclipse ([[ADR-044 Helpers do Windows em Rust]]): o preenchimento do login ([[loginForm]]), trazer a Riot à frente e procurar a janela do jogo ([[windowGuard]]) e o acompanhamento da janela da Riot ([[riotWindowObserver]]). Some o 1 a 2 s de abrir o PowerShell e compilar o C# a cada login e a cada pergunta pela janela do jogo (a cada 500 ms), e some o `powershell.exe -ExecutionPolicy Bypass` com credenciais no stdin, que antivírus costumam marcar. As credenciais não saem mais do processo do Eclipse, e a lista de processos não abre mais o `tasklist` ([[win32]], [[riotClient]], [[windowController]], [[paths]], [[Segurança e privacidade]]). O comportamento é o mesmo, regra por regra; ainda falta conferir na Riot real.
- Testes automáticos no GitHub: `.github/workflows/tests.yml` roda `cargo clippy -- -D warnings`, `cargo test` e `npm test` no Windows a cada envio e pull request. Para o clippy passar, o envio HTTPS da [[riotTransport]] devolve um tipo de erro próprio (`SendFailure`).
- Aviso de Riot atualizada: o `sign-in.log` mostra a versão do Riot Client a cada preenchimento do formulário, e se o formulário falha numa Riot mais nova que a última conferida (143), o erro diz isso e pede para procurar uma atualização do Eclipse, em vez de só "a tela de login não carregou" ([[riotVersion]], [[riotClient]], [[language]], [[Atualização do Riot Client]]).
- Atualização pelo GitHub: o Eclipse procura uma versão nova 1 minuto depois de abrir e a cada 12 horas, avisa por um balão e mostra "Atualizar para a versão X" na bandeja. Só instala com o clique, nunca no meio de um login, e só um Setup assinado pela chave do projeto. "Procurar atualizações" na bandeja desliga ([[ADR-045 Atualização pelo GitHub]], [[updates]], [[appUpdater]], [[main]], [[Segurança e privacidade]]). Passa a valer quando um release trouxer o `latest.json` ([[Publicar no GitHub]]); no Eclipse instalado, a primeira pergunta saiu 1 minuto depois de abrir e deu 404, como esperado, porque o último release ainda é o `v2.15.1`. Quem tem a 2.18 ou anterior baixa a 2.19.0 à mão uma vez.
- Checagem antes de publicar: `cargo run --example riot_check` confere, sem login, a versão da Riot, o observador, o formulário de login e os campos que o preenchimento usa ([[Publicar no GitHub]], [[loginForm]]).
- Estudo das regras da Riot para vender o Eclipse ([[Estudo - Regras da Riot para vender o Eclipse]]): cobrar exige produto registrado e aprovado no portal de desenvolvedores da Riot; a recomendação é manter grátis e perguntar à Riot antes.

## 2026-11-21 · Eclipse 2.18.1: preenchimento por UI Automation funcionando na Riot real

- Testada na Riot real com autorização do usuário, a 2.18.0 entrou nas 6 tentativas, mas sempre pela digitação antiga (`input:keys`): o Chromium aplica o valor uns 200 ms depois do `SetValue`, e o campo de busca dos cartões aparece dentro da janela da Riot. Agora o [[loginForm]] só considera campos de processos da Riot, preenche a senha antes do usuário e espera o usuário aparecer ([[ADR-043 Preenchimento do login por UI Automation]]). No reteste, 6 de 6 com `input:uia`: do formulário ao envio caiu de 8,2 s para 4,1 s, e o login com League de 41,4–42,3 s para 37,1–37,8 s (Riot na tela de login) e de 45,4–46,3 s para 42,3–42,5 s (Riot fechada).

## 2026-11-21 · Eclipse 2.18.0: senha preenchida sem digitar letra por letra

- Pedido do usuário: aplicar o ganho da digitação medido no [[Laboratório de velocidade do login]]. O [[loginForm]] preenche usuário e senha pelos campos que a janela da Riot expõe ao UI Automation, e só cai na digitação por mensagens de antes se não achar exatamente um campo de senha e um outro campo, ou se o usuário não ficar igual. No laboratório, o envio caiu de 6,9 s para 0,3 s. O `sign-in.log` diz qual caminho foi usado ([[ADR-043 Preenchimento do login por UI Automation]], [[signInFlow]], [[Segurança e privacidade]]). Ainda não conferido com a versão instalada na Riot real.

## 2026-11-21 · Eclipse 2.17.2: login com a conta já conectada não trava

- Clicar em Jogar com a conta já conectada na Riot podia mostrar "A Riot ainda não terminou o login" e expirar em 180 s. Reproduzido com autorização do usuário: o autenticador ativa o hCaptcha do formulário do próximo login cerca de 1 s depois, com a conta autorizada e a sessão do jogador liberada. Agora o CAPTCHA do formulário só bloqueia enquanto a autorização não responde 200; com ela, quem decide é a sessão do jogador ([[ADR-042 CAPTCHA do formulário não bloqueia conta autorizada]], [[riotAuthentication]], [[signInFlow]], [[Segurança e privacidade]]).

## 2026-11-21 · Eclipse 2.17.1: fonte do login não terminado no log

- Pedido do usuário: investigar o login que travou com a conta já conectada no laboratório de velocidade ([[Laboratório de velocidade do login]]). O fluxo via `challenge` com a Riot autorizada e esperava 180 s. Primeiro passo, só diagnóstico: o `sign-in.log` agora diz de onde veio o `challenge` (CAPTCHA do autenticador, tipo desconhecido dele ou estado da sessão do jogador), sempre com nomes de lista fixa ([[riotAuthentication]], [[signInFlow]], [[Segurança e privacidade]]). O comportamento do login não mudou.

## 2026-11-21 · Eclipse 2.17.0: iniciar com o Windows nas configurações

- Pedido do usuário: uma caixa nas configurações para abrir o Eclipse junto com o Windows. "Iniciar com o Windows" aparece no diálogo de configurações dos [[cards]] do app instalado e usa o mesmo registro da opção da bandeja ([[startWithWindows]], [[appPorts]], [[managerService]]). Continua desligada até o usuário marcar.

## 2026-11-21 · Eclipse 2.16.0: arrastar a Riot pela área do Eclipse

- Pedido do usuário: arrastar o Riot Client e o Eclipse juntos pela parte de cima e pelo meio da área dos cartões. Apertar num espaço vazio da página dos [[cards]] começa o arraste conjunto do [[overlayDrag]], o mesmo da barra da Riot; botões, campos, cartões, diálogos e a barra de rolagem continuam como estão ([[ADR-041 Arraste da Riot pela área do Eclipse]]). Pedido novo `windowAction` `drag` no [[managerHost]] e `dragRiot()` no [[manager-preload]].

## 2026-11-21 · Eclipse 2.15.2: cartões fora da abertura da Riot

- Relato do usuário: ao abrir a Riot, às vezes o Eclipse aparecia sozinho por 2 a 3 s sobre a "mãozinha". O observador escolhia a janela de abertura da Riot (600 × 600, "sempre por cima"); agora ignora janelas da Riot com `WS_EX_TOPMOST` ([[riotWindowObserver]]).

## 2026-11-20 · README novo

- Pedido do usuário: "arrume o readme como algo bem profissional", sem o nome antigo. Logo, frase de apresentação, selos de versão e downloads, capturas com contas fictícias da prévia (`.github/assets/`), recursos, instalação, como funciona, segurança, perguntas frequentes, seção para desenvolvedores e aviso legal da Riot. Os detalhes técnicos continuam no vault.
- README todo em inglês, a pedido do usuário, com capturas do Eclipse dentro da janela inteira do Riot Client, para mostrar a integração. Saíram de uma cópia de teste (`cargo run` com `ECLIPSE_DATA_DIR`) com as contas fictícias da prévia, sobre a Riot na tela de login, autorizada pelo usuário só desta vez. O painel do VALORANT foi gerado pela prévia e colado sobre a mesma captura, porque o app sempre abre na aba do League. Passo a passo em [[Publicar no GitHub#Capturas do README]].
- Repositório renomeado de `riot-account-manager` para `eclipse` (`github.com/arthurmchd/eclipse`), também a pedido do usuário. A pasta do projeto e a de dados continuam com o nome antigo.

## 2026-11-20 · Repositório público e primeiro release

- Pedido do usuário: "consegue colocar no github? e um release para qualquer um poder baixar". O PR #5 levou o `migracao/tauri` ao `main`, e o primeiro release público, `v2.15.1`, saiu com o Setup e o SHA-256. O passo a passo está em [[Publicar no GitHub]]. O README ganhou "Baixar", o aviso do SmartScreen e o aviso de projeto de fã da Riot ([[Estudo - Visual da Riot]]).

## 2026-11-20 · Eclipse 2.15.1: sons ligados por padrão

- Pedido do usuário: "pode deixar o som como ligado como padrão?". "Sons da interface" vem ligado; só quem desmarcar nas configurações fica sem som ([[sounds]], [[store]], [[ADR-040 Visual da Riot e sons da interface]]).

## 2026-11-20 · Eclipse 2.15.0: cara de Riot

- Pedido do usuário: "pode aplicar todas as mudanças menos a da arte no fundo" ([[ADR-040 Visual da Riot e sons da interface]]). Tema escuro do Riot Client, Inter, movimento da Riot, estilo próprio nas abas League e VALORANT e neutro nas outras, cantos e sombras do Riot Client, cores de aviso da Riot e rótulos em maiúsculas ([[cards]]).
- "Sons da interface" nas configurações, desligado por padrão: sons do cliente do League vindos da CommunityDragon ([[sounds]], `uiSounds` no [[store]] e no [[managerService]]). A CSP dos cartões ganha `media-src https://raw.communitydragon.org`.
- Inter 500, 600 e 700 no Setup e no [[assetProtocol]]. Fundo da visualização dos cartões escuro no Tauri ([[riotOverlay]]).

## 2026-11-20 · Estudo do visual da Riot

- Pedido do usuário: cores, fontes, cantos, sombras, movimento, bibliotecas e sons do Riot Client e do cliente do League, lidos dos arquivos instalados e da CommunityDragon ([[Estudo - Visual da Riot]]). Só documentação; nada no código.

## 2026-11-20 · Estudo dos gerenciadores no GitHub

- Pedido do usuário: 35 gerenciadores de contas da Riot no GitHub comparados com o Eclipse, inclusive os abandonados, e como lidam com a verificação da Riot ([[Estudo - Gerenciadores no GitHub]]). Só documentação; nada no código.

## 2026-11-20 · Borda equipada nas placas

- Pedido do usuário: a placa mostra a borda que a conta usa no jogo, lida depois que ele entra com o jogo aberto; antes disso, nenhuma borda ([[cards]], [[ranks]]). League e TFT: borda de nível ou armadura de elo, por um `GET` a mais no cliente do LoL (`lol-regalia`, [[gameRanks]]). VALORANT: moldura e selo de nível, pela presença que o Eclipse já lia.
- A borda salva fica quando a leitura não a traz ([[rankWatcher]]) e quando a chave ou o OP.GG atualizam o elo ([[rankApi]]).
- Conferido no LoL real no mesmo dia: a borda de nível de uma conta do usuário apareceu depois de uns 4 minutos com o cliente aberto. A primeira tentativa não leu nada porque o cliente ficou aberto só 25 s e a leitura é de minuto em minuto. Borda de elo e VALORANT ainda não conferidos ([[Backlog]]). Conferido na prévia, com bordas fictícias, nas abas League, TFT e VALORANT.
- Versão 2.14.0, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Placa selecionada sem efeito

- Pedido do usuário: o escurecimento das outras placas (2.13.0) saiu; a placa selecionada não tem mais marca visual até ele escolher outra solução ([[cards]]). Continuam: começar sem seleção, desmarcar com novo clique ou Espaço, duplo clique para entrar, e a conta escolhida no rodapé. A lista não mudou.
- Versão 2.13.1, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Seleção escurece as outras contas

- Pedido do usuário: no lugar do fundo tingido (2.12.2), a conta selecionada fica normal e as outras placas escurecem ([[cards]]). Nenhuma conta abre selecionada; clicar de novo na selecionada (ou Espaço) desmarca e tira o escurecimento; duplo clique entra direto, inclusive na que já estava selecionada.
- O duplo clique passou a ser o segundo `click` em vez do evento `dblclick`, que o WebView não dispara quando o primeiro clique redesenha a lista. Conferido na prévia com um Edge sem janela: início sem seleção, selecionar, desmarcar com clique e com Espaço, duplo clique numa conta nova e na já selecionada.
- Versão 2.13.0, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Conta selecionada com fundo tingido

- Pedido do usuário: o selo "Selecionada" com borda e anel saiu das placas. A selecionada agora tem o fundo e a borda tingidos na cor do jogo, como na lista ([[cards]]). Escolhida entre sete opções numa página de comparação fora do projeto. Conferido na prévia em League e VALORANT.
- Versão 2.12.2, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Placas sem degradê

- Pedido do usuário: o brilho na cor do elo atrás do ícone das placas saiu; o fundo ficou escuro e liso ([[cards]]). O aro do retrato e a borda do nível seguem na cor do elo. Conferido na prévia.
- Versão 2.12.1, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Revisão de design dos cartões

- Pedido do usuário: análise de design do Eclipse para quem quer entrar rápido nas contas, com a lista priorizada aplicada inteira, menos o nome do jogo ao lado do ícone, que virou só ícones maiores ([[cards]]).
- Jogar com duplo clique ou Enter na conta; ícones dos jogos de 24 para 30 px; placas de cerca de 415 para 273 px, com o nome acima do elo e sem a linha do Flex; "Sem classificação" discreto; texto mínimo de 12 px e cinza mais claro nas placas; ↻, + e ⚙ maiores.
- Busca de até 360 px, que recebe o que se digita fora dos campos; caixas abrem no primeiro campo; "Preencher com Nome#TAG" como botão; "Remover conta" à esquerda; contador com "N em outros jogos"; abas Riot, 2XKO e Runeterra dizem de que jogo é o elo.
- Testes novos em `cardList.test.js` (`usage` sem contagem, `countLabel`, `startsSearch`) e `cardView.test.js` (`queueLabel`). Conferido na prévia em capturas de um Edge sem janela.
- Versão 2.12.0, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Cadastro com os cinco jogos

- Pedido do usuário: ao adicionar uma conta, escolher com ícones se ela fica no VALORANT, LoL, TFT, 2XKO, Runeterra ou em todos ([[cards]]). O "Mostrar em" virou seis pílulas com ícone: Todos e os cinco jogos. Com Todos marcado, um clique num jogo deixa só ele; depois cada clique soma ou tira um. Vale também para "Várias contas" e para editar.
- Cada aba de jogo mostra só as contas marcadas para ela. O TFT deixou de seguir o League, e 2XKO e Runeterra deixaram de mostrar todas.
- Backend: `ACCOUNT_GAMES` com os cinco jogos no [[store]] e no [[managerService]]. O `data.json` ganhou `"schema": 2`, e contas salvas antes continuam nas mesmas abas.
- Testes novos em `cardList.test.js` (`toggleGame` e as cinco abas), `store.rs` (dados antigos) e `manager_service.rs`. Conferido na prévia, em capturas do Edge sem janela.
- Versão 2.11.0, gerada e instalada por cima nesta máquina.

## 2026-11-20 · Memória do agente no vault

- A memória do Claude Code saiu de `~/.claude/` e passou para [[Memória]], em `docs/07 Memória/`, com o template [[Nota de memória]]. O `CLAUDE.md` manda ler o índice no começo de toda tarefa e salvar ali o que for preciso lembrar ([[Trabalhando com agentes]]).
- Vieram [[Testes sem o usuário]], [[Setup novo a cada mudança]] e [[Escolhas técnicas pelo agente]]. A memória da migração para o Tauri já estava superada pela nota [[Migração para Tauri]]; dela só ficou a dica do `CARGO_TARGET_DIR` em [[Desenvolvimento]].
- Só vault e configuração do agente; sem Setup novo.

## 2026-11-19 · Sem aviso falso de verificação

- Um login demorado que terminou em erro de serviço da Riot mostrava "A Riot pede uma verificação de segurança" sem verificação na tela. O aviso vinha só do tempo: qualquer `challenge` depois de 12 s virava verificação ([[signInFlow]], [[riotAuthentication]]).
- Só 2FA e CAPTCHA recusado pela Riot têm nome. O resto mostra "A Riot ainda não terminou o login. Confira a tela da Riot, caso ela precise de você", e o tempo esgotado diz "O login expirou". O jogo continua sem abrir com algo pendente.
- Testes novos em `sign_in_flow.rs`, um deles com o caso do log; `riot_authentication.rs` ajustado.
- Versão 2.10.3, gerada e instalada por cima nesta máquina.

## 2026-11-19 · Ícones .svg no Setup

- No app instalado, os ícones do League, do TFT e do 2XKO apareciam quebrados: o Setup levava só os `.png` de `src/renderer/assets/` ([[assetProtocol]]). Os ícones redesenhados da versão 2.10.0 também eram `.svg` e provavelmente nunca apareceram no app. O Setup passou a levar os `.svg`, e o teste de arquivos do Setup passou a conferi-los.
- Versão 2.10.2, gerada e instalada por cima nesta máquina.

## 2026-11-19 · Ícones dos jogos baixados pelo usuário, fundo transparente

- Os ícones redesenhados não ficaram bons; o rodapé usa os ícones que o usuário baixou, e a barra de jogos perdeu o bloco escuro ([[cards]]). Fora de uso, os ícones viram silhueta cinza escura.
- Versão 2.10.1, gerada e instalada por cima nesta máquina.

## 2026-11-19 · Jogos como na Riot, com TFT, 2XKO e Runeterra

- Pedido do usuário, com a captura da barra lateral do Riot Client ([[cards]], [[ADR-038 TFT, 2XKO e Runeterra no Eclipse]]).
- Rodapé só com ícones, num bloco escuro como o da Riot: League of Legends, VALORANT, Teamfight Tactics, 2XKO, Legends of Runeterra e, separado, o Riot Client. Ícones redesenhados em SVG a partir da captura.
- O Jogar abre cada jogo pelo seu próprio produto da Riot e espera o processo dele ([[signInFlow]], [[riotClient]], [[windowGuard]], [[riotState]], [[appPorts]], [[managerService]]). O TFT passou a abrir o `teamfighttactics`, não mais o League.
- Cartões do TFT com Ranqueada e Dupla. 2XKO e Runeterra não têm elo e mostram o último jogo com elo.
- Testes novos em `riot_client.rs`, `sign_in_flow.rs`, `riot_state.rs`, `app_ports.rs`, `cardView.test.js` e `cardList.test.js`.
- Versão 2.10.0, gerada e instalada por cima nesta máquina. 2XKO e Runeterra não estão instalados aqui, então o login deles não foi visto funcionando.

## 2026-11-19 · Sem etiquetas, + só com ícone, ⚙ sem chaves

- Pedido do usuário ([[cards]]):
  - etiquetas removidas dos cartões, do cadastro, do filtro e da busca;
  - "+ Adicionar conta" virou só o ícone +;
  - os campos de chave de API (Riot e HenrikDev) e a dica saíram das configurações.
- Backend: `tags` saiu do [[managerService]] (recusada como chave extra) e do [[store]], que apaga etiquetas antigas ao salvar e não as copia mais nos backups, como a cor em 2026-11-18. As chaves continuam aceitas e usadas; só não há mais campo para digitá-las.
- Testes ajustados em `store.rs`, `manager_service.rs`, `cardList.test.js` e `cardsText.test.js`.
- Versão 2.9.0, gerada e instalada por cima nesta máquina.

## 2026-11-19 · Conta selecionada, filtros e ordem manual

- Pedido do usuário: seguir os três pontos da avaliação de UX, um depois do outro ([[cards]]).
- Conta selecionada: a placa ganha anel na cor do jogo, sobe um pouco e mostra o selo "Selecionada"; na lista, faixa colorida à esquerda. O foco de teclado virou um contorno escuro separado da seleção.
- Filtros: "Servidor", "Elo" e "Etiqueta" no lugar de "Todos os…", cada um com a largura do próprio texto, e destaque na cor do jogo quando está em uso. Busca com "Nome, login ou etiqueta". Nada mais é cortado em 757 nem em 636 px.
- Ordenação: ícone de setas e "Ordem manual" no lugar de "Minha ordem"; "Nome (A–Z)" e "Jogada recente".
- Teste novo em `cardsText.test.js` para o tamanho desses textos.
- Versão 2.8.0, gerada e instalada por cima nesta máquina.

## 2026-11-19 · Rodapé só de jogar

- Pedido do usuário: a barra de baixo estava confusa e amontoada ([[cards]]). Das duas versões desenhadas, ele escolheu a que deixa os jogos no rodapé.
- O rodapé agora tem só as abas dos jogos (com nome, na ordem League of Legends, VALORANT e Riot Client), a conta selecionada com elo e servidor, e o Jogar. Altura de 104 para 88 px.
- Contador, ↻, "+ Adicionar conta", placas ou lista e ⚙ foram para uma faixa nova entre os filtros e os cartões. ↻ e ⚙ viraram ícones SVG, e a lista vazia ganhou um botão "Adicionar conta".
- `selectionView` novo em `cardView.js`, com testes em `cardView.test.js`.
- Versão 2.7.0, gerada e instalada por cima nesta máquina.

## 2026-11-18 · Cor e notas da conta removidas

- Pedido do usuário: tirar a cor do cartão e as notas, que ele não quer usar ([[cards]]). Saíram do cadastro, das placas, da lista, da busca e das traduções.
- Backend: `color` saiu do [[managerService]] (agora recusada como chave extra) e do [[store]], que apaga uma cor antiga ao salvar a conta e não a copia mais nos backups. O campo `note`, anterior à 2.5.0, continua guardado e preservado ao editar, só não aparece.
- Testes ajustados no `store.rs`, `manager_service.rs` e `cardList.test.js`.
- Versão 2.6.0, gerada e instalada por cima nesta máquina. Pedido do usuário no mesmo dia: depois de cada mudança, gerar uma versão nova com Setup e instalá-la.

## 2026-11-15 · Organizar muitas contas (bloco 1)

- Pedido do usuário: implementar, bloco por bloco, uma lista de recursos tirada de outros gerenciadores. O bloco 1 organiza muitas contas ([[cards]]):
  - busca, filtros de servidor, elo e etiqueta, e ordenação por minha ordem, maior elo, nome ou jogada por último;
  - arrastar para reordenar (ou Alt+setas), estrela para fixar no topo, cor do cartão, etiquetas e notas;
  - "Jogada há 2 dias · 17 entradas" em cada conta, com o novo `signInCount` ([[signInService]]);
  - adicionar várias contas de uma vez, e preencher o Riot ID com a conta aberta na Riot que ainda não está salva ([[rankWatcher]], [[appPorts]]);
  - no cadastro, escolher se a conta aparece em todos os jogos, só no League ou só no VALORANT.
- Backend: `addAccounts`, `pinAccount` e `reorderAccounts` no [[managerService]], com `tags`, `color`, `games` e `cardSort` validados; `add_accounts` e `reorder_accounts` no [[store]].
- Decisões do usuário no mesmo dia: copiar usuário ou senha saiu da lista; copiar as configurações do jogo para as alts no League pode escrever na pasta `Config` da Riot, com um ADR antes do código (bloco 4); RP, Essência Azul, VP, loja, skins e banimento podem aparecer como "visto em <data>" da última vez que a conta entrou (bloco 2).
- Testes: `test/renderer/cardList.test.js` novo; testes novos no `store.rs`, `manager_service.rs`, `sign_in_service.rs`, `rank_watcher.rs`, `app_ports.rs` e no preload. Conferido na prévia: arraste, busca, lista, caixa de várias contas e filtro por jogo.
- Antes do bloco, o branch `migracao/tauri` foi enviado ao GitHub a pedido do usuário.
- Versão 2.5.0, gerada e instalada por cima nesta máquina.

## 2026-11-15 · Segunda leitura do OP.GG no ↻

- Pedido do usuário: quando ele pede a atualização (↻, salvar as configurações ou salvar uma conta), as contas que vieram do OP.GG são lidas de novo 8 s depois, já com o perfil que a primeira consulta mandou o OP.GG atualizar ([[refresher]], [[ADR-037 Elo do League pelo OP.GG]]). As atualizações automáticas continuam com uma leitura só.
- Medido com um perfil público: a atualização do OP.GG ficou pronta antes da consulta seguinte, poucos segundos depois.
- Três testes novos no `refresher.rs`.
- Versão 2.4.0, gerada e instalada por cima nesta máquina.

## 2026-11-15 · Elo do League pelo OP.GG

- Decisão do usuário, depois de comparar o Eclipse com outros gerenciadores no GitHub: o OP.GG é a fonte principal do elo do League sem chave, e o jogo aberto corrige na hora a conta em que a pessoa joga ([[ADR-037 Elo do League pelo OP.GG]]).
- Módulo novo [[opgg]]: pedido ao endpoint público `mcp-api.op.gg`, leitura do formato de texto dele e o bloco `stats.lol` com a hora do perfil e `source: "opgg"`.
- O [[rankApi]] usa a API oficial com chave e o OP.GG sem chave ou quando ela falha, e só troca o elo salvo por um mais novo. O [[refresher]] passa a atualizar todas as contas mesmo sem chave. O [[rankWatcher]] apaga a marca do OP.GG ao ler o jogo.
- Conferido com um perfil público, nunca com contas do usuário: a chamada real pelo Eclipse, e que cada consulta faz o OP.GG atualizar o perfil mas devolve o dado anterior.
- Testes: `src-tauri/tests/application/opgg.rs` novo; os testes da passada sem chave e do erro sem chave foram atualizados.
- Versão 2.3.0, gerada e instalada por cima nesta máquina.

## 2026-11-15 · Ícones do elo do pacote do usuário

- Pedido do usuário: trocar os ícones do elo do League, que "não são bons", pelos do pacote do emoji.gg que ele baixou. Os nove viraram PNG dentro do app; o de Esmeralda, que falta no pacote, saiu do emblema oficial com o mesmo recorte ([[ranks]]). Sem elo continua o símbolo do CommunityDragon.
- Os emblemas ficaram maiores na placa, na lista e na linha do corte ([[cards]]).
- Teste novo em `test/renderer/ranks.test.js`: todo elo aponta para um arquivo que existe. Conferido na prévia, em placas e lista.
- Versão 2.2.0, gerada e instalada por cima nesta máquina. Desde este dia, o usuário autorizou gerar e instalar o Setup depois de toda mudança, sem perguntar.

## 2026-11-15 · Lista compacta sem o retângulo cinza

- Relato do usuário na 2.1.0: na lista compacta, uma conta sem partidas no Solo/Duo mostrava um retângulo cinza na coluna de vitórias. Era a barra vazia; agora a coluna mostra só "—" ([[cards]]).
- Versão 2.1.1: Setup gerado. A pedido do usuário, a instalação ficou com ele, e o [[Como usar]] ganhou o passo a passo para gerar e instalar uma versão nova sozinho.

## 2026-11-15 · Placas verticais e lista compacta

- Pedido do usuário: reformular o cartão das contas. Num quadro com sete opções inspiradas em sites de estatísticas, escolheu as placas verticais como padrão e a lista compacta para quem tem muitas contas, trocadas por dois ícones no rodapé ([[cards]]).
- Os dados do cartão saíram do visual: `cardView.js` monta os campos de cada conta e `cards.js` só os desenha, em placa ou em linha.
- A escolha fica salva na configuração `cardLayout` (`plates` ou `list`), validada pelo [[managerService]] e guardada pelo [[store]] só depois do primeiro clique.
- Saíram o banner do League e a arte larga do VALORANT; o retrato do VALORANT usa a arte quadrada ([[ranks]]).
- Testes: `test/renderer/cardView.test.js` novo, o do banner saiu; testes Rust do `cardLayout` no store e no serviço.
- Versão 2.1.0: Setup gerado e instalado por cima nesta máquina, a pedido do usuário. 390 testes com `cargo test` e 27 com `npm test`. A pasta da Cinzel da instalação anterior continua em `%LOCALAPPDATA%\Eclipse`, porque o Setup não apaga arquivos de versões antigas; o app não a serve mais.

## 2026-11-15 · Cartões respeitam a ordem das janelas e a caixa não some no arraste

- Relato do usuário depois da 2.0.0: com a Riot em segundo plano, os cartões ficavam por cima dos outros programas. A janela deles estava "sempre por cima" e a da Riot não; a janela de abertura da Riot é "sempre por cima" e passa o estilo para os cartões presos a ela. O [[riotWindowObserver]] passa a tirar o estilo dos cartões quando a Riot escolhida não o tem, e a pô-los logo acima dela.
- Relato do usuário: arrastando a Riot, a caixa "Ocultar contas" sumia até soltar. A leitura de cor que detecta o formulário da Riot pegava a tela um quadro atrasada; agora só lê com a janela parada desde a leitura anterior.
- Testes: autoteste do helper com os casos novos. O `test/package.test.js` deixa de travar o número 2.0.0 e passa a conferir que npm, Tauri e Cargo têm a mesma versão, 2.0.0 ou mais nova.
- Versão 2.0.1: Setup gerado e instalado por cima nesta máquina, a pedido do usuário. 388 testes com `cargo test` e 24 com `npm test`.

## 2026-11-15 · Eclipse 2.0.0: só Tauri

- A pedido do usuário, o Electron saiu do projeto antes da conferência na Riot real ([[ADR-034 Troca do Electron pelo Tauri]], revisão). O último commit com ele tem a tag `electron-final`. Detalhes do que saiu e do que ficou em [[Migração para Tauri]].
- Versão 2.0.0, a primeira só em Tauri. O Setup do Tauri foi gerado e instalado nesta máquina; ele desinstalou o Eclipse em Electron, mantendo as contas, as sessões e o início com o Windows.
- Os `.bat` saíram: o Eclipse abre pelo atalho do Setup. Em desenvolvimento, `cargo run` com `ECLIPSE_DATA_DIR`.
- O `CLAUDE.md`, o README, o [[00 Início]], o [[Como usar]] e as notas dos módulos passaram a apontar para os arquivos em Rust; o texto sobre o JS ficou marcado como histórico.
- Testes: 388 com `cargo test` e 24 com `npm test`.
- Depois de instalar, o usuário abriu o Eclipse 2.0.0 e as contas reais abriram normalmente: primeira leitura, pelo Rust, do `data.json`, das senhas e das sessões gravadas pelo Electron.
- O [[Backlog]] ganhou a lista do que falta conferir no Tauri e perdeu o que só valia para o Electron.
- As notas de todos os módulos foram reescritas para o Rust: a API pública, as dependências e os testes listam os itens e arquivos em Rust, os parágrafos "Versão Rust" das fases viraram regras comuns, e o aviso "Só Rust" saiu do topo. O que só fazia sentido no Electron saiu, menos o histórico de decisões. A [[Arquitetura]] e o guia de [[Desenvolvimento]] passaram a descrever o app em Tauri, com os comandos, os testes e o Setup de hoje.

## 2026-11-15 · Migração para Tauri: o Eclipse assume o arraste da Riot

- O usuário conferiu a [[ADR-035 Posição da sobreposição movida pelo helper]] na Riot real e disse que, arrastando rápido, os cartões continuavam para trás. Pela [[ADR-036 Arraste da Riot assumido pelo Eclipse]], no Tauri, o arraste pela barra de cima com os cartões à vista passa a ser do Eclipse: o [[overlayDrag]] (novo) toma a captura do mouse e move a Riot e a sobreposição juntas num único `DeferWindowPos` por movimento.
- O helper do [[riotWindowObserver]] avisa o começo do arraste (`EVENT_SYSTEM_MOVESIZESTART`, só com `follow`) e não move a sobreposição enquanto ela tem a captura.
- Se a captura ficar com a Riot, o Eclipse desiste e os cartões seguem como na ADR-035. Cada desfecho ganha uma linha no `sign-in.log`, uma vez por execução.
- Testes: 388 com `cargo test` (18 novos) e os 383 do `npm test`, que rodam o autoteste do helper. O laço de arraste do Windows não pode ser testado sem mouse: na Riot real, quem confere é o usuário. No Electron nada muda.

## 2026-11-14 · Migração para Tauri: certificado da Riot conferido no Rust

- Com a Riot aberta pelo usuário e com a permissão dele, o [[riotTransport]] em Rust fez um único `GET` na Riot real (o sinalizador de segundo plano do [[riotAppControls]]) e o TLS do Windows aceitou o certificado dela em `127.0.0.1`, com a validação ligada: resposta 200. Nada foi gravado, nenhum login foi tocado e o Eclipse em Tauri não foi aberto.
- O teste manual ficou em `src-tauri/tests/riot/riot_transport.rs`, marcado com `#[ignore]`: só roda a pedido e só imprime o status.
- **Primeiro uso do Eclipse em Tauri na Riot real, pelo usuário, com uma pasta de dados de teste.** Dois defeitos achados e corrigidos:
  - Os cartões seguiam o arraste da Riot com muito atraso. Cada movimento reposicionava as três webviews sem precisar; agora elas só são reposicionadas quando o tamanho muda, e a thread principal aplica só a posição mais nova ([[riotOverlay]]).
  - Depois dessa correção o atraso ficou "bem menor", mas arrastando rápido o usuário ainda sentia os cartões soltos e pediu "uma espécie de fita". Agora, no Tauri, o helper do [[riotWindowObserver]] move a sobreposição no instante em que mede a Riot, e o Rust cuida só do tamanho ([[ADR-035 Posição da sobreposição movida pelo helper]]). No Electron nada muda.
  - Ao reabrir, as contas só apareciam depois de atualizar. Os cartões pediam as contas antes de o estado do app entrar no Tauri; agora ele entra antes de a janela ser criada ([[main]]).
- O [[00 Início]] ganhou os links da [[ADR-033 Sobreposição no Tauri]] e da [[ADR-034 Troca do Electron pelo Tauri]].

## 2026-11-13 · Migração para Tauri, fase 5: bandeja completa e Setup do Tauri

- **Fase 5 da [[Migração para Tauri]], primeira parte ([[ADR-034 Troca do Electron pelo Tauri]]):** a bandeja do Tauri ganhou "Iniciar com o Windows" ([[startWithWindows]]), a segunda cópia passou a abrir as contas da primeira (`tauri-plugin-single-instance`) e os balões viraram notificações do Windows ([[notices]], [[toasts]], com o `tauri-winrt-notification`).
- O Eclipse em Tauri não abre com o Electron aberto: confere se o Electron segura o `lockfile` da pasta de dados ([[electronInstance]]).
- Setup do Tauri: `cargo tauri build` gera um instalador de 2,3 MB, por usuário, com os cartões, as fontes e os `.ps1` numa lista fechada; no app instalado, a raiz do [[paths]] é a pasta do executável. Se achar o Eclipse em Electron instalado, o Setup o desinstala em modo de atualização, mantendo a pasta de dados e o início com o Windows (`src-tauri/windows/hooks.nsh`). A CSP do `tauri.conf.json` ficou `default-src 'none'`.
- Testes: 369 com `cargo test`, incluindo o conteúdo do Setup; os 383 do `npm test` continuam passando.
- Nada foi instalado nem rodado; o Setup só foi compilado. A tag no git e a remoção do Electron esperam o usuário conferir o app em Tauri na Riot real.

## 2026-11-13 · Migração para Tauri, fase 4: a sobreposição e o app ligado

- **Fase 4 da [[Migração para Tauri]]:** [[riotWindowObserver]], [[riotOverlay]], [[overlayToggle]], [[overlayCover]], [[managerHost]] e a ponte do [[manager-preload]] em Rust, e o [[main]] em Rust ligando o [[store]], os serviços da fase 3 e a bandeja. Novos: [[assetProtocol]] (o `eclipse://`, lista fechada de arquivos), [[refresher]] (a fila de elos que no Electron mora no `index.js`) e [[appPorts]] (as portas do [[managerService]] e o `saveLeavingSession`).
- Decisões na [[ADR-033 Sobreposição no Tauri]]: uma janela transparente com três webviews (feature `unstable` do Tauri), `SetWindowRgn`, pixels físicos, o mesmo `.ps1`, comandos liberados por webview, oclusão do WebView2 desligada e Win32 só na thread principal.
- Em desenvolvimento, o app exige `ECLIPSE_DATA_DIR` com uma pasta absoluta e não abre sem ela ([[paths]]). O [[store]] em Rust grava também o `sign-in.log`.
- Testes novos em `src-tauri/tests/`: 359 com `cargo test`; o temporizador manual foi para `tests/support/`. Os 383 do `npm test` continuam passando; o app Electron não mudou.
- O app em Tauri não foi rodado: ligado, ele vigia a janela da Riot real e mexe no login lembrado da Riot, mesmo com dados fictícios. Nada leu os dados reais nem falou com a Riot.

## 2026-11-13 · Migração para Tauri, fase 3: os serviços em Rust

- **Fase 3 da [[Migração para Tauri]]:** [[signInService]], [[sessionKeeper]], [[riotWakeup]], [[rankWatcher]], [[rankApi]] e [[startWithWindows]] portados para `src-tauri/src/`, com o novo [[timers]] no lugar do `setTimeout`. O login roda numa thread própria. O [[store]] ganhou o `ServiceStore`, a interface que os serviços usam.
- O [[startWithWindows]] em Rust grava ele mesmo a entrada de inicialização no registro do usuário, no formato do Electron. Crates novos: `sha2` (hash da chave do [[rankApi]]) e `winreg`.
- Testes novos em `src-tauri/tests/application/` e `tests/platform/windows/`, portados dos testes JS: 315 com `cargo test`. Os 383 do `npm test` continuam passando; o app Electron não mudou.
- Os serviços ainda não estão ligados ao app; ligar o [[main]] e o `ManagerPorts` ficou para a fase 4. Nada leu os dados reais, consultou a Riot, chamou as APIs de elo ou tocou o registro do Windows.

## 2026-11-13 · Migração para Tauri, fase 2: a camada da Riot em Rust

- **Fase 2 da [[Migração para Tauri]]:** [[asar]], [[backend]], [[riotTransport]], [[riotState]], [[riotAuthentication]], [[riotInterface]], [[riotAppControls]], [[riotProcess]], [[gameRanks]], [[riotClient]] e [[signInFlow]] portados para `src-tauri/src/`, mais [[windowController]] e [[windowsEnvironment]], que o login usa. As regras de segurança não mudaram: senha só para a rota local da Riot ou para o `login.ps1` pela entrada padrão, nenhuma tentativa de contornar CAPTCHA ou 2FA, logs só com textos fixos.
- O executor do PowerShell ganhou cancelamento e, no prazo ou no cancelamento, encerra a árvore inteira do processo.
- Testes novos em `src-tauri/tests/riot/`, `tests/integration/` e `tests/platform/windows/`, portados dos testes JS: 215 com `cargo test`. Os 383 do `npm test` continuam passando; o app Electron não mudou.
- Não conferido com a Riot real: nenhum processo da Riot foi aberto, fechado ou consultado. Falta ver se o TLS do Windows aceita o certificado local da Riot.

## 2026-11-13 · Começa a migração para Tauri e Rust

- A pedido do usuário, para deixar o Eclipse mais leve ([[ADR-032 Migração para Tauri e Rust]]). O app Electron não mudou e continua sendo o Eclipse de verdade; o Tauri cresce ao lado, em `src-tauri/`, por fases ([[Migração para Tauri]]).
- **Fase 1, base:** projeto Tauri 2 com bandeja e Sair; [[store]], [[language]], [[managerService]] e `paths` portados para Rust; [[safeStorage]] (novo) lê e grava os segredos no formato do `safeStorage` do Electron, conferido com o Electron 44 do projeto numa pasta temporária.
- Rust 1.100 instalado pelo `rustup` (winget, só no usuário) e `tauri-cli` 2 pelo `cargo`.
- Testes novos em `src-tauri/tests/`: 39 com `cargo test`, mais um manual com uma amostra do Electron. Os 383 do `npm test` continuam passando.
- `.gitignore` ganhou `src-tauri/target/` e `src-tauri/gen/`.

## 2026-11-08 · Borda de cima da Riot e Setup sem o nome do autor

- **[[riotOverlay]]:** a pedido do usuário, os cartões não passam mais da borda da Riot em cima. O Windows desenha a borda de 1 px da Riot por cima da primeira linha da área cliente, só em cima (conferido na Riot real, só lendo). Com cantos arredondados, essa linha sai da região dos cartões e da coluna coberta, e as pontas de cima descem junto. A janela e os cartões não mudam de tamanho. Não conferido na tela: o usuário preferiu não ter a tela capturada.
- **Setup:** o `author` passou de "Arthur" para "Eclipse" (empresa, copyright e editor no Windows) e o `appId` passou a `Eclipse.AccountManager`. O `nsis.guid` fica na chave do primeiro Setup, para o novo instalar por cima ([[ADR-030 Eclipse instalado por um Setup próprio]]).
- Testes novos: a borda de cima em `test/integration/overlay/riotOverlay.test.js` e o nome do instalador em `test/package.test.js`. 383 testes.

## 2026-11-08 · Elo do LoL conferido na Riot real

- Com o LoL do usuário aberto e só `GET` ([[gameRanks]]): o certificado foi aceito e as rotas e os campos vieram como esperado, com `queues` e `queueMap` juntos e as filas sem elo com `tier` vazio e `"NA"`. O Eclipse instalado gravou sozinho o elo do LoL e do TFT numa conta salva ("updated a saved account from the League client"). O VALORANT não foi conferido: estava fechado ([[Backlog]]).
- **[[rankWatcher]]:** o cliente do LoL não manda a sequência de vitórias (`hotStreak`). A leitura agora mantém a que veio de uma chave enquanto as vitórias e derrotas da fila não mudam, em vez de apagá-la a cada minuto. Nenhum cartão mostra esse campo.
- Testes novos: o formato real da resposta do LoL, com valores fictícios, em `test/riot/gameRanks.test.js`, e a sequência de vitórias em `test/core/rankWatcher.test.js`. 381 testes.

## 2026-11-08 · Elo sem chave, lido do jogo

- A pedido do usuário, para um amigo usar o Eclipse sem criar chave de API ([[ADR-031 Elo lido do próprio jogo, sem chave]]).
- **[[gameRanks]] (novo):** lê o elo da conta que está no jogo. LoL e TFT pelo cliente do LoL (`lockfile` da pasta do jogo, mesmo certificado da Riot, só `GET`); VALORANT pela presença da própria conta no chat do Riot Client. As presenças dos amigos são descartadas.
- **[[rankWatcher]] (novo):** a cada 60 s, com o jogo aberto e fora de um login, grava o elo na conta salva com o mesmo Riot ID. Mantém o que só a chave dá (cortes de Mestre+, RR, pico, temporada passada) enquanto o elo for o mesmo.
- **[[main]]:** cria o watcher e, sem nenhuma chave, faz a atualização só pedir a leitura do jogo, sem consultar servidores. Com chave, nada muda.
- **[[ranks]]:** um elo de VALORANT sem RR aparece sem a linha de RR, em vez de "null RR".
- **[[cards]]:** a dica das chaves no ⚙ diz que elas são opcionais. O diálogo não mudou de forma.
- Não conferido na Riot real: as rotas e os campos vêm da documentação da comunidade ([[Backlog]]).
- Testes novos: `test/riot/gameRanks.test.js`, `test/core/rankWatcher.test.js`, o watcher e a atualização sem chave em `test/main/mainStartup.test.js` e o VALORANT sem RR em `test/renderer/ranks.test.js`. 379 testes.

## 2026-11-08 · Eclipse instalável

- A pedido do usuário: o Eclipse funciona como o Rose, instalado e na bandeja, sem abrir o VS Code ([[ADR-030 Eclipse instalado por um Setup próprio]]).
- **`npm run dist`** gera `dist/Eclipse Setup 1.0.0.exe` com o electron-builder 26.18.0: instalação de um clique, por usuário, sem administrador, com atalhos "Eclipse" no menu Iniciar e na Área de Trabalho e desinstalador. Sem assinatura e sem atualização automática.
- **Mesmos dados:** o `name` continua `riot-account-manager`, e o nome "Eclipse" vem só de `build.productName`. Conferido no pacote: o `package.json` do `app.asar` não tem `productName`. A desinstalação não apaga os dados.
- **Pacote só com o código:** `src/`, `package.json` e as fontes. Os três `.ps1` saem do `app.asar` iguais aos do projeto ([[paths]]).
- **[[startWithWindows]] (novo):** opção "Iniciar com o Windows" na bandeja, desmarcada por padrão e só no app instalado ([[main]], [[language]]). O desinstalador apaga a entrada, menos ao instalar uma versão nova por cima (`scripts/build/installer.nsh`).
- O `package.json` ganhou `author`, que vira a empresa do executável no lugar de "GitHub, Inc.".
- O Setup gerado não foi executado: instalar e abrir o Eclipse mexe na Riot real e na pasta de dados real.
- Testes novos: `test/platform/windows/startWithWindows.test.js`, `test/package.test.js` e a opção da bandeja em `test/main/mainStartup.test.js`. 362 testes.

## 2026-11-07 · Estado da Riot num lugar só

- A pedido do usuário, item 4 da análise de remendos de 2026-11-06 ([[ADR-029 Estado da Riot definido num lugar só]]).
- **[[riotState]] (novo):** define fechada, em jogo, com janela, sem janela, em segundo plano e conta `'yes'`/`'no'`/`'unknown'`. Cada olhada consulta a Riot no máximo uma vez por pergunta.
- **[[sessionKeeper]], [[riotWakeup]], `closeEverything` do [[riotClient]] e o começo do [[signInFlow]]** passam a perguntar a ele, em vez de combinar `runningGames`, `authorization` e `sessionState` cada um do seu jeito.
- **[[riotClient]]:** exporta `look()`; saem as saídas `clientRunning`, `isAuthorized`, `authorization` e `sessionState`, que só o guardião e o wakeup usavam.
- O comportamento com a Riot real não muda. Nos testes do guardião, a Riot falsa responde só pela lista de processos e por `authorization`, passando pela regra real; cenários impossíveis ("roda" e "não roda" na mesma conferência) deixam de existir.
- Fica para depois: conferir na Riot real se a API local tem canal de eventos ([[Backlog]]).
- Testes novos: `test/riot/riotState.test.js` e, no [[signInFlow]], uma conta `'unknown'` nunca reaproveitada. 351 testes.

## 2026-11-07 · Seis correções pequenas do Backlog

- A pedido do usuário, fecha os itens 4, 5, 7, 8, 10 e 22 do [[Backlog]].
- **[[signInService]] (item 8):** o `onClosed` ganha proteção. Uma falha ao guardar a sessão de quem sai registra uma linha fixa e para o login com "Could not keep the session of the account that was signed in. Try Play again", traduzido pelo [[language]]. Continua parando de propósito: seguir tiraria da Riot o login lembrado da conta que saiu sem guardá-lo. O texto da exceção, que pode trazer caminhos, não vai mais à tela nem ao log.
- **[[rankApi]] (item 5):** cada consulta tem prazo de 15 s, do pedido ao fim do corpo, e é abortada ao estourar. O `retry-after` vale em segundos ou como data HTTP; um pedido de espera acima de 60 s vira erro em vez de travar a fila.
- **[[store]] (item 4):** uma chave de API ilegível vem vazia no `getKeys()`, e o refresh segue com as outras. Antes derrubava o refresh de todas as contas.
- **[[main]] (item 7):** contas pedidas durante um refresh entram numa passada extra logo depois, em vez de esperar o ciclo seguinte. O refresh passa a ser feito por `runRefresh`.
- **[[riotClient]] (item 10):** o `requestLaunch` vira `createLaunchRequester` e grava no `sign-in.log` só status, elegibilidade e um `errorCode` com formato de código, sem os 300 caracteres de cada resposta.
- **Prévia (item 22):** `scripts/dev/preview-server.js` escuta só em `127.0.0.1`, responde 400 a endereço malformado e serve só `src/renderer/`, as fontes e o `mock-api.js` ([[Desenvolvimento]]). Também fecha um furo achado no caminho: a checagem por `startsWith` deixava passar uma pasta vizinha com o mesmo começo de nome.
- [[Segurança e privacidade]] ganha as regras de log e da prévia.
- Testes novos para cada item, incluindo `test/scripts/dev/preview-server.test.js`. 344 testes.

## 2026-11-07 · Duas traduções voltam

- Correção da limpeza anterior: dos três pares tirados do [[language]] como sem uso, dois eram usados pelo lado em português. Com o app em inglês, "Preparando o login no Riot Client…" e "Não foi possível acompanhar a janela do Riot…" apareceriam em português.
- Os dois pares voltam. O [[signInFlow]] passa a escrever "Preparing the Riot Client sign-in…" e "Signing in…", e o [[riotWindowObserver]] "Could not follow the Riot window. Restart Eclipse.", em inglês como o resto; o [[language]] traduz na saída.
- Teste novo: todo status do [[signInFlow]] e o erro do observador são escritos em inglês e têm tradução. 330 testes.

## 2026-11-07 · Resto do código morto sai

- A pedido do usuário, fecha o item 17 do [[Backlog]].
- **[[riotInterface]] e [[riotProcess]]:** saem a opção `visible` do `openInterface` e o `interfaceRequired` do `launchClient`. A interface só é pedida com a janela visível.
- **[[riotClient]]:** sai o ramo `error:focus`, que o [[loginForm]] nunca emitia.
- **[[signInFlow]] e [[loginForm]]:** saem o `dryRun` e o campo `submit`; o script sempre clica em entrar.
- **[[signInService]]:** sai `signIn(id, game)`, usado só nos testes. O app continua chamando `startFromManager`.
- **[[language]]:** as mensagens em inglês param de citar o botão "Show Riot Client" e dizem para olhar ou abrir a janela da Riot, como as traduções já diziam. Saem três traduções sem uso.
- [[ADR-003 Sem contornar CAPTCHA ou 2FA]] ganha uma nota: o desafio é concluído na própria tela da Riot, sem botão nem monitor. A regra não muda.
- O comportamento do app não muda, salvo o texto das mensagens em inglês.
- Testes: os do [[signInService]] passam a usar `startFromManager` e esperar o fim pelo `operationUpdated`; sai o teste do `dryRun`; entram testes de que o serviço só expõe o que os cartões usam, de que o pedido de digitação não leva `submit` e de que a interface nunca é criada escondida. 329 testes.

## 2026-11-07 · Monitor de janelas sai do windowController e do windowGuard.ps1

- A pedido do usuário, depois de o login escondido sair do [[signInFlow]]: ninguém mais armava o monitor que escondia a Riot.
- **[[windowController]]:** fica só com `reveal`, `closeClient`, `gameWindow` e `stop`, cada um num PowerShell avulso e um de cada vez. Saem `hide`, `conceal`, `park`, `assertHealthy`, `drainIncidents`, o monitor persistente, a recuperação (`handoff`, `maxRecoveries`, `recoveryWindowMs`, `guardReason`) e a restauração final no `stop`.
- **[[windowGuard]]:** fica só com `reveal` (antes `restore`), `close-client`, `game-window` e `self-test`. Saem o modo `watch`, os ganchos de eventos, as varreduras, o snapshot e a troca de estilos, o worker com prazo, `park`, `hide-auxiliary`, `inspect` e `diagnostics`. A classe C# passa a se chamar `RiotWindowHelper`.
- **[[language]]:** saem "The background window guard has stopped" e o padrão "…stopped (motivo). Try Play again".
- [[ADR-004 Monitor persistente de janelas]] e [[ADR-008 Recuperação visual sem reexibir o Riot]] passam a substituídas pela [[ADR-028 Modo antigo removido]].
- O comportamento do app não muda: o login visível já só trazia a Riot à frente, fechava a janela dela e procurava o jogo.
- Testes: os do controlador passam a cobrir só os pedidos avulsos; o do helper confere que o monitor antigo e as ações de esconder são recusados. 329 testes.

## 2026-11-07 · Login escondido sai do signInFlow

- A pedido do usuário, depois da [[ADR-028 Modo antigo removido]]: o [[main]] já pedia sempre o login visível, então os ramos do login escondido não rodavam.
- **[[signInFlow]]:** saem as opções `hide`, `closeClient`, `releaseAfterLaunch` e `visibleLogin`, o monitor de ocultação (`hide`, `conceal`, `park`, `assertHealthy`, `drainIncidents`), a espera de até 180 s por desafio numa sessão restaurada e o atalho do backend desconectado. O fluxo só usa `reveal`, `gameWindow` e `closeClient` da janela.
- **[[signInService]] e [[main]]:** param de passar essas opções. **[[riotClient]]:** o formulário sempre abre a interface visível. **[[language]]:** sai "Finishing sign-in through the hidden Riot interface…".
- O comportamento do app não muda.
- Testes: os do signInFlow passam a partir do login visível; saem os que só testavam o esconder (park, queda do monitor, espera de 2FA na restauração escondida, troca de conta escondida). 339 testes.
- Fica para depois ([[Backlog]], item 17): o monitor de ocultação no [[windowController]] e no [[windowGuard]], o `visible: false` do [[riotInterface]] e as mensagens em inglês com "Show Riot Client".

## 2026-11-07 · Modo antigo removido

- Item 17 da análise de remendos, a pedido do usuário. A tag local `modo-antigo-final` (`a4fe748`) guarda o último código com o modo antigo.
- **Código removido:** a cópia privada e seu host (`privateClient`, `host/`, `bootstrapChannel`, `bridgeServer`, `status`), os addons, a janela antiga (`src/renderer/index.html`, `app.js`, `styles.css`), a página de sobreposição sem uso (`overlay.*`), `windowsDpapi`, `scripts/integration/`, `scripts/legacy/`, `scripts/dev/preview-riot-integration.js` e os testes deles.
- **Comandos:** `package.json` fica com `start`, `test` e `preview`. O `.bat` inicia o Electron sem `--private-client`.
- **Só leitura na instalação da Riot:** [[asar]] fica só com `openArchive`, e [[backend]] perde `verifyBackend`.
- **API da view de contas menor** ([[managerService]], [[managerHost]], [[manager-preload]]): saem `patchAccount`, `forgetSession`, `copy`, `showRiotClient`, `pickClientPath`, `openDataFolder` e `closeManager`.
- **Opções antigas limpas** ([[store]]): `minimizeOnLaunch`, `hideRiotClient`, `closeRiotClient` e `streamerMode` saem dos padrões e de um `data.json` antigo ao carregar.
- **[[signInService]]:** `begin(id, game)` sem opções; o login visível nunca esconde a Riot e sempre a fecha depois do jogo. Saem `start` e a recusa com jogo aberto, que era do painel antigo; os [[cards]] já confirmam antes.
- **[[riotClient]]:** saem `ensureBackgroundClient`, `showClient` e o export `readAuthenticationState`.
- **[[main]]:** um modo só, sem ponte nem cópia privada. O aviso de falha da bandeja diz que não foi possível abrir as contas no Riot.
- **Prévia:** `npm run preview` abre os cartões; o `mock-api.js` só tem o que eles usam.
- **Vault:** 13 notas foram para `03 Módulos/Removidos/`; nota nova [[ranks]]; ADR-001 e ADR-007 substituídas; guias, arquitetura, [[Backlog]] e [[Glossário]] revistos. O agente `riot-update-checker` saiu.
- `.client-integration/` e um `riot-client-bridge.json` antigo ficam onde estão, sem uso; o usuário pode apagá-los.
- Decisão: [[ADR-028 Modo antigo removido]].

## 2026-11-07 · Saída pela Riot apaga a sessão guardada na hora

- Item 6 da análise de remendos: uma conta que saía pela Riot (ou pelo "Sign Out" do League) só era descoberta no Jogar seguinte, com a Riot fechando, a sessão recusada e a Riot reabrindo.
- O log real da Riot v142 separa os dois casos: a saída manual regrava o login lembrado no arquivo e volta à tela de login com a Riot aberta; o fim do jogo em segundo plano solta a conta sem regravar o arquivo.
- **Percepção da saída** ([[sessionKeeper]]): o guardião anota a conta que a Riot está segurando. Se o arquivo perde o login com a Riot aberta e o serviço local responde sem conta, apaga a sessão guardada dessa conta e avisa o cartão. A olhada nos processos confere de novo se o aviso do arquivo falhar.
- Login em andamento, troca de conta, Riot fechada, outra conta conectada, resposta desconhecida ou sessão guardada diferente nunca apagam nada.
- `authorization()` exportada pelo [[riotClient]].
- O serviço único de estado (item 4) ficou para depois de conferir o canal de eventos da API local; foi para o [[Backlog]].
- Decisão: [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]].
- Testes novos em `test/core/sessionKeeper.test.js`. Falta o teste com a Riot real.

## 2026-11-06 · Riot fechada depois do jogo volta na tela de login

- Relato do usuário: abriu a Riot pela bandeja enquanto o League fechava, viu a conta conectada e a Riot fechou sozinha segundos depois. O log da Riot confirma: com a janela aberta ela não solta a conta, e o [[sessionKeeper]] pediu a saída normal, como manda a [[ADR-020 Riot conectada é encerrada quando fica sem jogo]].
- **Reabertura** ([[sessionKeeper]]): quando a Riot fechada pelo guardião estava com a janela aberta, ele espera ela sair e o login ser guardado e limpo, e a inicia de novo, desconectada, com os cartões. São até 5 olhadas (uns 20 s). Login em andamento, jogo, "Manter login" desligado ou o Eclipse fechando cancelam.
- **`startClient`** ([[riotClient]]): inicia a Riot com a interface só se nenhum processo dela estiver rodando. Nunca pede a janela ao serviço nem usa `taskkill`, diferente de `openClient`.
- Regra nova em [[Segurança e privacidade]]: fora de um login, o Eclipse só inicia a Riot nesse caso.
- Decisão: [[ADR-026 Riot fechada depois do jogo reabre na tela de login]].
- Testes novos em `test/core/sessionKeeper.test.js` e `test/riot/riotClient.test.js`. Falta o teste com a Riot real.

## 2026-11-06 · Gravação atômica, troca de conta sem `DELETE` e saída normal primeiro

- Pedido do usuário: atacar primeiro os "riscos baratos" da análise de remendos (itens 3, 9 e 10), sem mudar nada do que aparece na tela.
- **Arquivo da Riot** ([[riotClient]]):
  - `writeSettingsYaml` grava num temporário `eclipse-<uuid>.tmp` na mesma pasta e troca com `rename`, com o conteúdo já no disco;
  - tenta de novo até 5 vezes com o arquivo em uso e apaga temporários próprios esquecidos;
  - com `expected`, não grava se a Riot mudou o arquivo; o [[sessionKeeper]] usa isso no lugar da releitura separada;
  - a gravação ficou assíncrona, e o [[signInFlow]] espera cada uma antes de subir a Riot;
  - uma falha vira "Could not update the Riot Client settings file", sem caminho;
  - a cópia do último arquivo bom, sugerida na análise, ficou de fora: deixaria mais uma cópia dos tokens em texto puro.
- **`DELETE` de risco** ([[signInFlow]]):
  - sessão restaurada de outra conta: a Riot é fechada com a saída normal, em vez de desconectada no servidor. O novo `onRejected` faz o [[signInService]] apagar a cópia errada antes do fechamento, para o `onClosed` guardar a sessão renovada na dona certa;
  - antes do formulário visível, o `DELETE` "por garantia" saiu. Uma conta que a Riot restaurou sozinha é fechada normalmente e a interface reabre. O `DELETE` só limpa um 2FA ou um erro pendente quando a Riot responde 404 (sem conta);
  - o estado da conta passou a ter três valores (`authorization`: `yes`, `no`, `unknown`), para um erro de leitura nunca contar como "sem conta".
- **Fechamento** ([[riotClient]]): `closeEverything` também pede a saída normal com o estado da conta desconhecido e não espera 10 s se a Riot recusa o pedido. Virou fábrica (`createCloseEverything`) e ganhou testes.
- Correção da análise: os jogos não são fechados "por conta própria". Os [[cards]] e a janela antiga perguntam antes, e o addon recusa com mensagem. Isso não mudou.
- Testes: gravação real numa pasta temporária, estado da conta, fechamento, os dois casos de sessão de outra conta, conta restaurada sozinha, limpeza de login pela metade e `onRejected` no [[signInService]]. Mutações conferidas no fluxo: tirar um `await`, limpar qualquer estado, tirar o `onRejected` ou devolver o `DELETE` derrubam testes. `npm test`: 468 testes, 467 passam e 1 é pulado.
- Ainda não conferido num login real.

## 2026-11-06 · Leitura da caixa "Stay signed in" na Riot v142

- Pedido do usuário: corrigir a leitura da caixa no [[loginForm]] ("Sim, corrija"). Cinco logins visíveis de 2026-11-06 registraram `remember:unknown` no `sign-in.log`.
- Duas causas:
  - as cores eram as da v141 (marcada = escura), e a caixa marcada da v142 é vermelha;
  - a grade de amostras era lida no quadro da janela inteira, que tem 8 px de borda invisível à esquerda, e caía 7 px à esquerda e 4 px abaixo do centro da caixa.
- [[loginForm]]: lê os pixels no quadro da área cliente, o mesmo dos cliques, e reconhece a caixa pelas cores da v142 (cinza → `off`, vermelha → `on`). Painel sem caixa agora dá `unknown`; antes contava como `off` e podia receber o clique.
- Efeito: com "Manter login" ligado, o resultado não muda (a caixa cinza já era marcada). Com ele desligado, a caixa marcada da Riot agora é desmarcada. O log passa a mostrar `remember:on` ou `remember:off`.
- Testes: `test/platform/windows/login.test.js` (novo) roda o `self-test` e confere o quadro da leitura. Conferido também numa réplica do formulário (janela Electron com a mesma borda invisível) em 1280×720 e 1024×576: cinza → `off`, vermelha → `on`, sem caixa → `unknown`, e o formulário reconhecido como pronto. `npm test`: 447 testes, 446 passam e 1 é pulado.
- Ainda não conferido num login real.

## 2026-11-06 · Caixa some junto com o formulário da Riot

- Pedido do usuário: "ainda continua ali a caixa, de um jeito dela sumir apos eu clicar para entrar na conta seja manualmente ou pelo play do eclipse". O teste que mostrou a caixa sozinha foi um login manual, com 2FA; a versão anterior só a escondia durante o Jogar.
- No Riot Client v142 (lido na instalação, sem alterar nada), o clique em entrar troca o formulário inteiro por um carregamento, antes do hCaptcha.
- [[riotWindowObserver]]: a cada 180 ms lê também um quadrado de 7 × 7 px no centro da caixa "Stay signed in" da Riot e manda `formHidden: true` quando ela some depois de ter sido vista.
- [[riotOverlay]]: com `formHidden`, esconde a caixa "Ocultar contas" e tira o retângulo dela da região. Com as contas ocultas, esconde a janela em vez de passar uma região vazia ao Electron, que deixaria a janela pegar os cliques da Riot inteira.
- Decisão: [[ADR-025 Caixa some junto com o formulário da Riot]], que revisa a [[ADR-024 Coluna de login coberta durante o login]] e a [[ADR-013 Caixa para ocultar as contas na coluna de login]].
- Testes: autoteste do helper (classificação da caixa e estado), 2 no [[riotWindowObserver]], 1 no [[riotOverlay]] e casos novos de geometria. `npm test`: 445 testes, 444 passam e 1 é pulado (o do instalador, que não roda com a Riot aberta).
- Ainda não conferido sobre a Riot real.

## 2026-11-06 · Coluna de login coberta durante o login

- Pedido do usuário: enquanto o login roda, tudo na coluna de login da Riot some e fica só um carregamento. A primeira versão deixava a caixa "Ocultar contas" à vista; testando, o usuário pediu que ela também sumisse ("o botao continuou ali... continua aparecendo").
- Conferido pelo usuário no login visível de 18:07 UTC: a coluna ficou coberta, o login digitou e entrou, e o VALORANT abriu. Só a caixa sobrava.
- [[overlayCover]] (novo): uma view sem script na janela da sobreposição, com o fundo do painel da Riot (`#fcfcfc`) e um carregamento vermelho no centro da coluna.
- [[overlayToggle]] ganhou `setVisible`: a caixa some enquanto a coluna está coberta.
- [[riotOverlay]]:
  - cobre a coluna com a operação rodando e sem `needsAttention`;
  - 2FA, CAPTCHA, demora, falha, cancelamento e sucesso descobrem;
  - a região deixa um furo de 11 × 11 DIP no ponto que o [[riotWindowObserver]] lê, para os modais da Riot continuarem escondendo a sobreposição;
  - os cantos da esquerda seguem o arredondado da Riot.
- [[riotWindowObserver]] exporta `PANEL_POINT`; [[paths]] ganhou `OVERLAY_COVER_FILE`.
- Decisão: [[ADR-024 Coluna de login coberta durante o login]], que revisa [[ADR-013 Caixa para ocultar as contas na coluna de login]].
- Testes: 3 do módulo novo (1 com Electron real), 2 no [[riotOverlay]], 1 no [[overlayToggle]] e 1 no [[riotWindowObserver]].
- A caixa escondida e o carregamento no centro ainda não foram conferidos sobre a Riot real.

## 2026-11-06 · Ícone da Riot na bandeja abre no primeiro clique

- Pedido do usuário: depois de jogar, o ícone da Riot na bandeja precisava de dois cliques. O primeiro só fazia o ícone sumir e voltar.
- Causa, pelo log da Riot v142:
  - o login em segundo plano inicia a Riot com `--headless`;
  - depois do jogo ela vai para o segundo plano e, ao voltar, mantém o `--headless`, sem abrir a janela ("We are now in AppFull" sem "launch default product");
  - só o segundo clique ("SystemTrayPlugin Show") abria a janela, e o atalho da área de trabalho também não abria;
  - Riots iniciadas normalmente abriam no primeiro clique.
- [[riotWakeup]] (novo): observa o `lockfile` da Riot. Quando ela volta do segundo plano sem janela, espera 2 s e, sem janela nem jogo, pede `POST /riot-client-lifecycle/v1/show`. Não age durante login, com jogo ou janela aberta, nem quando a Riot entra no segundo plano.
- [[riotClient]]: ganhou `watchLockfile` e `showInterface`, e passou a exportar `sessionState`.
- [[main]]: cria o módulo no modo cartões e o para ao sair.
- Decisão: [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]].
- Testes: 6 do módulo novo e 1 no início do main. `npm test`: 435 testes, 434 passam, 0 falham, 1 pulado.
- Ainda não conferido no Riot real.

## 2026-11-06 · Primeiro login sem reiniciar a Riot

- Pedido do usuário: no primeiro login de outra conta, a Riot reiniciou antes de entrar.
- Causa, pelo `sign-in.log` (15:12 UTC): a conta tinha uma sessão de 2026-11-04, guardada por um fluxo anterior e já sem validade. O Eclipse fechou a Riot para tentar essa sessão, a Riot a recusou em 15 s, e o Eclipse reabriu a Riot para o login visível.
- [[sessionKeeper]]: ao iniciar, apaga as sessões gravadas antes de 2026-11-06 13:00 UTC e avisa o cartão. Essas contas fazem o login visível direto na Riot aberta.
- [[store]]: ganhou `sessionSavedAt(id)`, a data do arquivo da sessão.
- Decisão: [[ADR-022 Sessões de antes do modo cartões são descartadas]].
- Testes: 1 novo no guardião e `sessionSavedAt` no store. `npm test`: 428 testes, 427 passam, 0 falham, 1 pulado.
- Ainda não conferido no Riot real.

## 2026-11-06 · A Riot sempre abre desconectada

- Pedido do usuário: "quero que SEMPRE que eu abrir a riot games eu esteja desconectado de qualquer conta".
- Causa, pelo `sign-in.log` e pelo log da Riot v142:
  - quando o LoL fechou (14:15:46 UTC), a Riot passou ao modo segundo plano em vez de sair, com o login ainda no arquivo;
  - o guardião só limpava com a Riot parada;
  - às 14:16:00 a Riot abriu e restaurou a conta a partir do arquivo;
  - a desconexão às 14:16:17 encerrou a sessão no servidor, e o Jogar seguinte foi recusado.
- [[sessionKeeper]]:
  - limpa o login do arquivo sempre que a Riot não segura uma conta conectada (fechada, em segundo plano ou na tela de login), sem esperar ela sair;
  - limpa também login de conta fora do Eclipse;
  - relê o arquivo antes de limpar e nunca sobrescreve uma gravação mais nova;
  - a olhada de 4 s também agenda a limpeza;
  - a conferência roda 1 s depois da mudança, sem repetições;
  - a mesma falha vai ao log uma vez.
- Decisão: [[ADR-021 Riot sempre abre desconectada]], que revisa [[ADR-019 Sessão salva por conta no modo cartões]] e [[ADR-020 Riot conectada é encerrada quando fica sem jogo]].
- Testes: 19 do guardião (dois novos: Riot soltando a conta e arquivo regravado durante a conferência). `npm test`: 427 testes, 426 passam, 0 falham, 1 pulado.
- Ainda não conferido no Riot real.

## 2026-11-06 · Só o primeiro login de cada conta é visível

- Pedido do usuário: a sessão salva "funcionou apenas uma vez". Só o primeiro login de cada conta deve ser visível; dali em diante, clicar em Jogar deve levar direto ao jogo.
- Causa, pelo `sign-in.log` real: a sessão restaurada entrou duas vezes (13:54:36 e 13:56:05 UTC) e foi recusada às 13:57:40. No meio, a Riot ficou aberta e conectada, e sair da conta pela Riot para ver os cartões encerrou a sessão no servidor. Além disso, o `refresh_token` é de uso único, e a cópia guardada só era atualizada quando a Riot saía.
- [[sessionKeeper]]: guarda cada versão nova do login de uma conta conhecida, mesmo com a Riot aberta, e só limpa o arquivo depois que ela sai. A cada 4 s olha os processos e pede à Riot a saída normal quando ela está conectada e um jogo fechou, ou quando ficou sem janela e sem jogo (duas olhadas seguidas). Ganhou `keep(yaml)`.
- [[signInFlow]]: depois de restaurar, só captura um YAML diferente do que escreveu. O login visível com outra conta conectada fecha a Riot com a saída normal, guarda a sessão de quem sai e não faz mais `DELETE` com ela autorizada.
- [[main]]: `saveLeavingSession` usa primeiro o `keep` do guardião, para a sessão de quem sai ir para a dona provada.
- [[riotClient]]: passou a exportar `isAuthorized` e `quitClient`.
- Decisão: [[ADR-020 Riot conectada é encerrada quando fica sem jogo]], que complementa [[ADR-019 Sessão salva por conta no modo cartões]].
- Testes: 19 do guardião (reescritos, com relógios separados para a conferência e a olhada nos processos), 2 novos no fluxo e o `keep` no início do main. `npm test`: 427 testes, 426 passam, 0 falham.
- Ainda não conferido no Riot real.

## 2026-11-06 · Jogar com sessão salva em segundo plano

- Pedido do usuário: escolher a conta e clicar em Jogar sem precisar da Riot nem do Eclipse em primeiro plano. Com "Manter login", a Riot não pode abrir já conectada, para os cartões continuarem aparecendo.
- [[signInFlow]]: no modo cartões, uma conta com sessão guardada e "Manter login" ligado entra em segundo plano. O fluxo fecha a Riot, grava o YAML da conta, sobe só os serviços e confere o Riot ID. Sessão recusada ou de outra conta cai no login visível. Em `riot`, a interface abre depois da restauração.
- [[sessionKeeper]] (novo): quando a Riot sai, guarda o login lembrado na conta dona dele e o tira do arquivo da Riot. A dona é a conta com o mesmo `sub` numa sessão guardada ou, sem ela, a única com o mesmo Riot ID. Sem dona comprovada, não mexe. Não age com login em andamento, com a Riot aberta ou com "Manter login" desligado.
- [[riotClient]]: ganhou `persistedSubject`, `persistedRiotId`, `watchSettings` e `clientRunning`, e passou a exportar `readSettingsYaml` e `writeSettingsYaml`. Ganhou também o primeiro teste do módulo (`test/riot/riotClient.test.js`).
- [[main]]: cria o guardião no modo cartões, confere de novo ao fim de cada operação e o para ao sair.
- [[cards]]: a ajuda do "Manter login" descreve o novo comportamento.
- Decisão: [[ADR-019 Sessão salva por conta no modo cartões]], que revisa [[ADR-010 Login visível com progresso]].
- Testes: 6 novos no fluxo, 13 do guardião, 5 do `riotClient` e 2 no início do main.
- Teste real, primeira rodada (13:47 a 13:48 UTC): a sessão foi guardada, mas a Riot v141 não grava o cookie `sub`, e o guardião deixou o login no arquivo. A Riot reabriu conectada. A identidade passou a vir do `id_token` (`sub` e `acct`), conferida no arquivo real em memória.
- Teste real, segunda rodada (13:53 a 13:54 UTC), confirmado pelo usuário: a sessão antiga foi recusada em 15 s e caiu no login visível. Ao sair da Riot, o guardião guardou a sessão nova e limpou o arquivo. O Jogar seguinte entrou em segundo plano, sem digitar, e a Riot autorizou em 0,5 s.

## 2026-11-06 · Cartões sem sombra, perfil da Riot só com as contas ocultas e adicionar no rodapé

- Pedido do usuário: tirar a sombra em volta dos cartões, tirar o botão de perfil da Riot (o real aparece só ao ocultar as contas), diminuir o ícone do League no rodapé e levar o adicionar conta para a área do rodapé.
- [[cards]]: caixa e banner do League sem sombra nem brilho no fundo. Ícone do League com 24 px (os outros têm 28). Adicionar virou o botão + no início do rodapé; o cartão tracejado saiu. Contador em duas linhas e rodapé mais justo até 800 px, para tudo caber na Riot de 1024 × 576.
- Cópia do perfil removida: `#riot-profile` nos [[cards]], `revealRiot` no [[manager-preload]] e a ação `reveal` no [[managerHost]] e no [[riotOverlay]]. Revisão anotada na [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]].
- Testes: o Electron confere a caixa sem sombra externa, ícones de 28, 24 e 28 px, o + abrindo o cadastro, nenhuma cópia do perfil e só `minimize` e `close`; host, preload e sobreposição recusam `reveal`.

## 2026-11-06 · Fundo branco de volta, sem o desfoque

- Pedido do usuário: "pode reverter e colocar o fundo branco novamente e retirar o blur". Todo o código da [[ADR-018 Arte da Riot desfocada atrás dos cartões]] saiu: comando `backdrop` e cópia por `PrintWindow` no [[riotWindowObserver]], pedido no [[riotOverlay]], canal no [[managerHost]] e no [[manager-preload]], canvas nos [[cards]] e `backdrop.js` no [[renderer]]. A ADR fica como revertida, com o que foi testado.
- O fundo volta a ser `#f2f2f2` e a [[Segurança e privacidade]] volta a uma só leitura visual (o quadrado da [[ADR-017 Cartões cedem a vez aos avisos da Riot]]).
- O League espaçoso e o banner solto ficaram.

## 2026-11-05 · League mais espaçoso e banner solto

- Pedido do usuário: o cartão do League menos compacto e, depois, o banner solto, com a caixa só na área do texto.
- [[cards]]: League com coluna de 420 px, banner e ícone maiores, filete dourado e consultas de contêiner para janelas menores. A caixa (fundo, borda, sombra, filete e seleção) fica só na área do texto; o banner fica solto ao lado dela.

## 2026-11-05 · Cartões no visual do League e do VALORANT

- Pedido do usuário: no lugar das caixas, o banner e o ícone reais do League, na estética do jogo, e o mesmo com o VALORANT. Protótipo montado direto nos [[cards]], com os dados que o Eclipse já guarda.
- League: banner vertical (o escolhido em `stats.lol.banner` ou o banner ranqueado do melhor elo, padrão do cliente), ícone de perfil num círculo dourado, nível numa placa, Cinzel e a paleta azul e dourada do cliente.
- VALORANT: arte larga do cartão de jogador salvo (ou o cartão padrão), nome em Teko, selo de nível, barra de RR e a variação da última partida, moldura vermelha e canto cortado.
- [[renderer]]: `lolBanner` e `valCardArt` em `ranks.js`, montando as URLs só a partir de nome ou UUID. Texto novo `lastMatch`. Grade com colunas de 350 px. O fundo claro continua.
- Testes novos de `lolBanner`, `valCardArt` e `lastMatch`. Conferido na prévia; falta ver no app com as contas reais e ler o banner escolhido (Backlog).

## 2026-11-05 · Cartões cedem a vez aos avisos da Riot

- Pedido do usuário: o aviso "Você ainda está aí?", que a Riot mostra depois de muito tempo parada no login, ficava atrás dos cartões. A Riot deve ter prioridade. Decisão em [[ADR-017 Cartões cedem a vez aos avisos da Riot]].
- Causa, conferida na cópia da interface da Riot (só leitura): o aviso é um modal da página (`AFKModal`), aberto por um cronômetro de 20 min (2 min com uma opção da Riot) contado da criação da sessão de login. O estado de login que o Eclipse consulta não muda.
- [[riotWindowObserver]]: a cada leitura, o helper confere a cor de um quadrado de 7 × 7 px na coluna de login (ponto `PANEL`), só com a Riot à vista ali, e manda `dimmed:true` quando o fundo escuro dos modais da Riot está na tela.
- [[riotOverlay]]: com `dimmed`, esconde cartões e caixa sem zerar a sessão; volta quando o modal fecha.
- Testes novos: autoteste do helper com a classificação e o estado, `dimmed` no `validTarget` e a sobreposição escondendo e voltando. Conferido com o helper real e uma Riot falsa em Electron (97 ms para esconder, 221 ms para voltar). Não foi conferido com o aviso real da Riot.

## 2026-11-05 · Riot ID renomeado e cortes de Grão-Mestre e Desafiante

- Pedido do usuário, depois de trocar para a chave pessoal da Riot: seguir contas renomeadas e mostrar quantos PdL faltam para Grão-Mestre ou Desafiante.
- [[rankApi]]: virou fábrica (`createRankApi`) com rede e relógio injetáveis. Com o PUUID em cache, cada atualização confere o nome por `account-v1 /accounts/by-puuid` e devolve o Riot ID novo quando mudou. Em Mestre+, baixa as listas de Desafiante, Grão-Mestre e Mestre da fila e da região (cache de 10 min) e grava os cortes estimados na entrada.
- [[cards]]: linha com o brasão do tier alvo e "faltam N PdL", "acima do corte" ou a margem do Desafiante, com o corte no `title`. [[renderer]]: `climbOf` e `rankOf(...).climb`.
- Corrigido junto: o nome devolvido pela Riot agora chega à conta também quando o LoL falha depois de achar o PUUID ou quando só há chave de TFT.
- Testes novos: `test/core/rankApi.test.js`, `test/renderer/ranks.test.js`, `test/renderer/cardsText.test.js` e a linha do corte no teste Electron dos cartões. Não foi conferido com a API real.

## 2026-11-04 · Cartões aparecem de uma vez ao restaurar a Riot

- Pedido do usuário: depois de minimizar, ao abrir a Riot de novo a arte aparecia por menos de 1 s antes dos cartões; por Alt+Tab, não. Revisão em [[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]].
- Causa medida com uma janela de teste e leitura do pixel na tela: numa janela Electron transparente, o Chromium faz a janela surgir aos poucos, em cerca de 200 ms, a cada `show`.
- [[main]]: o modo sobreposto liga `wm-window-animations-disabled`; a janela aparece no primeiro quadro e a região continua recortando.
- Primeira tentativa, desfeita no mesmo dia: janela opaca. Aparecia no primeiro quadro, mas o Electron ignora a região ao pintar janela opaca e a coluna de login ficou preta na Riot real.
- Não foi conferido com a Riot real.

## 2026-11-04 · Sem arte ao minimizar e pontas no formato da Riot

- Pedido do usuário: ver a arte da Riot só ao ocultar as contas (ela aparecia rapidamente ao minimizar) e manter o fundo novo dentro da janela da Riot. Decisão em [[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]].
- [[riotWindowObserver]]: o helper desliga a animação de minimizar da janela da Riot enquanto a acompanha e a devolve ao trocar de janela, ao fechar a entrada ou ao fim do processo dono. `stop` agora fecha a entrada e só mata o helper depois de 1 s. Cada retrato leva `corner`, o raio dos cantos da janela.
- [[riotOverlay]]: a região tira das pontas direitas o arredondado da Riot (4, 3, 2 e 1 px a 100%). Causa medida na Riot aberta, só leitura: cantos `DWMWCP_ROUND`; a sobreposição tinha cantos retos.
- Descartado: o helper mostrar os cartões ao restaurar. Testado com Electron, a janela mostrada por fora não volta a desenhar.
- Testes novos: autoteste do helper com a animação e o raio, helper real saindo sozinho ao fechar a entrada, `corner` validado, parada em duas etapas, recorte das pontas sem passar do arredondado e região refeita quando o raio muda. Não foi conferido com a Riot real.

## 2026-11-04 · Fundo branco no lugar da arte do Riot

- Pedido do usuário: tirar a arte da Riot do fundo dos cartões e usar um branco um pouco mais suave que o da Riot. Revisão em [[ADR-011 Cartões sobre a arte do Riot]].
- [[cards]]: `html` e `body` com `#f2f2f2` (a coluna de login da Riot é `#fcfcfc`). As cópias de minimizar e fechar passaram para traço `#636363` sem sombra; o fechar fica com traço branco sobre o vermelho ao passar o mouse.
- [[riotOverlay]]: a view dos cartões abre com o mesmo `#f2f2f2`, sem mostrar a arte durante o carregamento.
- Com o fundo opaco, os controles nativos não aparecem mais por baixo das cópias. Com as contas ocultas, a arte da Riot volta.
- Teste do [[riotWindowObserver]]: o autoteste de ordem das janelas falhava às vezes com a suíte inteira rodando, por janelas de outros testes entrando no meio. Agora tenta até 3 vezes.

## 2026-11-04 · Cartões na arte inteira, com cópias dos controles do Riot

- Pedido do usuário: usar toda a área do Riot Client menos a coluna de login, sem perder minimizar, fechar e o botão do perfil, que ficariam embaixo da janela do Eclipse. O recorte antigo foi achado estranho. Decisão em [[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]].
- [[riotOverlay]]: a região normal passou a ser a caixa mais a arte inteira. A região própria de diálogo e o aviso `setModal` saíram.
- [[cards]]: cópias em SVG de minimizar, fechar e perfil nas posições da Riot, em unidades de `100vw / 1136`, comparadas pixel a pixel com a captura do usuário. A lista usa a largura toda; avisos ainda deixam espaço para o perfil.
- Minimizar: comando `minimize` ao helper do [[riotWindowObserver]], que agora mantém o stdin aberto e só age na janela oficial já conferida.
- Fechar: módulo novo [[riotAppControls]] repete a escolha do X da Riot (segundo plano ou sair) pelo serviço local; ao sair, ou se o serviço falhar, o helper fecha a janela.
- Perfil: oculta as contas e marca a caixa ([[overlayToggle]] ganhou `setHidden`), deixando o botão real da Riot livre. Escolha do usuário.
- [[managerHost]] e [[manager-preload]]: `windowAction` com `minimize`, `close` ou `reveal` no lugar de `setModal`.
- Testes novos: helper real recebendo comandos sem tocar janelas, autoteste minimizando e fechando janelas de teste, decisão de fechamento, ações na sobreposição, caixa marcada pelo main e cópias no teste Electron dos cartões. Não foi conferido com a Riot real aberta.
- Limites: a faixa de arrastar da Riot no topo da arte fica coberta, e traço e X aparecem um pouco mais marcados porque os nativos continuam por baixo da página transparente.

## 2026-11-04 · Eclipse em português e inglês

- Pedido do usuário: escolher entre inglês e português nas Configurações, com o Eclipse todo nas duas línguas e português como padrão. Decisão em [[ADR-014 Interface em português e inglês]].
- [[store]] guarda `language` (padrão `pt`); [[managerService]] aceita só `pt` ou `en` e avisa o [[main]] ao salvar.
- Módulo novo [[language]]: catálogo inglês/português das mensagens do login e do main, e textos da bandeja e dos diálogos. [[signInService]] traduz só o que publica (opção `translate`); o `sign-in.log` continua em inglês.
- [[main]]: bandeja, balões e caixas de erro no idioma salvo; o menu da bandeja muda na hora.
- [[cards]]: seletor de idioma no topo das Configurações e todos os textos em `cardsText.js`, inclusive elos (em inglês, nomes da Riot, LP e W/L; em português, VALORANT agora traduzido).
- [[overlayToggle]] e [[riotOverlay]]: "Ocultar contas" vira "Hide accounts" em inglês.
- Fora do escopo: renderer legado do modo privado, textos injetados na cópia privada da Riot e scripts `.bat`.
- Testes novos no catálogo, no store, nos serviços, no main, na caixa e no teste Electron dos cartões. Não foi conferido com a Riot aberta.

## 2026-11-04 · Ícone da Riot para só entrar na conta

- Pedido do usuário: um ícone da Riot à esquerda do League; com ele selecionado, o botão principal entra na conta escolhida e deixa o Riot Client aberto, sem abrir jogo.
- [[signInFlow]] aceita `riot`: faz o login e a conferência do Riot ID de sempre, guarda a sessão, mostra o cliente e para. [[signInService]] e [[managerService]] aceitam `riot`; o sucesso é `clientOpened`, sem marcar jogo jogado.
- [[cards]]: ícone `riot.png`, tema vermelho da Riot, botão "Entrar" e cartões com os elos do último jogo escolhido.
- Testes novos no fluxo, nos serviços e no teste Electron dos cartões. Não foi exercitado com contas reais.

## 2026-11-04 · O app passa a se chamar Eclipse

- Pedido do usuário: o projeto agora se chama Eclipse, com a imagem enviada como ícone. A dica da bandeja e os títulos de avisos, erros e balões dizem "Eclipse" ([[main]]).
- Ícone novo em `src/renderer/assets/icon.png` e `icon.ico` (fundo branco removido); a bandeja usa o `.ico` ([[paths]]).
- O `name` do `package.json`, a pasta do projeto e a pasta de dados continuam `riot-account-manager`, para não perder as contas salvas.

## 2026-11-04 · Caixa "Ocultar contas" com o visual da Riot

- O usuário pediu a caixa mais parecida com a original em tamanho, arredondamento e cor. [[overlayToggle]] agora usa os valores do CSS da tela de login da Riot (quadrado de 16 px, cantos de 20%, cinza translúcido, vermelho `#d53235` com o mesmo visto, Inter de 14 px) e ajusta peso e espaçamento do texto até a largura e a altura baterem com o "Stay signed in" numa captura.

## 2026-11-04 · Caixa "Ocultar contas" ao lado do "Stay signed in"

- Pedido do usuário: uma cópia da caixa "Stay signed in" da Riot, à direita dela, que esconde o gerenciador inteiro quando marcada e o traz de volta quando desmarcada. Começa sempre desmarcada.
- [[ADR-013 Caixa para ocultar as contas na coluna de login]]: a janela da sobreposição passa a cobrir toda a área da Riot; os cartões ficam no mesmo lugar por um recuo à esquerda no [[managerHost]], e a caixa é uma segunda visualização ([[overlayToggle]]). Na coluna de login, só o retângulo da caixa pinta e recebe cliques.
- Marcar tira os cartões da região de pintura e de cliques do [[riotOverlay]]; o estado fica só na memória.
- Posição medida numa captura da tela de login do Riot Client v142 em 1536×864. Testes novos: geometria em seis tamanhos, IPC só com booleano e um teste com Electron real que clica na caixa.

## 2026-11-04 · Fundo dos diálogos cobre a janela inteira

- O fundo escurecido de Configurações e dos outros diálogos parava antes da faixa da direita, onde ficam os controles da Riot, porque a janela dos cartões não pinta nem captura cliques ali.
- [[cards]] avisa por `setModal` quando um diálogo abre ou fecha; o [[managerHost]] trata o aviso localmente e o [[riotOverlay]] troca a região pela janela inteira enquanto o diálogo está aberto. Com um diálogo aberto, os botões da Riot naquela faixa ficam cobertos.
- Testes novos no host, no preload, na sobreposição e no teste Electron real.

## 2026-11-04 · Ícones de jogo fixos e atualizar só pelo ícone

- Em [[cards]], a conta selecionada no rodapé tem largura fixa e corta o texto com reticências; os ícones do League e do VALORANT não mudam mais de lugar quando o nome do jogo ou da conta muda de tamanho.
- O botão de atualizar é só o ícone ↻; "N contas · atualizado há X" virou texto ao lado, sem clique nem seleção.
- O teste Electron confere a posição dos ícones ao trocar de jogo e de conta e que o contador fica fora do botão.

## 2026-11-04 · Cartões desenhados ao restaurar a Riot

- Com a Riot minimizada, abrir o gerenciador e restaurar a Riot não mostrava os cartões, só depois de minimizar e restaurar de novo. O registro de janelas mostrou os cartões visíveis e na frente da Riot, mas a tela tinha a arte da Riot no lugar deles: os cartões apareceram primeiro atrás da Riot, o Chromium os marcou como cobertos e não voltou a desenhá-los depois de virem para a frente.
- O [[main]] desliga a detecção de oclusão do Chromium no modo sobreposto. Com uma Riot falsa em outro processo, a página dos cartões ficou `hidden` por mais de 3 s com a detecção ligada e `visible` com ela desligada.
- Teste novo no início do app. A correção da entrada anterior (trazer os cartões para a frente) continua, mas sozinha não resolvia este caso.

## 2026-11-04 · Cartões aparecem na primeira abertura da Riot

- Com o gerenciador aberto antes da Riot, os cartões não apareciam na primeira abertura; só depois de minimizar e restaurar. (Leitura revista: o caso relatado era a Riot minimizada, não fechada; ver a entrada seguinte, mais nova.) A Riot abre primeiro uma janela pequena e depois a principal; os cartões ficavam presos à pequena e, ao passar para a principal, continuavam atrás dela.
- O [[riotWindowObserver]] agora coloca os cartões logo acima da Riot sempre que eles estão visíveis e abaixo dela. Conferido com uma Riot falsa em Electron que abre do mesmo jeito.
- Autoteste novo no helper do observador, rodado pela suíte; ele falha sem a correção.

## 2026-11-04 · Cartões voltam junto com a Riot

- Ao restaurar a Riot minimizada, os cartões demoravam até perto de 1 s para voltar. A janela minimizada virava "sem janela", a sessão era zerada e os cartões esperavam a próxima leitura e uma nova consulta do login.
- Agora o [[riotWindowObserver]] mantém a janela minimizada como escolhida e a marca `minimized:true`, e a [[riotOverlay]] não esconde nem mostra nada nesse estado. O Windows traz os cartões de volta junto com a Riot. Teste com Electron e janela de teste: 34 ms entre o pedido de restaurar e os cartões pintados na tela.
- Testes novos para a janela minimizada na sobreposição e no observador; o da sobreposição falha sem a correção.
- Correção posterior no mesmo dia: a primeira versão não escondia os cartões com a Riot minimizada e deixava o Windows trazê-los de volta. Com a Riot real, a janela da Riot voltava sozinha logo depois de minimizar, sem desenhar nada, e os cartões ficavam sozinhos sobre a área de trabalho (também ao reabrir o gerenciador). Agora a [[riotOverlay]] esconde os cartões com a Riot minimizada, mantém a sessão e os mostra no primeiro retrato restaurado. Com uma Riot falsa em Electron, os cartões voltaram 15 ms depois da Riot, e ela continuou minimizada.

## 2026-11-04 · Cartões presos à janela do Riot

- Os cartões não somem mais ao trocar de programa: a janela da Riot passou a ser dona da sobreposição. O Windows mantém os cartões logo acima da Riot, cobertos por outros programas quando eles estão na frente, e esconde os dois juntos ao minimizar. A sobreposição deixou de ser "sempre no topo". Decisão: [[ADR-012 Sobreposição presa à janela do Riot]].
- Ao arrastar a Riot, os cartões seguem por evento do Windows (`EVENT_OBJECT_LOCATIONCHANGE`), não mais pela leitura a cada 180 ms. Com janelas de teste, cada movimento chegou ao gerenciador em 0 a 12 ms. A região de cliques só é recalculada quando o tamanho muda.
- [[riotWindowObserver]]: helper reescrito com laço de mensagens; recebe o identificador da sobreposição, confere que ela é do gerenciador e define o dono; o campo `active` saiu. [[riotOverlay]]: sem `alwaysOnTop`, sem `moveTop`, sem depender do foco.
- Testes da sobreposição e do observador ampliados (um deles achou um número aceito como identificador; corrigido para exigir texto). 340 passam. Falta conferir no Riot real; ver [[Backlog]].

## 2026-11-04 · Jogo desatualizado abre depois da atualização

- Quando o pedido de abertura volta HTTP 424 `launch_failed_product_not_up_to_date`, o [[signInFlow]] agora mostra "aguardando a atualização", repete o pedido a cada 15 s e espera até 20 min. Antes, esperava 180 s e falhava mesmo com a atualização terminada (login real de 2026-11-04 12:36).
- Depois de um pedido aceito, o prazo de 180 s e o aviso de demora contam a partir dele. Outras recusas continuam com um único pedido.
- [[riotClient]]: `requestLaunch` devolve `{ status, errorCode }`.
- 4 testes novos no fluxo; os três do comportamento novo falham sem a correção. 339 passam. Ainda não exercitado no Riot real. Ver [[Backlog]].
- Limpeza: removidos itens duplicados nas notas [[signInFlow]] e [[riotClient]].

## 2026-11-04 · Sem aviso falso de verificação

- Logo depois que o formulário nativo envia a senha, a Riot passa alguns segundos numa checagem automática. O [[signInFlow]] tratava isso como verificação pendente e mostrava "Conclua a verificação" e o balão "O login precisa de sua atenção" em quase todo login, 2 a 3 s antes de a conta entrar (logs reais de 2026-11-02 e 2026-11-04). Agora há tolerância de 12 s para essa checagem; se ela continuar, o aviso aparece como antes. 2FA continua imediato.
- 2 testes novos: checagem curta sem aviso; checagem longa avisa depois da tolerância e revela a janela. O primeiro falha sem a correção. 335 passam.
- Validado no Riot real em 2026-11-04 (horário local): nos logins das 12:36 e das 12:38, já com o código novo, não houve nenhum "Riot needs a security check"; a conta entrou 2 a 3 s depois do envio da senha. No das 12:38, com "Manter login" desmarcado, o log registrou `remember:off` e "stay signed in is off; no session was kept", e o jogo abriu às 12:38:55. O login das 12:36 parou porque o League precisava de atualização (HTTP 424 `launch_failed_product_not_up_to_date`) e foi interrompido ao reiniciar o app. Ver [[Backlog]].

## 2026-11-04 · Cancelar no botão, gerenciador some ao entrar e "Manter login"

- Durante o login, o botão Jogar vira **Cancelar**. Saiu a faixa "Entrando na conta e preparando seu jogo…"; ela só aparece quando a Riot pede verificação.
- O gerenciador some assim que a conta entra, sem esperar o jogo: o fluxo marca os status seguintes com `signedIn` e o [[riotOverlay]] se esconde. A leitura da tela de login também passou a conferir `/rso-auth/v1/authorization`, para não mostrar os cartões sobre a página inicial do Riot.
- Nova opção **Manter login** nas configurações (marcada por padrão). Desmarcada: login direto e formulário nativo enviam `remember: false`, o [[loginForm]] desmarca "Stay signed in" quando reconhece a caixa, e o app não restaura nem grava sessões.
- 6 testes novos ou ampliados (autenticação, fluxo, serviço, sobreposição, configurações, armazenamento e Electron); 333 passam. Conferido no `npm run preview`.
- Teste real em 2026-11-04 12:29 (horário local), app reiniciado às 12:29:37 com o código novo e "Manter login" no padrão (ligado): formulário nativo preenchido em 7 s, conta autorizada em 11 s ("Signed in" às 12:29:58), cliente do League às 12:30:10, sessão guardada e "Game opened" às 12:30:22. O log não registra quando os cartões somem; isso depende da observação do usuário. A caixa "Stay signed in" saiu como `remember:unknown`, como nos testes anteriores: com "Manter login" desmarcado, o [[loginForm]] não conseguiria desmarcá-la. Ver [[Backlog]].

## 2026-11-04 · Cartão sem avatar de iniciais

- Removido o círculo com as iniciais à esquerda do Riot ID; o cabeçalho do cartão mostra só nome, tag e nível. Teste do Electron verifica a ausência do avatar. Conferido no `npm run preview`.

## 2026-11-04 · Rodapé com o jogo escolhido

- Ícones do League e do VALORANT foram para o rodapé, à esquerda da conta selecionada; a barra superior deixou de existir e a lista sobe para 24 px do topo.
- Tema por jogo em `body[data-theme]`: League com destaques dourados e Jogar azul-escuro com borda dourada; VALORANT com destaques vermelhos e Jogar vermelho de canto cortado. A cor do jogo vai para a borda do cartão selecionado, a linha no topo do rodapé, o ícone ativo, o foco, o progresso e os botões dos diálogos.
- Teste do Electron verifica a ausência da barra, a posição dos ícones e a troca de tema. Conferido no `npm run preview` em 1130 e 600 px; não conferido ainda na janela real do Riot.

## 2026-11-04 · Ícones de jogo na barra superior

- "League of Legends" e "VALORANT" na barra superior viraram ícones de 28 px (`assets/lol.png`, extraído do `.ico` enviado, e `assets/valorant.png`). O nome continua em `aria-label` e na dica do mouse. O jogo ativo fica colorido com sublinhado vermelho; o outro fica cinza.
- Teste do Electron verifica que os botões de jogo têm nome acessível, imagem carregada e nenhum texto visível. Conferido no `npm run preview`; não conferido ainda na janela real do Riot.

## 2026-11-04 · Solo/Duo e Flex no mesmo cartão

- Cartão do League mostra as duas filas lado a lado, cada uma com emblema, elo, PdL e "winrate · VitóriasV DerrotasD"; VALORANT mostra só Competitivo. Removido o seletor de fila da barra superior, que agora tem só os jogos.
- Teste do Electron verifica as duas colunas, a fila sem partidas como "Sem classificação" e a ausência do seletor. Conferido no `npm run preview` em 1130 e 600 px; não conferido ainda na janela real do Riot.

## 2026-11-04 · Ações onde são usadas

- Canto superior direito livre para o perfil e os controles do Riot: a barra superior ficou com jogo e fila numa linha só, na largura do conteúdo. Antes, `+ Conta`, atualizar e configurações encostavam no círculo do perfil do Riot e pareciam uma fileira de quatro controles.
- Adicionar virou o cartão tracejado "Adicionar conta" no fim da grade. Configurações e o botão "N contas · atualizado há X" (que atualiza as estatísticas) foram para a esquerda do rodapé. O rodapé mostra só a conta e a região, sem o rótulo "CONTA SELECIONADA".
- Teste do Electron verifica que a barra superior só tem os jogos, que o rodapé tem as ações e que o cartão abre o diálogo de cadastro. `npm run preview` passa a servir `src/renderer/cards.html` com dados fictícios. Não conferido ainda na janela real do Riot.

## 2026-11-04 · Acabamento da borda superior

- Captura da janela real mostrou a caixa encostada sobre a linha externa superior. Adicionado recuo de 2 px apenas na barra superior, preservando largura e rodapé. Teste de limites atualizado; alteração ainda depende de recarregar o gerenciador em execução.

## 2026-11-04 · Caixa superior sem contorno

- Removida a borda cinza visível da barra superior, preservando dimensões, fundo e alinhamento.

## 2026-11-04 · Encaixe nas bordas do Riot

- Barra superior no topo da área cliente, com largura preservada pela reserva dos controles nativos. Rodapé de 104 DIP estendido até as bordas inferior e direita da arte.
- Observador mede a área cliente em coordenadas de tela, excluindo bordas invisíveis do Windows. Região nativa une coluna principal e rodapé, deixando perfil/minimizar/fechar fora dos cliques do painel.
- Testes verificam limites, região dos controles e correspondência entre CSS e geometria no Electron; validação isolada usa dados fictícios.

## 2026-11-04 · Organização baseada no rascunho

- Barra única com jogos à esquerda, adicionar/atualizar/configurações à direita e fila na segunda linha. Removido o espaço separado que antes abrigava somente as ações.
- Cartões compactos de até 330 px em duas colunas à esquerda, com mais espaço entre eles e a barra, revelando mais da arte. Mantidas estatísticas, edição, seleção e ação Jogar no rodapé, com adaptação para janelas menores.
- Cor `#fcfcfc`, fundo geral transparente e reservas nativas de login/perfil/controles preservados.

## 2026-11-04 · Cor da superfície de login

- Cartões, caixa dos seletores e rodapé usam `#fcfcfc`, amostrado do anexo do usuário. Superfícies opacas preservam a cor sobre a arte; conta selecionada usa a mesma cor com borda vermelha. Fundo geral continua transparente.

## 2026-11-04 · Caixa dos seletores

- Seleção de League/VALORANT e Solo/Duo/Flex recebe caixa clara com borda e cantos no estilo das contas, melhorando a leitura sobre a arte. Fundo geral e limites da sobreposição mantidos.

## 2026-11-04 · Painel sem fundo geral e sem textos introdutórios

- Removidos título, subtítulo e aviso geral de estatísticas. Botões do cabeçalho preservados à direita.
- Fundo geral totalmente transparente, mantendo cartões, rodapé, alinhamento da janela e áreas nativas livres.

## 2026-11-04 · Transparência e espaço dos controles nativos

- Fundo do painel translúcido para revelar a arte original, com cartões claros legíveis. Painel elevado para uma margem superior de 24 DIP e rodapé recuado 24 DIP da borda inferior.
- Preservada toda a faixa vertical direita de perfil, minimizar e fechar, além da coluna de login à esquerda. Sem recortes individuais nem reprodução dos controles nativos.
- Geometria e transparência cobertas pelos testes existentes; conferência isolada de layout usa dados fictícios. A interação dos menus nativos sobre a janela real continua pendente de validação ao vivo.

## 2026-11-03 · Validação do painel branco

- Conferidos seleção, lançamento simulado, conta sem senha, cancelamento e confirmação de remoção, configurações e larguras reduzidas com dados fictícios. Nenhum login real executado.
- Os 328 testes passaram em sequência. A execução simultânea apresentou falhas intermitentes na abertura da interface legada e no teste de prazo do monitor de janelas; a validação sequencial não resolve essa instabilidade dos testes.
- A conferência visual da sobreposição e dos menus nativos no Riot permanece pendente.

## 2026-11-02 · Painel branco no cliente oficial

- Aplicada a direção visual clara aprovada: cartões brancos, textos escuros, seleção vermelha e botão único Jogar no rodapé. League e VALORANT são as opções visíveis; TFT permanece apenas no suporte legado.
- Cadastro, edição, remoção, atualização, chaves de API, progresso e cancelamento permanecem integrados. Aviso de estatísticas agrupado, seleção acessível por teclado e ação desabilitada para conta sem senha.
- Removidos os recortes de janela: uma faixa contínua da arte e dos controles nativos fica acima do painel, com transição para o branco. Mantida a regra de ocultar após login manual ou gerenciado.
- Suíte completa e conferência isolada com dados fictícios; nenhuma autenticação real. Alinhamento e menus sobre o Riot em execução ainda dependem de validação visual ao vivo.

## 2026-11-02 · Contas somente na tela de login

- O painel acompanha o estado local de autenticação: desaparece após login por conta salva, entrada manual ou sessão lembrada; volta ao retornar ao login. Ocultar a interface mantém a operação de lançamento em andamento.
- Consultas somente de leitura a cada 750 ms, sem sobreposição, com cancelamento e descarte de respostas de janelas antigas. Estados desconhecidos, desafios e falhas deixam a interface nativa livre.
- Testes simulam login manual e gerenciado, logout, MFA, indisponibilidade, consulta lenta, troca de janela e encerramento. Validação visual ao vivo não realizada nesta revisão; a pendência de exibição da revisão anterior permanece.

## 2026-10-28 · Contorno individual dos controles do Riot

- Removido o recorte quadrado do canto superior: perfil, minimizar e fechar recebem recortes circulares separados; o fundo das contas preenche os intervalos.
- Mantidos os controles nativos e o clique direto no Riot. O contorno respeita os limites da janela e as coordenadas em DIP.
- 326 testes: 325 passaram e um teste legado foi pulado com Riot aberto. Novas verificações cobrem os intervalos preenchidos, círculos e dimensões pequenas.

## 2026-10-28 · Área inteira da arte coberta

- A tela de contas ocupa toda a área direita a partir da divisão medida 400/1536, sem margens e com fundo sólido. A coluna de login permanece livre.
- Recorte nativo no canto superior direito preserva minimizar, fechar e perfil, incluindo entrada de mouse. Barra de ações reserva a mesma área.
- 325 testes: 324 passaram e um legado foi pulado com Riot aberto. Cobertura de geometria, recorte dos três controles e renderização opaca no Electron.

## 2026-10-28 · Cartões de contas sobre a arte

- Substituída a interface completa do modo sobreposto por [[cards]]: nome, nível, rank, winrate, vitórias, derrotas e Entrar e jogar. Superfícies escuras translúcidas, bordas douradas e ações em azul seguem a aparência do cliente.
- Janela e view transparentes ocupam somente os 70% direitos, com margens para preservar login e controles nativos. Cartões aparecem automaticamente e rolam dentro da arte; não há mais botão para abrir um dashboard.
- Cadastro, edição e configurações essenciais ficam em diálogos compactos. Preload e serviço de credenciais são reaproveitados; dados ausentes exibem traço.
- Decisão [[ADR-011 Cartões sobre a arte do Riot]]. Validação: 324 testes, 323 passaram e um legado foi pulado com Riot aberto; inclui Electron real com dados fictícios e geometria da área preservada.
- Validação visual na máquina: cinco cartões carregados sobre a arte do cliente oficial, preservando a coluna nativa de login. Dados já salvos apareceram nos cartões e a área direita permite rolar a lista. O gerenciador foi recarregado com a interface nova sem autenticar nem abrir jogo.

## 2026-10-28 · Janela auxiliar da bandeja oculta

- Ocultada a `TrayIconClass` que ficou aberta no desktop. A recuperação agora a mantém oculta mesmo com snapshot visível antigo e nunca a seleciona como janela principal. Somente janelas raiz da interface Riot com dimensões apropriadas podem ser ativadas; serviços e jogos são excluídos dessa seleção.
- Self-test do guard cobre o filtro de ativação com janela realista, serviço de bandeja, auxiliar, jogo e janela filha.

## 2026-10-28 · Sobreposição e login visível

- [[riotOverlay]] e [[riotWindowObserver]] acompanham o cliente oficial com botão Contas, foco, escala e painel completo isolado. O padrão inicia somente o serviço na bandeja; o usuário abre o Riot normalmente. O modo anterior permanece por `npm run start:private`. Decisão: [[ADR-009 Sobreposição no cliente oficial]].
- A pedido do usuário, o login sobreposto mantém o Riot visível com indicador de carregamento e Cancelar. Reutiliza o backend e faz logout local para trocar a conta, sem fechar a interface para restaurar YAML. A identidade é confirmada antes de pedir o jogo. Decisão: [[ADR-010 Login visível com progresso]].
- Quando a janela do jogo está pronta, solicita fechamento somente das janelas da interface Riot. Falha, cancelamento e verificação mantêm o cliente acessível. O painel de progresso deixa a tela nativa livre.
- 324 testes: 323 passaram e um teste legado foi pulado porque o Riot estava aberto. A captura real confirmou o botão sobre o cliente oficial; o usuário relatou que não o via. A detecção de foco passou a considerar processos da interface oficial e do mesmo executável do gerenciador. O Riot foi aberto sem autenticar durante a validação final. A interação completa com a sobreposição e o novo lançamento visível ainda requerem confirmação em uso.

## 2026-10-28 · Sobreposição e login visível

- [[riotOverlay]] e [[riotWindowObserver]] acompanham o cliente oficial com botão Contas, foco, escala e painel completo isolado. O padrão inicia somente o serviço na bandeja; o usuário abre o Riot normalmente. O modo anterior permanece por `npm run start:private`. Decisão: [[ADR-009 Sobreposição no cliente oficial]].
- A pedido do usuário, o login sobreposto mantém o Riot visível com indicador de carregamento e Cancelar. Reutiliza o backend e faz logout local para trocar a conta, sem fechar a interface para restaurar YAML. A identidade é confirmada antes de pedir o jogo. Decisão: [[ADR-010 Login visível com progresso]].
- Quando a janela do jogo está pronta, solicita fechamento somente das janelas da interface Riot. Falha, cancelamento e verificação mantêm o cliente acessível. O painel de progresso deixa a tela nativa livre.
- 323 testes: 322 passaram e um teste legado foi pulado porque o Riot estava aberto. A captura real confirmou o botão sobre o cliente oficial; o usuário relatou que não o via. A detecção de foco passou a considerar também processos de interface do mesmo caminho oficial. Essa correção e o novo fluxo visível ainda requerem confirmação completa em uso.

## 2026-10-28 · Verificação recuperável e lançamento real confirmado

- **Diagnóstico ao vivo autorizado:** a Riot aguardava MFA enquanto a janela estava oculta; a recuperação também falhava ao restaurar estilos. Na repetição, o monitor falhou após enviar credenciais e antes de consultar o desafio.
- **Correção:** [[signInFlow]] revela uma vez a interface nativa para verificação e preserva sua recuperação no timeout. O bloco de erro consulta o estado sanitizado se o monitor falhar durante autenticação nativa. Cancelamento oculta novamente; erro posterior de abertura do jogo não vira desafio de login.
- **Estado e recuperação:** [[signInService]] mantém flags explícitas de atenção em falha, ignora progresso tardio e libera o mutex. [[main]] recupera a interface original inclusive após timeout; consulta [[riotClient]] para permitir voltar às contas depois da verificação.
- **Janelas:** [[windowGuard]] restaura somente os bits que controla, preservando alterações do cliente. A espera pelo worker continua processando mensagens, com prazo limitado. Diagnóstico opcional informa metadados de estilo, sem conteúdo ou credenciais. Complemento registrado na [[ADR-008 Recuperação visual sem reexibir o Riot]].
- **Validação:** suíte completa com 313 testes: 312 passaram e 1 foi pulado com Riot aberto. Teste real de 28/10 às 18:03–18:04 (São Paulo) concluiu autenticação, verificou identidade, abriu LeagueClientUx e salvou sessão; operação terminou `succeeded` às 18:04:55.
- **Limitação confirmada:** ainda ocorreram recuperações por `window-style-timeout` e `window-style-denied` durante a tentativa bem-sucedida. Não há comprovação de ausência absoluta de reaparecimento; a abertura do jogo e a recuperação de MFA foram confirmadas.

## 2026-10-27 · Recuperação sem reaparecimento intermediário do Riot

- **Problema observado:** após Entrar e jogar, o cliente reaparecia rapidamente antes de o jogo abrir. Os registros confirmam quedas do monitor por `window-style-denied` e `window-style-timeout`; o encerramento anterior podia restaurar a visibilidade durante sua substituição.
- **Correção:** [[windowGuard]] verifica somente os bits de estilo que controla ao ocultar e entrega snapshots sem restaurar em falha/`handoff` com dono vivo. O substituto recebe `initialMode` e já arma a ocultação antes de `ready`.
- **Recuperação preservada:** [[windowController]] mantém o encerramento definitivo idempotente, aguarda tarefas em curso e restaura snapshots retidos com helper sem ativação. Recuperação manual continua trazendo a interface para frente; jogos e Vanguard continuam fora do filtro.
- **Decisão:** [[ADR-008 Recuperação visual sem reexibir o Riot]], registrada antes do código. Autenticação, CAPTCHA/2FA e verificação de conta não mudam.
- **Validação:** `npm test`: 297 passaram, 1 teste do instalador legado foi pulado porque o Riot estava aberto. Testes de protocolo e concorrência usam processos falsos; self-test do C# não toca no desktop. Não foi executado login real para confirmar a ausência completa da piscada.

## 2026-10-27 · Todas as contas dentro da janela Riot

- **Pedido:** retirar a janela independente Riot Account Manager e reunir cadastro, edição, exclusão, elos, filtros, cópia, configurações e progresso na própria interface Riot.
- **Arquitetura:** [[main]] passa a executar serviços e bandeja, sem criar `BrowserWindow`. [[managerHost]] hospeda o [[renderer]] em um `WebContentsView` filho da janela Riot, com preload isolado ([[manager-preload]]), validação de remetente/frame/URL e recusa de navegação/permissões. Decisão registrada antes do código em [[ADR-007 Interface completa dentro do Riot Client]].
- **Interface:** acesso **Contas** permanece também na página conectada, sem exigir sair da sessão. O seletor rápido continua no login. **Voltar ao Riot** e `Escape` sem modal fecham apenas a visualização; campos sensíveis recém-digitados são limpos.
- **Serviço:** [[managerService]] centraliza validação dos comandos e disponibiliza uma fila limitada de eventos públicos. Senhas/chaves persistidas não voltam ao renderer; copiar senha continua sendo uma escrita do main no clipboard, com limpeza temporizada.
- **Abertura:** `npm start` usa a interface integrada por padrão. O preload e o atalho da janela independente foram removidos; `start:riot-login` continua como alias.
- **Cópia atualizada:** o preparador usa `private-v1/embedded-v1/` e declara `fullManagerInClient`; a cópia anterior permanece no lugar. O controlador dá prioridade ao novo destino e recusa addons antigos.
- **Agendamento:** atualização de elos é reagendada mesmo após falha; conta removida durante atualização não produz evento nulo.
- **Preservado:** dados/sessões existentes e as alterações locais do usuário em [[signInFlow]], [[windowController]] e seus documentos/testes. A migração não modifica a instalação original Riot.
- **Validação:** 293 testes cobrem comandos, transporte, view/preload, navegação e interface completa renderizada no Electron com conta fictícia. A cópia privada 142.0.0 foi preparada e validada por hash, com a instalação original intacta. O fluxo de login com uma conta real e a abertura de jogo não foram executados.

## 2026-10-26 · Monitor de janelas que se recupera

- **Problema:** depois do preenchimento nativo, o monitor de janelas ([[windowGuard]]) caía, e a primeira checagem do [[signInFlow]] abortava o login. A senha já tinha sido digitada, e o jogo nunca era pedido. Três falhas reais no `sign-in.log` (11:33, 18:40 e 23:00); o motivo da queda não era registrado em lugar nenhum.
- **Correção:** o [[windowController]] reergue um monitor perdido no mesmo modo (até 3 vezes por minuto), repete uma vez os comandos interrompidos, usa helper avulso no `gameWindow` quando o monitor está morto e só deixa `assertHealthy` falhar quando não consegue recuperar.
- **Diagnóstico:** cada queda vira um código fixo (`window-style-timeout`, `no-response`, `exit-1`…), gravado no `sign-in.log` e incluído na mensagem final de erro. Texto livre do .NET vira `unknown`.
- 8 testes novos ou reescritos; 246 passando (1 pulado por exigir o Riot fechado). **Ainda não validado com o Riot real.**
- Segurança da recuperação conferida no código: o monitor novo herda o estado original das janelas salvo pelo anterior.

## 2026-10-26 · "The Riot Client window did not open"

- **Causa:** quando a Riot exige CAPTCHA antes da senha, o login cai no formulário nativo escondido. Para abrir a interface, o código chamava `RiotClientServices.exe` de novo, mas os serviços já rodavam em `--headless`, e a chamada não abria janela. O [[loginForm]] esperava 60 s e falhava. Acontecia em toda troca de conta sem sessão salva válida, inclusive pelo painel MINHAS CONTAS.
- **Correção:** novo módulo [[riotInterface]]. Ele pede a interface aos serviços (`POST /riot-client-lifecycle/v1/show`) e, se ela não aparecer em 10 s, reinicia os serviços com interface (oculta pelo monitor). É seguro porque nenhuma senha foi enviada nesse ponto.
- O caminho usado vai para o `sign-in.log`. 7 testes novos; 240 passando (1 pulado por exigir o Riot fechado).
- Diagnóstico registrado em [[Solução de problemas]], incluindo a cópia virtualizada do `sign-in.log` vista por apps empacotados.
- **Validação real (23:00):** o `show` abriu a interface em 0,8 s e as credenciais foram preenchidas. O erro "window did not open" não se repetiu. O login parou em seguida por outro motivo, o monitor de janelas encerrado ("The background window guard stopped"), e o jogo não abriu. Ver [[Backlog]].

## 2026-10-26 · Segurança do login

- **Sem segundo envio de senha.** Uma resposta 404/405/501 ao `complete` (senha já enviada) agora é erro, em vez de `{ supported: false }`, que levava o [[signInFlow]] a digitar a senha de novo no formulário nativo ([[riotAuthentication]]).
- **Sessão do jogador falha fechada.** `sessionState` troca a lista de bloqueios por uma lista de estados permitidos (`NON_BLOCKING_SESSION_STATES`). Estados desconhecidos e 19 estados de bloqueio que o projeto não conhecia (restrições de idade e de jogo, e-mail dos pais, 2FA negado, escolhas de conta e plataforma…) agora exigem intervenção em vez de liberar o jogo. Lista tirada da enumeração `PlayerSessionStateType` do Riot 142.
- 4 testes novos; 234 passando.

## 2026-10-26 · Reorganização profissional

- Código movido para `src/{main,core,riot,platform/windows,integration,renderer}`, scripts para `scripts/{dev,integration,legacy}`, testes espelhando `src/` ([[ADR-006 Estrutura de pastas por camada]], [[Estrutura de pastas]]).
- `src/paths.js` centraliza todos os caminhos do projeto ([[paths]]).
- `src/riotApi.js` renomeado para `src/core/rankApi.js`; `scripts/run-private-riot-host.js` virou `src/integration/host/hostEntry.js`.
- Comentários removidos de JS, CSS, HTML, PowerShell e C# embutido; o conhecimento foi para as notas dos módulos ([[ADR-005 Código sem comentários e conhecimento no vault]]).
- Documentação transformada neste vault do Obsidian; `ANALISE.md`, `INTEGRACAO-RIOT.md`, `COMPARACAO-ROSE.md` e `GUIA-GITHUB.md` viraram notas.
- `CLAUDE.md` e agentes do projeto em `.claude/agents/` ([[Trabalhando com agentes]]).
- `package.json`: `main` aponta para `src/main/index.js`; novo `start:riot-login`; `integration:prepare` virou `legacy:prepare-install`; `engines.node >= 22`.
- `.gitattributes` e `.editorconfig` para finais de linha e formatação consistentes.
- 230 testes passando antes e depois.

## Antes da reorganização

Melhorias já implementadas, registradas na antiga `ANALISE.md`:

- **Monitor persistente** de janelas no lugar do de três minutos ([[ADR-004 Monitor persistente de janelas]]).
- **Abertura em etapas:** monitor pronto antes do cliente; jogo só depois do Riot ID; sucesso exige janela visível.
- **Abertura direta:** conta atual reaproveitada sem reinício; trocas com `--headless`.
- **Intervenção controlada:** 2FA, CAPTCHA e atualizações informados no painel, sem abrir o cliente sozinho.
- **Cancelamento e recuperação** com liberação do botão Play mesmo em falha; restauração das janelas ao fechar.
- **Sessões corretas:** tokens da conta anterior salvos antes de carregar a escolhida; identidade desconhecida não é associada.
- **Armazenamento:** caminhos de sessão validados, gravação atômica, backups de edições sem churn de elo.
- **Falhas de execução** do Riot Client e dos auxiliares tratadas; comandos do monitor serializados.
- **Contexto de login:** limpar e inicializar antes de enviar a senha; CAPTCHA pré-submissão na interface escondida.
- **Painel MINHAS CONTAS** na tela de login real 141/142 ([[Integração com o Riot Client]]).
- **Serviço compartilhado** de login para a janela e o painel ([[signInService]]).
