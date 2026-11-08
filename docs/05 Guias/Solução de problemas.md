---
tipo: guia
tags: [suporte]
---

# Solução de problemas

Primeiro passo sempre: abra `%APPDATA%\riot-account-manager\` e veja `sign-in.log` (login) ou `data.log` (gravações). Nenhum dos dois contém usuário ou senha.

## O Riot Client sumiu e não volta

- Na bandeja: **Abrir Riot Client**, ou **Contas no Riot** para abrir com os cartões.
- Depois de uma entrada em segundo plano, a janela aparece uns 3 a 5 s depois do clique, porque o Eclipse espera a Riot sair do segundo plano ([[riotWakeup]]).

## Login pede intervenção

2FA, CAPTCHA, termos ou atualização aparecem na própria janela da Riot: a cobertura da coluna de login sai e você conclui ali. O app não repete a senha sozinho ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]). Se o prazo terminou, use **Jogar** de novo. Uma aprovação anterior não garante que uma nova tentativa dispense verificação.

## "The Riot Client window did not open"

O login visível não conseguiu abrir a interface oficial da Riot. Procure no `sign-in.log` a linha logo antes do erro:

- "opened the Riot interface through the background service": a interface abriu, mas o formulário não foi encontrado; veja [[login.ps1]].
- "restarting it with the interface" seguido de erro: os serviços não reiniciaram com interface; anote o horário e veja os logs do Riot em `%LOCALAPPDATA%\Riot Games\Riot Client\Logs`.

Ver [[riotInterface]].

## O `sign-in.log` parece parado

Ferramentas rodando dentro de um app empacotado do Windows (como o Claude Desktop) podem ver uma **cópia antiga** de `%APPDATA%\riot-account-manager\`. O Windows redireciona essa pasta para `%LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming\`. O Eclipse, aberto pelo `.bat`, grava no arquivo real. Para ler o arquivo real de dentro dessas ferramentas, use `\\localhost\C$\Users\<usuário>\AppData\Roaming\riot-account-manager\sign-in.log`. No Explorer comum, `%APPDATA%` já mostra o arquivo certo.

## "The game did not open"

O login funcionou, mas nenhuma janela visível do jogo apareceu em 3 minutos. Se o Riot avisou que o jogo precisa de atualização, o app espera até 20 min e tenta abrir o jogo de novo; o erro passa a ser "The game update did not finish in time". Nos dois casos, abra o Riot Client e confira a atualização ou a instalação.

## A conta pediu o login visível de novo

A sessão guardada foi recusada pela Riot, a conta saiu pela Riot ou pelo "Sign Out" do League, ou "Manter login" está desligado. O Eclipse apaga a sessão recusada e faz o login visível uma vez; daí em diante a conta volta a entrar em segundo plano. Ver [[Como usar#Login sem digitar]] e [[ADR-027 Saída da conta pela Riot apaga a sessão guardada]].

## Elos não atualizam

- A chave de desenvolvimento da Riot expira a cada 24 h. Registre uma *Personal API Key* e informe no ⚙ dos cartões.
- VALORANT depende da HenrikDev.
- Uma consulta presa ou uma chave ilegível pode travar a atualização ([[Backlog]], itens 4 e 5). Feche e abra o app.

## Contas sumiram

1. Feche o app.
2. Em `%APPDATA%\riot-account-manager\backups\`, copie o `data-*.json` mais novo sobre `data.json`.
3. Abra o app. Se `data.json` estiver corrompido, o app já faz isso sozinho e preserva o arquivo ruim.

Backups só abrem no mesmo usuário Windows ([[ADR-002 Segredos protegidos pelo DPAPI]]).

## O atalho abre a instância antiga

Só uma cópia roda por vez. Depois de atualizar o código: bandeja → **Sair** e abra de novo. O mesmo vale entre o Eclipse instalado e o `npm start`: o que abrir depois só pede à primeira cópia que abra a Riot com os cartões.

## O Windows avisa que o Setup não é reconhecido

O Setup e o `Eclipse.exe` não são assinados ([[ADR-030 Eclipse instalado por um Setup próprio]]). Na tela azul do SmartScreen, **Mais informações** → **Executar assim mesmo**. O aviso some depois da primeira execução daquele arquivo.

## O Eclipse instalado abriu sem contas

Ele usa `%APPDATA%\riot-account-manager\`, a mesma pasta do `npm start`. Se abriu vazio, o `package.json` do build provavelmente ganhou um `productName` no topo ou outro `name`; o `test/package.test.js` deveria ter barrado. As contas continuam na pasta antiga; não cadastre de novo, corrija o build.

## Mensagens que saíram

Até 2026-11-07 havia erros do modo privado: "Não foi possível abrir o Riot com Minhas Contas", "The background window guard stopped" e o Riot reaparecendo antes do jogo. Esse modo saiu ([[ADR-028 Modo antigo removido]]); essas mensagens não aparecem mais.
