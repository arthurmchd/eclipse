---
tipo: conceito
tags: [arquitetura, segurança]
---

# Segurança e privacidade

Lista central das regras que protegem o usuário. Cada uma aponta para o módulo que a implementa; a nota do módulo explica o detalhe. **Qualquer mudança que enfraqueça uma destas regras precisa de uma decisão registrada em `04 Decisões/` (template [[Decisão]]) antes do código.**

## Segredos

| Segredo | Onde vive | Quem pode ler |
|---|---|---|
| Senha da conta | `data.json`, criptografada | Só o main, durante o login |
| Chaves de API | `data.json`, criptografadas | Só o main, para [[rankApi]] |
| Sessão Riot salva | `sessions/<id>.bin`, criptografada | Só o main, ao restaurar e ao guardar o login que a Riot gravou ao sair ([[sessionKeeper]]) |
| Token do backend Riot | Lockfile do Riot | Só o main, para a API local ([[backend]]) |

## Regras

### Interface não recebe segredo persistido
- O renderer recebe contas por `publicAccount`, sem senha ([[store]]).
- O Jogar dos cartões envia só `accountId` e jogo. Os cartões vivem num `WebContentsView` isolado, com preload próprio e lista fechada de comandos validados ([[managerHost]], [[manager-preload]], [[managerService]]).
- Cadastro e edição transportam os valores que o usuário acabou de digitar. Senhas e chaves já guardadas nunca são devolvidas para preencher os campos; o serviço recebe os valores novos e os armazena criptografados.
- Nenhum comando lê ou copia uma senha guardada. O antigo `copy` saiu com a janela antiga ([[ADR-028 Modo antigo removido]]).
- `contextIsolation`, `sandbox` e `nodeIntegration: false` na view dos cartões. O IPC aceita apenas o `webContents`, o frame principal e a URL local esperada; a página da Riot nunca recebe a API.
- Links externos só `https://` e sempre no navegador padrão; navegação para outra página e criação de janelas pela visualização são recusadas ([[managerHost]]).

### Segredo não vira texto público
- Mensagens de erro e progresso passam por `safeText`, que troca usuário e senha por `[redacted]` e devolve uma mensagem genérica se o segredo for curto demais para mascarar ([[signInService]]).
- Respostas de autenticação podem conter tokens, usuários e mensagens do servidor. Só valores fixos conhecidos saem de [[riotAuthentication]].
- Corpos de erro são não confiáveis: só códigos de erro conhecidos afetam a mensagem.
- O preenchimento do login e o helper de janelas devolvem só códigos de uma lista fechada, nunca o pedido recebido ([[loginForm]], [[windowGuard]]).
- Motivos de falha do helper de janelas só chegam ao log como códigos `^[a-z0-9-]{1,64}$`; o resto vira `unknown` ([[windowController]]).
- As respostas de abertura do jogo chegam ao `sign-in.log` só como status HTTP, elegível ou não e um `errorCode` com formato de código. Mensagem, detalhes e ID da abertura ficam de fora ([[riotClient]]).
- A fonte de um login não terminado chega ao `sign-in.log` só como nome de lista fixa: tipo de CAPTCHA conhecido ou estado de bloqueio conhecido da sessão do jogador; o resto vira `other` ([[riotAuthentication]]).
- Uma falha ao guardar a sessão de quem sai e uma chave de API ilegível vão ao log como linhas fixas, sem o texto da exceção, que pode trazer caminhos ([[signInService]], [[store]]).
- `sign-in.log` e `data.log` não registram credenciais.
- A versão do Riot Client vai ao `sign-in.log` a cada preenchimento do formulário, só como quatro números ([[riotVersion]]).

### Segredo não vai em argumento de processo
- Desde 2026-11-21 ([[ADR-044 Helpers do Windows em Rust]]) as credenciais não saem do processo do Eclipse: o formulário é preenchido por dentro dele ([[loginForm]]). Antes iam ao `login.ps1` pela entrada padrão de um PowerShell, nunca por argumento.
- O Eclipse não abre PowerShell nem leva scripts no Setup; um teste confere ([[paths]]).

### Serviços externos
- Desde 2026-11-15 ([[ADR-037 Elo do League pelo OP.GG]]), o Eclipse manda ao OP.GG (`mcp-api.op.gg`) o Riot ID e o servidor de cada conta salva, a cada atualização dos elos, mesmo sem chave. Vão todos do mesmo IP, e o OP.GG consegue ligar as contas à mesma pessoa. Não vão login, senha nem sessão. A resposta é lida como não confiável, com limites de tamanho e de aninhamento e conferência de cada campo ([[opgg]]).
- Com chave, o Riot ID também vai à API oficial da Riot e, para o VALORANT, à HenrikDev ([[rankApi]]).
- Desde 2026-11-21 ([[ADR-045 Atualização pelo GitHub]]), com "Procurar atualizações" ligado (o padrão), o Eclipse baixa o `latest.json` do último release do GitHub 1 minuto depois de abrir e a cada 12 horas. O GitHub recebe o IP; nem conta, nem Riot ID, nem a versão instalada vão junto. A versão lida só aparece se tiver o formato `número.número.número` ([[updates]]).
- A atualização só instala com o clique do usuário e só roda um Setup assinado pela chave do projeto, conferida pela chave pública no `tauri.conf.json`. A chave privada fica fora do repositório (`%USERPROFILE%\.tauri\`) e nunca é versionada ([[appUpdater]]).
- Com "Sons da interface" ligado (o padrão desde a 2.15.1), os cartões tocam arquivos `.ogg` da CommunityDragon, que recebe o IP e o nome do som, como já recebe com os ícones. A CSP de `cards.html` libera áudio só desse domínio (`media-src https://raw.communitydragon.org`) e continua sem `connect-src`, sem script de fora e sem `style` inline ([[sounds]], [[ADR-040 Visual da Riot e sons da interface]]).
- Desde a 2.28.3, a CSP de `cards.html` aceita `blob:` só em `img-src`, para a cópia reduzida do estandarte que a própria página gera ([[ADR-050 Estandarte reduzido nos cartões]]). Um `blob:` só nasce de script da própria página, e imagem não executa código. Não estender `blob:` a `script-src`, `style-src` ou outra diretiva.

### Rede local fechada
- O Eclipse não abre porta de rede. A prévia de desenvolvimento (`npm run preview`) escuta só em `127.0.0.1` e serve só os arquivos dos cartões, as fontes e o `mock-api.js` ([[Desenvolvimento]]). Os cartões falam com o main só pelo IPC do [[managerHost]], com lista fechada de métodos e validação dos argumentos no [[managerService]].
- A fila de eventos tem tamanho limitado e carrega somente dados públicos de contas, configurações mascaradas e progresso. Esconder os cartões não cancela uma operação nem faz o serviço devolver credenciais.
- A API local do Riot é acessada por HTTPS com o certificado raiz lido do `app.asar` oficial e validação de certificado ligada ([[backend]], [[asar]], [[riotTransport]]). Desde a 2.29.0 o certificado fica guardado enquanto o `app.asar` não muda, e só os `GET` reaproveitam a conexão, cada conexão nova validada do mesmo jeito. Pedidos que mudam a Riot (`POST`, `PUT`, `PATCH`, `DELETE`) usam conexão própria e nunca são repetidos; a senha do lockfile continua lida a cada pedido, sem ficar guardada ([[ADR-051 Certificado guardado e conexão reaproveitada na API local]]).
- Para o banner do League, o Eclipse lê do cliente do LoL o resumo de desafios da própria conta e, às vezes, o inventário de banners; de cada resposta só guarda o nome do arquivo do banner, validado, e descarta o resto ([[gameRanks]]). Do mesmo jeito, para os cartões, lê o fundo de perfil (`summoner-profile` e o JSON do campeão no `lol-game-data`) e a Pequena Lenda escolhida (`lol-cosmetics`): só guarda o caminho da ilustração e o nome do arquivo, validados, e as imagens vêm do mesmo `raw.communitydragon.org` que já estava liberado.
- Desde 2026-11-08 o Eclipse também lê o elo do jogo aberto ([[gameRanks]], [[ADR-031 Elo lido do próprio jogo, sem chave]]): só `GET`, só em `127.0.0.1`, com o mesmo certificado e validação. No cliente do LoL, a senha vem do `lockfile` da pasta do jogo, que só é lido; ela fica no main, como a do Riot Client. No Riot Client, a lista de presenças traz a dos amigos: só a da própria conta é lida, e as outras são descartadas sem gravar nem registrar.
- Sem chave de API, nenhum servidor é consultado para os elos.

### Arquivos dentro dos limites
- O Setup leva só `src/` e `package.json`, além das fontes; `backups/`, `.client-integration/`, logs e dados nunca entram no pacote. O `test/package.test.js` trava a lista ([[ADR-030 Eclipse instalado por um Setup próprio]]).
- O Eclipse instalado usa a mesma pasta de dados do `npm start` e a desinstalação não a apaga.
- O Setup do Tauri remove o Eclipse em Electron em modo de atualização (`--updated`), que mantém a pasta de dados e o início com o Windows. O Eclipse em Tauri não abre enquanto o Electron segura o `lockfile` da pasta de dados; ele só tenta abrir esse arquivo para leitura ([[ADR-034 Troca do Electron pelo Tauri]], [[electronInstance]]).
- As notificações do Windows do Eclipse em Tauri só levam textos que já iam para a tela, sem nome de conta, usuário ou senha ([[notices]]).
- A chave `Run` do usuário só ganha a entrada `Eclipse` quando o usuário liga "Iniciar com o Windows" na bandeja, e só no app instalado. Desligar a remove, e o desinstalador também ([[startWithWindows]]).
- IDs de sessão validados contra travessia de caminho e streams NTFS ([[store]]).
- A instalação original do Riot nunca é escrita. Desde a 2.31.0 o `app.asar` também é lido para tirar o logo vermelho da Riot que a [[overlayCover]] mostra no lugar dele: o SVG é conferido (sem script, handler, `foreignObject` ou endereço externo), fica só na memória, sai só pelo endereço exato `riot/logo.svg` e nunca vai para o Setup ou o repositório ([[riotLogo]], [[ADR-053 Etapas do login na tela até o jogo abrir]]). O `app.asar` oficial só é lido, com limites de tamanho e sem seguir links ou entradas fora do pacote ([[asar]], [[ADR-028 Modo antigo removido]]).
- Pelo serviço local, a única configuração da Riot que o Eclipse grava é `stay-signed-in-modal-shown` = `true`, antes de um login com senha e "Manter login" ligado, como a própria Riot grava ao mostrar o aviso do "Manter login". Não leva dado de conta ([[ADR-046 Aviso do Manter login marcado como visto]]).
- Fora de um login, o arquivo de configurações da Riot (`RiotGamesPrivateSettings.yaml`, na pasta local do usuário) só é reescrito para tirar o login lembrado, e só com a Riot sem conta conectada (fechada, em segundo plano ou na tela de login).
  - Antes, o login é guardado na conta dona dele: mesmo `sub` de uma sessão guardada ou, sem ela, Riot ID único.
  - Sem dona comprovada, é limpo sem ser guardado, para a Riot abrir sempre desconectada.
  - O arquivo é trocado de uma vez (temporário na mesma pasta e `rename`), e só se ainda for a versão lida: se a Riot o regravou durante a conferência, nada é escrito ([[riotClient]]).
  - Do `id_token` da Riot só se leem `sub` e Riot ID, sem gravar nem registrar o token à parte ([[sessionKeeper]], [[ADR-021 Riot sempre abre desconectada]]).
- Fora de um login, o Eclipse só pede à Riot que mostre a janela (`/riot-client-lifecycle/v1/show`) quando ela volta do segundo plano sem nenhuma. Nunca a reinicia por isso ([[riotWakeup]], [[ADR-023 Riot sem janela abre a interface ao sair do segundo plano]]).
- Fora de um login, o Eclipse só inicia a Riot num caso: ela estava com a janela aberta quando o guardião a fechou depois de um jogo. Só depois de ela sair e de o login ser guardado e limpo, e só com nenhum processo da Riot rodando. Ela abre desconectada ([[sessionKeeper]], [[ADR-026 Riot fechada depois do jogo reabre na tela de login]]).
- Processos da Riot só são encerrados pela saída normal da própria Riot (`quitClient`), e só com uma conta conectada que ficou sem jogo ou sem janela. Nunca `taskkill` fora do fluxo de login, nunca um jogo aberto e nunca a Riot na tela de login ([[sessionKeeper]], [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]).

### Autenticação honesta
- Não há tentativa de contornar CAPTCHA ou 2FA ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]).
- Uma tela de verificação desconhecida nunca recebe senha automática.
- Nada de reenvio de senha após falha de senha, rede, limite, rota indisponível ou CAPTCHA pós-submissão ([[riotAuthentication]]).
- Estado desconhecido da sessão do jogador conta como verificação pendente, nunca como autenticado ([[riotAuthentication]]).
- O CAPTCHA do formulário de login só deixa de contar como verificação pendente quando `/rso-auth/v1/authorization` responde 200; aí quem decide é a sessão do jogador. CAPTCHA recusado pela Riot, tela desconhecida do autenticador e autorização sem resposta continuam bloqueando ([[ADR-042 CAPTCHA do formulário não bloqueia conta autorizada]]).
- O jogo só é pedido depois de confirmar o Riot ID ([[signInFlow]]).
- Login sem digitar só pelo "Manter login" da própria Riot: o Eclipse devolve à Riot a sessão que ela mesma gravou, sem formulário. Uma sessão recusada volta ao formulário visível, onde a verificação automática da Riot roda com a janela à mostra; nada finge que uma janela escondida está visível ([[ADR-019 Sessão salva por conta no modo cartões]]).
- Trocar de conta nunca encerra a sessão de quem sai no servidor da Riot, em nenhum modo: a Riot conectada é fechada com a saída normal, sem `DELETE /rso-auth/v1/session`. Vale também para uma sessão restaurada que é de outra conta e para uma conta que a Riot restaurou sozinha. O `DELETE` só limpa um login pela metade (2FA ou erro pendente) quando a Riot diz que não há conta conectada, nunca com o estado desconhecido ([[signInFlow]], [[ADR-020 Riot conectada é encerrada quando fica sem jogo]]).

- Uma sessão guardada só é apagada pelo guardião quando a conta saiu pela Riot: o arquivo da Riot perdeu o login com ela aberta e o serviço local responde sem conta. Só a cópia local some; nada é enviado à Riot ([[sessionKeeper]], [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]]).

### Janelas e processos
- O padrão desde [[ADR-009 Sobreposição no cliente oficial]] é uma janela própria sem moldura que acompanha o cliente oficial. O observador só lê geometria e processo; exige caminho do executável Riot esperado e não lê título, texto, campos ou credenciais. As únicas leituras visuais são as cores de dois quadrados de 7 × 7 px da coluna de login, sem texto, campo ou credencial: um numa área vazia, para saber se um modal da Riot escureceu a janela ([[ADR-017 Cartões cedem a vez aos avisos da Riot]]), e um no centro da caixa "Stay signed in", para saber se o formulário de login sumiu ([[ADR-025 Caixa some junto com o formulário da Riot]]). Cada leitura sai do helper só como um booleano. Por conta própria, a única janela que ele altera é a da sobreposição, e só se ela pertencer ao processo do gerenciador ([[ADR-012 Sobreposição presa à janela do Riot]]). Na janela da Riot ele só minimiza ou fecha, e só quando o usuário clica nas cópias desses controles, na janela já conferida pelo executável oficial ([[ADR-015 Controles da janela do Riot desenhados pelo Eclipse]]). Enquanto acompanha essa janela, também desliga a animação de minimizar dela e a devolve ao parar ([[ADR-016 Riot sem animação de minimizar e cartões com os cantos dela]]). No Tauri, quando o usuário arrasta a Riot pela barra de cima com os cartões à vista, ou aperta na faixa de cima dos cartões ([[ADR-041 Arraste da Riot pela área do Eclipse]], [[ADR-048 Arraste só pela faixa de cima]]), o Eclipse assume o arraste e move a Riot e a sobreposição juntas ([[overlayDrag]], [[ADR-036 Arraste da Riot assumido pelo Eclipse]]): durante esse arraste lê a posição do cursor e o estado do botão principal, sem gancho de mouse ou teclado, sem gravar nada e sem mandar evento à Riot. O X fecha pelos mesmos pedidos do serviço local que o botão da Riot usa ([[riotAppControls]]), respeitando a opção de segundo plano do jogador. A view mantém o mesmo isolamento e validação IPC. A caixa "Ocultar contas" ([[overlayToggle]]) é uma segunda view na mesma janela, isolada do mesmo jeito, cujo preload só manda um booleano; na coluna de login, só o retângulo dela entra na região de cliques ([[ADR-013 Caixa para ocultar as contas na coluna de login]]). A exceção é o login em andamento: uma terceira view, sem preload nem comando ([[overlayCover]]), cobre a coluna, e a caixa some. Desde a 2.30.0 ela roda um script só para receber as etapas do login: o código da etapa, o jogo e o texto do status já filtrado, sem conta, Riot ID, usuário ou senha ([[ADR-053 Etapas do login na tela até o jogo abrir]]). Desde a 2.29.0 as três views usam o mesmo perfil e podem dividir um processo de renderização; na 2.29.0 instalada, a cobertura e a caixa dividem um e os cartões ficaram noutro ([[ADR-052 Webviews da sobreposição num processo só]]). Entre elas não se conta mais com isolamento de processo, só com o de comandos, conferidos no Rust pelo rótulo e pelo endereço, e a cobertura não tem nenhum comando liberado. Qualquer pedido de atenção da Riot (2FA, CAPTCHA, pedidos da sessão do jogador) a tira na hora, para o usuário resolver na tela nativa, e antes de a conta entrar ela deixa descoberto o ponto que o observador lê ([[ADR-024 Coluna de login coberta durante o login]]). Depois que a conta entra, o ponto fica coberto e os pedidos da Riot vêm só do fluxo de login ([[ADR-053 Etapas do login na tela até o jogo abrir]]). A caixa também some, e sai da região, enquanto o formulário de login da Riot está fora da tela ([[ADR-025 Caixa some junto com o formulário da Riot]]).
- O main não cria janela própria de gerenciamento. Os cartões vivem na sobreposição presa à janela da Riot, e sair do serviço é uma ação da bandeja ([[ADR-028 Modo antigo removido]]).
- O helper de janelas só ativa ou fecha janelas da interface do Riot Client (`Riot Client`, `RiotClientUx`) e só lê as do jogo; jogos e Vanguard nunca são alterados. Desde 2026-11-07 nada esconde a Riot nem muda estilos de janela dela ([[windowGuard]]).
- Nenhuma injeção de código, teclado global ou mouse. O preenchimento só toca a janela do Riot: primeiro pelos campos que ela expõe ao UI Automation, procurados só dentro dela, e, se não der, por mensagens postadas a ela. O usuário preenchido só é comparado dentro do script e a senha nunca é lida de volta ([[loginForm]], [[ADR-043 Preenchimento do login por UI Automation]]).
- O `sign-in.log` diz como o formulário foi preenchido só com `input:uia` ou `input:keys` ([[signInFlow]]).

## Ameaças fora do escopo

- Malware rodando como o mesmo usuário Windows: o DPAPI não protege contra ele.
- Mudanças nos termos ou na API privada do Riot ([[Limitações conhecidas]]).
