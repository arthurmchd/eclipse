---
tipo: guia
tags: [uso]
---

# Como usar

## Abrir

No modo padrão atual, os cartões aparecem automaticamente sobre a arte à direita do cliente oficial. Use Entrar e jogar no cartão escolhido. Nome, nível, rank, winrate e resultados correspondem ao jogo escolhido pelos ícones do rodapé, ao lado da conta selecionada; as cores e o botão Jogar mudam com o jogo; no League, cada cartão mostra Solo/Duo e Flex lado a lado. O cartão **Adicionar conta** no fim da lista, o menu ⋯ de cada cartão e o ⚙ do rodapé abrem somente diálogos nessa área. O rodapé também mostra quantas contas existem e quando os elos foram atualizados; clique nesse texto para atualizar; a coluna de login permanece livre. As referências ao botão Contas abaixo descrevem a versão anterior.

- Abra `Iniciar gerenciador de contas.bat` ou execute `npm start`. O gerenciador fica na bandeja. Depois abra o Riot Client pelo atalho oficial; os cartões de contas aparecem presos à janela do Riot, acompanham quando você a move e ficam visíveis mesmo com outro programa em foco. Não exige cópia privada. O `.bat` antigo também inicia esse serviço.
- Após atualizar o código, encerre a instância antiga uma vez pelo menu da bandeja para carregar a atualização.
- Na janela Riot, use **Contas** para abrir o gerenciamento completo. O acesso fica disponível tanto na tela de login quanto na página inicial de uma sessão conectada.

Só uma cópia do serviço roda por vez. Abrir novamente reutiliza a instância existente. Não há janela independente do gerenciador; **Voltar ao Riot** fecha somente a visualização de contas, mantendo o serviço e as operações em segundo plano.

## Primeiros passos

1. Dentro de **Contas**, abra as configurações e informe as chaves de API ([[Visão geral#Fontes de dados]]).
2. Adicione a conta com Riot ID (pode colar `Nome#TAG`), servidor, usuário e senha.
3. Escolha o jogo e use **Play** na visualização completa. O seletor rápido antigo existe somente no modo privado (`npm run start:private`).

Os filtros, elos, notas, banimentos, favoritos, cópia, sessões salvas e atualização de elos ficam na visualização completa, dentro da janela Riot.

## Login sem digitar

No modo sobreposto atual, o Riot permanece aberto com indicador de carregamento após Play. A troca usa o serviço local sem reiniciar a interface para restaurar uma sessão. Confirme eventuais verificações na tela nativa. Quando a janela do jogo abrir, o gerenciador solicita fechar a janela Riot. Erro ou cancelamento mantém o cliente aberto. O fluxo oculto descrito abaixo permanece no modo privado anterior.

Na primeira vez que uma conta usa Play, o app tenta o login direto pelo serviço local do Riot, com "manter conectado" ativo, a menos que **Manter login** esteja desmarcado nas configurações (⚙). Durante o login, o botão Jogar vira **Cancelar**, e o gerenciador some assim que a conta entra. Se a API estiver indisponível ou pedir CAPTCHA antes da senha, usa a própria interface do Riot escondida. A sessão salva pelo Riot vira uma cópia criptografada por conta (ícone ⚡ no card).

Se a sessão expirar, o app tenta o login direto uma vez. Falhas de senha, rede ou limite de tentativas não são repetidas. Para apagar a sessão salva: menu ⋯ → **Forget saved sign-in**.

O passo a passo técnico está em [[Fluxo de login]].

## Quando o Riot pede sua ação

2FA, CAPTCHA, aceite de termos e atualizações aparecem como aviso no painel. Use **Show Riot Client** para abrir a janela certa (a que contém o desafio) e concluir. Depois da autenticação, o monitor volta a esconder o cliente. **Cancel** interrompe o fluxo, mas não desfaz um jogo que já recebeu o pedido de abertura.

## Preferências que afetam o Riot Client

As preferências e chaves continuam nas configurações da visualização de contas. O fluxo integrado mantém o Riot oculto durante o login, independentemente das preferências antigas de janela separada. O acesso manual ao cliente para verificação continua disponível.


## Onde estão meus dados

`%APPDATA%\riot-account-manager\` (botão **Data folder**). Detalhes em [[Armazenamento e dados]].
