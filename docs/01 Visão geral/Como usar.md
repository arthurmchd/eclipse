---
tipo: guia
tags: [uso]
---

# Como usar

## Abrir

Os cartões aparecem automaticamente sobre a arte à direita do cliente oficial. Use Entrar e jogar no cartão escolhido. Nome, nível, rank, winrate e resultados correspondem ao jogo escolhido pelos ícones do rodapé, ao lado da conta selecionada; as cores e o botão Jogar mudam com o jogo; no League, cada cartão mostra Solo/Duo e Flex lado a lado. O botão **+** no início do rodapé (adicionar conta), o menu ⋯ de cada cartão e o ⚙ do rodapé abrem somente diálogos nessa área. O rodapé também mostra quantas contas existem e quando os elos foram atualizados; o ↻ ao lado atualiza. Para usar o perfil da Riot, marque "Ocultar contas"; a coluna de login permanece livre.

- **Instalado (desde 2026-11-08):** rode `Eclipse Setup <versão>.exe`, gerado por `npm run dist` ([[Desenvolvimento]]). Ele instala na sua conta do Windows, sem pedir administrador, cria os atalhos "Eclipse" no menu Iniciar e na Área de Trabalho e abre o Eclipse no fim. Na primeira vez, o Windows pode avisar que o app não é reconhecido, porque ele não é assinado: **Mais informações** → **Executar assim mesmo**. Depois, abra pelo atalho; o Eclipse fica na bandeja. As contas são as mesmas do `npm start`.
- **Iniciar com o Windows:** no app instalado, clique com o botão direito no ícone da bandeja e marque **Iniciar com o Windows**. Vem desmarcado. Marcado, o Eclipse abre na bandeja quando você entra no Windows, sem abrir a Riot. Desmarque no mesmo lugar.
- **Atualizar o instalado:** saia pela bandeja (**Sair**) e rode o Setup novo. Ele instala por cima e mantém contas e configurações. Para remover, use "Aplicativos instalados" do Windows; as contas continuam em `%APPDATA%\riot-account-manager\`.
- **Do projeto:** abra `Iniciar gerenciador de contas.bat` ou execute `npm start`. O gerenciador fica na bandeja. Depois abra o Riot Client pelo atalho oficial; os cartões de contas aparecem presos à janela do Riot, acompanham quando você a move e ficam visíveis mesmo com outro programa em foco. `Abrir Riot com minhas contas.bat` faz o mesmo e instala as dependências na primeira vez.
- Após atualizar o código, encerre a instância antiga uma vez pelo menu da bandeja para carregar a atualização.
- Pela bandeja, **Contas no Riot** abre a Riot oficial com os cartões, e **Abrir Riot Client** abre só a Riot.

Só uma cópia do serviço roda por vez. Abrir de novo reutiliza a instância existente e abre a Riot com os cartões. Não há janela própria do gerenciador: tudo fica nos cartões sobre a Riot.

## Primeiros passos

1. No ⚙ do rodapé dos cartões, informe as chaves de API ([[Visão geral#Fontes de dados]]).
2. Adicione a conta com Riot ID (pode colar `Nome#TAG`), servidor, usuário e senha.
3. Escolha o jogo pelos ícones do rodapé e use **Jogar**.

Para editar ou remover uma conta, use o menu ⋯ do cartão.

## Login sem digitar

A primeira entrada de cada conta é visível: o Riot permanece aberto após Play e o Eclipse preenche o formulário da Riot. Enquanto isso, a coluna de login fica em branco, só com um carregamento, e a caixa "Ocultar contas" some. No login manual, ela some quando você clica em entrar. Nos dois casos, ela volta junto com o formulário da Riot (senha errada, por exemplo). Se a Riot pedir 2FA ou outra verificação, a coluna volta a aparecer: confirme na tela nativa. Quando a janela do jogo abrir, o gerenciador solicita fechar a janela Riot. Erro ou cancelamento mantém o cliente aberto.

Com **Manter login** ligado (⚙), o Eclipse guarda a sessão de cada conta. Das próximas vezes, Play fecha a janela da Riot e entra em segundo plano: a próxima tela é a do jogo. Nada é digitado, e nem a Riot nem o Eclipse precisam ficar em primeiro plano. Se a Riot não aceitar a sessão guardada, a janela dela volta e o login visível segue como na primeira vez.

Com o Eclipse aberto, a Riot sempre abre desconectada, na tela de login com os cartões. O Eclipse guarda a sessão da conta e tira o "lembrar" do arquivo da Riot assim que ela solta a conta. Isso também vale para contas que não estão no Eclipse. A exceção é durante um jogo: a Riot aberta mostra a conta conectada, porque o jogo depende dela. Poucos segundos depois que o jogo fecha, ela volta a abrir desconectada. Se você abriu a Riot enquanto o jogo fechava, ela mostra a conta por alguns segundos, fecha e volta sozinha na tela de login.

Para a sessão continuar valendo:

- deixe **Manter login** ligado; desligado, todo login volta a ser visível;
- não saia da conta pelo menu da Riot: isso encerra a sessão no servidor, e a próxima entrada daquela conta volta a ser visível uma vez;
- uma conta sem sessão guardada (nova, esquecida, recusada ou com sessão de antes de 2026-11-06, que o Eclipse apaga ao iniciar) faz um login visível uma vez, direto na Riot aberta, e daí em diante entra em segundo plano;
- depois de uma entrada em segundo plano, um clique no ícone da Riot na bandeja abre a Riot. A janela aparece uns 3 a 5 s depois, porque o Eclipse espera a Riot sair do segundo plano. Com o Eclipse fechado, são dois cliques;
- feche o LoL com **Exit**, não com **Sign Out**: Sign Out encerra a sessão, e o próximo Jogar dessa conta pede o login visível de novo (senha e, se a conta tiver, 2FA). O mesmo vale para sair da conta pela Riot.

Ver [[ADR-020 Riot conectada é encerrada quando fica sem jogo]] e [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]].

Durante o login, o botão Jogar vira **Cancelar**, e os cartões somem assim que a conta entra. Falhas de senha, rede ou limite de tentativas não são repetidas.

O passo a passo técnico está em [[Fluxo de login]].

## Quando o Riot pede sua ação

2FA, CAPTCHA, aceite de termos e atualizações aparecem na própria janela da Riot: a coluna de login volta a aparecer e você conclui ali. Se a janela sumir, **Abrir Riot Client** na bandeja a traz de volta. **Cancelar** (nos cartões ou **Cancelar login** na bandeja) interrompe o fluxo, mas não desfaz um jogo que já recebeu o pedido de abertura.

## Configurações

O ⚙ tem idioma, **Manter login**, as chaves de API e o intervalo de atualização dos elos. As opções antigas de esconder, fechar e minimizar o Riot e o modo streamer saíram em 2026-11-07 ([[ADR-028 Modo antigo removido]]): a Riot fica visível no login e é fechada quando o jogo abre.

## Onde estão meus dados

`%APPDATA%\riot-account-manager\`. Detalhes em [[Armazenamento e dados]].
