---
tipo: guia
tags: [suporte]
---

# Solução de problemas

Primeiro passo sempre: botão **Data folder** e abra `sign-in.log` (login) ou `data.log` (gravações). Nenhum dos dois contém usuário ou senha.

## O Riot Client sumiu e não volta

- No gerenciador: **Show Riot Client**, ou **Settings** → recuperação manual.
- Na bandeja: **Open Riot Client**.
- Fechar o app (bandeja → **Quit**) encerra o monitor e restaura as janelas ([[windowController]]).

## Login pede intervenção

2FA, CAPTCHA, termos ou atualização. Clique em **Show Riot Client**: ele abre a janela que contém o desafio. O app não repete a senha sozinho ([[ADR-003 Sem contornar CAPTCHA ou 2FA]]).

## "The Riot Client window did not open"

O login direto pela API pediu o formulário nativo (normalmente por CAPTCHA antes da senha), e a interface oficial do Riot não apareceu. Até 2026-10-26 isso acontecia sempre que os serviços estavam em `--headless`; o [[riotInterface]] corrige. Se voltar a acontecer, procure no `sign-in.log` a linha logo antes do erro:

- "opened the Riot interface through the background service": a interface abriu, mas o formulário não foi encontrado; veja [[login.ps1]].
- "restarting it with the interface" seguido de erro: os serviços não reiniciaram com interface; anote o horário e veja os logs do Riot em `%LOCALAPPDATA%\Riot Games\Riot Client\Logs`.

## O `sign-in.log` parece parado

Ferramentas rodando dentro de um app empacotado do Windows (como o Claude Desktop) podem ver uma **cópia antiga** de `%APPDATA%\riot-account-manager\`. O Windows redireciona essa pasta para `%LOCALAPPDATA%\Packages\<app>\LocalCache\Roaming\`. O app de contas, aberto pelo `.bat`, grava no arquivo real. Para ler o arquivo real de dentro dessas ferramentas, use `\\localhost\C$\Users\<usuário>\AppData\Roaming\riot-account-manager\sign-in.log`. No Explorer comum, o botão **Data folder** já mostra o arquivo certo.

## "The game did not open"

O login funcionou, mas nenhuma janela visível do jogo apareceu. Normalmente o jogo precisa de atualização: abra o Riot Client e confira.

## Sessão salva parou de funcionar

O app tenta o login direto uma vez. Se continuar falhando: menu ⋯ → **Forget saved sign-in** e jogue de novo para criar uma sessão nova.

## Elos não atualizam

- A chave de desenvolvimento da Riot expira a cada 24 h. Registre uma *Personal API Key*.
- O TFT pode exigir chave própria (campo **Riot API key for TFT**).
- VALORANT depende da HenrikDev.
- Uma consulta presa ou uma chave ilegível pode travar a atualização ([[Backlog]], itens 4 e 5). Feche e abra o app.

## Contas sumiram

1. Feche o app.
2. Em `%APPDATA%\riot-account-manager\backups\`, copie o `data-*.json` mais novo sobre `data.json`.
3. Abra o app. Se `data.json` estiver corrompido, o app já faz isso sozinho e preserva o arquivo ruim.

Backups só abrem no mesmo usuário Windows ([[ADR-002 Segredos protegidos pelo DPAPI]]).

## "Não foi possível abrir o Riot com Minhas Contas"

A cópia privada está ausente, desatualizada ou não passou na verificação. Veja [[Atualização do Riot Client]]. O gerenciador normal continua disponível.

## O atalho abre a instância antiga

Só uma cópia roda por vez. Depois de atualizar o código: bandeja → **Quit** e abra de novo.
