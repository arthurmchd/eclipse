# Riot Account Manager

Painel para entrar em várias contas da Riot com um clique: League of Legends, Teamfight Tactics e VALORANT, com o elo de cada conta e os emblemas oficiais de cada jogo.

## Como abrir

Para abrir a interface do Riot com o seletor **MINHAS CONTAS**, abra **`Abrir Riot com minhas contas.bat`**. Após atualizar o código, encerre a instância antiga uma vez para carregar a atualização. Esse modo experimental usa uma cópia privada da interface real do Riot Client 142 (também há suporte à 141), conectada aos serviços oficiais locais. A instalação original fica intacta. A cópia atualizada já foi preparada nesta máquina.

O painel com as contas salvas foi confirmado visualmente no formulário real de login v142.0.1, sem autenticar uma conta nem abrir jogo. Se a Riot já estiver conectada, sua página inicial será exibida. O atalho agora habilita a integração mesmo quando o gerenciador normal já está aberto; falhas apresentam uma mensagem em vez de abrir o cliente original silenciosamente. Consulte [INTEGRACAO-RIOT.md](INTEGRACAO-RIOT.md) para uso, limites e validação.

Dê dois cliques em **`Abrir Riot Account Manager.bat`**. Na primeira vez ele instala as dependências (precisa do Node.js, que já está instalado nesta máquina).

Pelo terminal:

```bash
npm start
```

## Primeiros passos

1. **Settings** → cole as chaves de API:
   - **Riot API key** (LoL + TFT): crie em <https://developer.riotgames.com>. A chave de desenvolvimento expira a cada 24 h; registre lá um *Personal API Key* para ter uma que não expira.
   - **Riot API key for TFT** (opcional): a Riot aprova chave pessoal por jogo. Registre um segundo produto com *Game Focus: Teamfight Tactics* e cole a chave dele aqui. Sem ela, o painel tenta o TFT com a chave principal (funciona com a de desenvolvimento).
   - **HenrikDev API key** (VALORANT): API não oficial, chave grátis em <https://api.henrikdev.xyz/dashboard/>. A API oficial de elo do VALORANT só é liberada para apps aprovados pela Riot.
2. **Add account** → Riot ID (pode colar `Nome#TAG` direto), servidor, usuário e senha de login.
3. Escolha a aba do jogo e clique em **Play**.

## Login sem digitar (sessão salva)

Na **primeira vez** que você usa Play numa conta, o gerenciador prepara o contexto de autenticação do Riot e tenta usar o serviço local, com a opção de manter a sessão ativa. Se a API estiver indisponível ou exigir CAPTCHA antes de receber a senha, usa a própria interface do Riot escondida para concluir a entrada. A sessão persistida pela Riot é salva em uma cópia criptografada por conta (ícone ⚡ no card).

Se a conta escolhida já está conectada e não há outro jogo aberto, o gerenciador verifica o Riot ID e pede diretamente a abertura do jogo, sem reiniciar ou autenticar novamente. Ao trocar para uma conta com sessão salva, restaura essa sessão após encerrar o cliente anterior e inicia os serviços com `--headless`, sem pedir uma nova interface.

Se a sessão expirar, o gerenciador tenta o login direto uma vez. Falhas de senha, rede ou limite de tentativas não são repetidas pela digitação de credenciais. Para apagar a sessão salva de uma conta: menu ⋯ → **Forget saved sign-in**.

O login usa o próprio cliente da Riot. O projeto não tenta contornar CAPTCHA ou 2FA.

## O que acontece ao clicar em Play

1. Oculta a interface integrada e ativa o monitor de janelas. O seletor integrado recusa trocas com jogo aberto; no gerenciador normal, há confirmação antes de encerrá-lo.
2. Se o Riot ID da conta conectada corresponde à selecionada e nenhum jogo está aberto, reaproveita essa sessão. Se o backend está desconectado e a conta não possui sessão salva, usa esse mesmo backend para entrar, sem reinício.
3. Quando precisa restaurar uma sessão ou trocar de conta, guarda a sessão anterior somente com identidade confirmada, encerra o cliente e inicia apenas os serviços em modo `--headless`. A sessão escolhida é carregada após o encerramento para preservar os tokens atualizados.
4. Se necessário, autentica pela API local com HTTPS e o certificado da instalação Riot. Um contexto ausente ou que ficou em `invalid_request` é limpo e inicializado antes da primeira submissão de senha. API indisponível ou CAPTCHA exigido antes da senha permitem usar a interface nativa escondida. Não há pedido de abertura do jogo antes de verificar a conta.
5. Acompanha o login pela API local do Riot Client. Erros, demora, 2FA ou CAPTCHA não abrem o cliente automaticamente. Quando houver necessidade de intervenção, o painel habilita **Show Riot Client**. Se a verificação estiver na interface nativa escondida, esse botão abre a própria janela do desafio, preservando seu contexto. Depois da autenticação, o monitor volta a ocultá-lo. **Cancel** interrompe o fluxo; não desfaz um jogo que já recebeu o pedido de abertura.
6. Solicita a abertura do jogo pela API local e espera uma **janela visível do jogo**, em vez de considerar qualquer processo como sucesso. Para LoL/TFT, essa janela pode ser o lobby do League; entrar numa partida continua sendo uma ação sua. Se estiver demorando, o painel oferece a abertura manual do cliente para conferir atualizações.
7. Oculta todas as janelas dos processos de interface Riot, inclusive janelas recriadas, e mantém o monitor ativo enquanto o painel estiver aberto. O monitor não tem mais o limite de três minutos. Os processos Riot continuam rodando; nenhum processo do jogo ou do Vanguard é alterado para esconder janelas. Também minimiza o painel quando a janela do jogo aparece, conforme Settings.

No seletor integrado, o Riot permanece oculto mesmo se configurações antigas permitiam exibi-lo. No gerenciador normal, as preferências de **Settings** continuam valendo: marque **Keep the Riot Client hidden**, **Keep the Riot Client window hidden after the game starts** e **Minimize this app** para esse comportamento. Há também **Show Riot Client** para recuperação manual.

O monitor usa eventos de janelas do Windows e uma varredura de segurança. Como o Riot Client é outro programa e os eventos são assíncronos, isso reduz a exposição das janelas, mas não permite garantir ausência absoluta de um breve flash em todas as versões do cliente, drivers e permissões do Windows. Ao fechar o painel, o monitor encerra e restaura as propriedades originais das janelas, para não deixar o cliente inacessível.

Cada tentativa fica registrada em `sign-in.log`, na pasta de dados (sem usuário nem senha).

## Onde ficam os dados

`%APPDATA%\riot-account-manager\data.json` (botão **Data folder**). Inclusões, exclusões, edições de contas e mudanças de configurações guardam uma cópia em `backups\` (as 30 mais recentes); atualizações de elo e horários de abertura não geram cópias extras. Se o `data.json` sumir ou corromper, o painel abre com o backup mais novo. `data.log` registra as gravações. Só uma cópia do painel roda por vez: abrir de novo traz a janela que já está aberta. As senhas, chaves e sessões ficam criptografadas com a proteção de dados do Windows (DPAPI): só o seu usuário do Windows nesta máquina consegue abri-las. Sessões usam gravação atômica para preservar a cópia anterior em caso de falha. Copiar o arquivo para outro PC não leva as senhas junto.

## Recursos

- Abas LoL / TFT / VALORANT, cada uma com o visual do seu cliente.
- Filas: Solo/Duo e Flex (LoL), Ranked e Double Up (TFT), Competitive (VALORANT).
- Distribuição de elos na barra lateral; clique num elo para filtrar.
- Busca (Ctrl+F), filtro de região, ordenação por elo, nome, nível, última partida ou win rate, visão em grade ou lista.
- Banimento com contagem regressiva, elo da temporada passada, nota livre, fixar no topo.
- Copiar usuário e senha (a senha some da área de transferência depois de 20 s).
- Modo streamer: borra os nomes de usuário.
- Atalhos: Ctrl+N nova conta, Ctrl+1/2/3 troca de jogo, F5 atualiza elos, duplo clique edita.

## Limitações conhecidas

- O preenchimento de compatibilidade depende da posição dos campos na janela. Se a Riot mudar o layout, `src/login.ps1` pode precisar de ajuste. O caminho direto não usa essas posições.
- A API da Riot não informa elo da temporada passada nem banimentos; esses campos são manuais (o do VALORANT vem da HenrikDev quando disponível).
- Usar ferramentas que automatizam o Riot Client é uma zona cinzenta nos termos da Riot. O app não mexe nos jogos nem no Vanguard, só digita no cliente como você faria, mas o risco é seu.

## Desenvolvimento

- `main.js`: janela Electron e IPC.
- `src/store.js`: contas e configurações (criptografia via `safeStorage`).
- `src/riotApi.js`: elo pela Riot API e HenrikDev.
- `src/riotClient.js`, `src/riotProcess.js`, `src/riotTransport.js` e `src/riotAuthentication.js`: serviços sem interface, conexão HTTPS local e autenticação direta.
- `src/login.ps1`: preenchimento de compatibilidade quando a API de login estiver indisponível.
- `src/signInFlow.js`: sequência de autenticação, verificação da conta, cancelamento e abertura do jogo.
- `src/windowController.js` + `src/windowGuard.ps1`: monitor persistente das janelas Riot, comandos e recuperação.
- `renderer/`: interface (HTML/CSS/JS sem build).
- `npm run preview`: abre a interface no navegador com contas de exemplo em <http://localhost:5178>.
- `npm test`: testes de login, monitor, armazenamento e integração, sem autenticar contas reais. Os testes de comunicação local e DPAPI usam os recursos reais do Windows com dados sintéticos.
- `ANALISE.md`: melhorias implementadas, limitações e próximas prioridades.
- `src/signInService.js`: serviço de login compartilhado entre o gerenciador e o painel do Riot.
- `src/clientIntegration/`: painel, ponte restrita e ferramenta de leitura/preparação ASAR.
- `scripts/prepare-private-riot-host.js`: prepara a cópia privada da interface sem alterar a instalação Riot.
- `npm run integration:probe-private`: verifica a interface e a conexão com o gerenciador, usando os serviços Riot já abertos, sem login/logout ou abertura de jogo.
- `scripts/prepare-riot-integration.js` e `scripts/install-riot-integration.ps1`: ferramentas do experimento anterior de substituição do pacote instalado. Não são usadas pelo atalho atual.

A ponte e o modo de bandeja são habilitados ao abrir o atalho integrado com uma cópia preparada ou quando uma integração instalada compatível for detectada. A abertura normal preserva o comportamento do gerenciador. A cópia privada usa um perfil separado e exige nova validação após mudanças no cliente Riot.
