# Minhas contas na interface de login do Riot

O atalho **Abrir Riot com minhas contas.bat** abre uma cópia privada da interface real do Riot Client, hospedada pelo Electron do projeto e conectada aos serviços oficiais locais da Riot. O painel **MINHAS CONTAS** aparece junto do formulário inicial de login. A instalação original do Riot permanece intacta.

Este é um modo experimental para os pacotes de interface **141.0.0 e 142.0.0**. A instalação atual usa o pacote 142.0.0 e exibe **v142.0.1** no rodapé do login. Não é uma extensão carregada pelo executável original do Riot nem um plugin do Rose/Pengu. A cópia é preparada a partir da instalação desta máquina e fica dentro do projeto.

## Como usar nesta máquina

1. Após atualizar o código do projeto, encerre a instância anterior para carregar a atualização. Quando houver ícone na bandeja, use **Quit**. Com o código atual carregado, o atalho integrado também funciona quando o gerenciador normal já está aberto.
2. Abra **Abrir Riot com minhas contas.bat**. A cópia privada já está preparada neste projeto.
3. Na tela de login, expanda **MINHAS CONTAS**, selecione uma conta e o jogo e pressione **Entrar e jogar**. Cadastre ou edite as contas pelo botão **Gerenciar contas**.
4. O gerenciador oculta a interface e executa o login em segundo plano. Reaproveita uma sessão atual verificada; quando precisa reiniciar o backend para trocar sessões, usa `--headless`. A autenticação direta evita reabrir a janela para digitar quando a Riot permite esse caminho. Um CAPTCHA anterior ao envio da senha usa o renderer nativo escondido. Quando o jogo/lobby abrir, ele será a janela visível.

Se a Riot já estiver conectada, sua página inicial será exibida, e o painel de contas ficará oculto. Para ver o seletor no formulário inicial, saia da sessão pela própria interface. O launcher não desconecta uma sessão existente apenas para mostrar o painel.

O gerenciador continua na bandeja enquanto este modo estiver ativo. Use **Open account manager** para acompanhar a operação, **Open Riot Client** para abrir a interface quando precisar e **Quit** para encerrar. Para usar somente o gerenciador normal, abra **Abrir Riot Account Manager.bat** após encerrar a instância anterior.

## O que foi validado

Uma execução real carregou a cópia da interface, confirmou o módulo no renderer e consultou com sucesso a ponte do gerenciador. A prova usou uma ponte temporária com lista vazia de contas e autenticação desabilitada. Resultado em `.client-integration/private-v1/probe-controller/result.json`:

```json
{
  "ok": true,
  "rendererReady": true,
  "managerConnected": true,
  "mode": "private",
  "authenticationTested": false
}
```

Esse teste reutilizou os serviços Riot já abertos e não realizou login, logout nem abertura de jogo. Após a atualização para 142, o gerenciador foi reaberto no modo integrado e a tela real de login foi conferida visualmente: o painel MINHAS CONTAS apareceu com as contas salvas e o botão Entrar e jogar. O fluxo completo com credenciais reais ainda precisa de validação em uso. Os testes automatizados cobrem o painel, a ponte local, o controle da cópia privada, a compatibilidade das duas versões e a promoção de uma instância normal para o modo integrado.

Para repetir apenas essa verificação de compatibilidade, com os serviços Riot já abertos:

```powershell
npm run integration:probe-private
```

Para ver uma demonstração claramente identificada, com contas fictícias e sem acesso às contas salvas:

```powershell
npm run preview:riot-login
```

## Funcionamento e proteção dos dados

- O painel envia somente o identificador da conta e o jogo escolhido ao serviço de login compartilhado. Senhas e sessões ficam no gerenciador.
- A ponte escuta apenas em `127.0.0.1`, exige autenticação, valida as mensagens e limita seu tamanho. Seu token é protegido pelo DPAPI do usuário Windows.
- A conexão de inicialização usa um canal local com nome aleatório. Credenciais de conexão não são colocadas nos argumentos do processo; o token do backend também é transmitido criptografado.
- O backend é verificado por HTTPS com o certificado da instalação Riot. A validação de certificado continua habilitada.
- A cópia usa um perfil próprio dentro do projeto. Os registros do código Riot recebem um filtro para ocultar credenciais de conexão.
- O cliente oficial é mantido em segundo plano pelo monitor de janelas existente. Janelas dos jogos e do Vanguard ficam fora desse monitor.
- Operações do seletor integrado sempre mantêm o Riot oculto, independentemente das preferências antigas do gerenciador. A interface continua acessível por ação manual na bandeja ou no gerenciador.
- Senha incorreta, erro de rede e limite de tentativas não disparam um segundo envio por digitação. O preenchimento nativo só é usado se a API estiver indisponível ou se o CAPTCHA for exigido antes de enviar a senha. Um CAPTCHA retornado após a submissão solicita intervenção; não reenvia a senha.
- A sequência de contexto ausente ou em erro segue a tela oficial: limpar o contexto, inicializar e só então submeter. A correção de `invalid_request` foi conferida no serviço real com uma sessão vazia, sem enviar credenciais. O botão de recuperação preserva a janela nativa quando ela contém o desafio.
- Uma troca iniciada pelo painel de contas é recusada se LoL/TFT/VALORANT estiverem abertos. O login é serializado para evitar operações simultâneas.

2FA, CAPTCHA e outras verificações continuam exigindo a ação normal do usuário. Erros não devem revelar automaticamente a tela de login durante o fluxo. Use o gerenciador ou a bandeja para abrir a interface e concluir uma verificação. A ausência absoluta de flashes de janelas não pode ser garantida entre versões do Windows e do Riot.

## Atualizações e preparação

O manifesto e os hashes são conferidos antes de carregar a cópia. Uma alteração na instalação original pode invalidá-la. A ferramenta não troca automaticamente arquivos Riot nem aplica a cópia a uma versão desconhecida.

Se a cópia estiver desatualizada ou não puder abrir, o gerenciador apresenta uma mensagem de erro em vez de abrir silenciosamente o cliente original. A atualização 142 exigiu adaptar o filtro de registros e a inicialização do protocolo Sentry; ambos mantêm as proteções e os handlers existentes. A cópia anterior foi preservada em `.client-integration/private-141-backup/`.

Para preparar uma cópia em um projeto novo:

```powershell
npm run integration:prepare-private
```

A ferramenta exige um destino ainda inexistente e grava apenas `.client-integration/private-v1/app.asar` e seu manifesto. Após uma atualização da Riot, a compatibilidade precisa ser revista antes de recriar esses arquivos. O pacote contém recursos proprietários da instalação local e **não deve ser distribuído** com o código do gerenciador. A pasta está no `.gitignore`.

## Arquitetura

- `src/clientIntegration/addon-*.js`: painel no formulário, preload restrito e comunicação com a ponte.
- `bridgeServer.js` e `src/signInService.js`: ponte autenticada e serviço compartilhado de login.
- `privateClient.js`, `privateHost.js` e `privateHostCore.js`: abertura, validação e controle da cópia privada.
- `bootstrapChannel.js`, `windowsDpapi.js` e `backend.js`: canal local, proteção Windows e validação do backend.
- `scripts/prepare-private-riot-host.js`: prepara a cópia privada sem alterar a instalação.
- `scripts/probe-private-riot-host.js`: verificação real sem autenticação de conta.

## Experimento anterior com o pacote instalado

Foi testada a substituição direta de três entradas de `app.asar`, com backup e hashes. Depois de abrir o cliente oficial, a instalação voltou exatamente ao pacote original e os módulos não estavam mais presentes. Não foi identificado qual componente ou condição produziu esse resultado. O hash original confirmado foi `2c5a8f20b687275fc64936911c883bd92360a794251881e6d74ab045886920fc`.

Essa abordagem não é usada pelo atalho atual. As ferramentas antigas de preparação/instalação permanecem como material experimental; o instalador recusa manifestos da cópia privada. Não é necessário restaurar o Riot: a instalação já está original.
