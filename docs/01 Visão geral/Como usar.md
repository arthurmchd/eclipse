---
tipo: guia
tags: [uso]
---

# Como usar

## Abrir

- **Gerenciador:** dois cliques em `Abrir Riot Account Manager.bat`. Na primeira vez ele instala as dependências (precisa do Node.js).
- **Login integrado:** dois cliques em `Abrir Riot com minhas contas.bat`. Exige a cópia privada preparada ([[Integração com o Riot Client]]). Após atualizar o código, encerre a instância antiga uma vez (bandeja → **Quit**).
- **Pelo terminal:** `npm start` ou `npm run start:riot-login`.

Só uma cópia do app roda por vez. Abrir de novo traz a janela que já está aberta; abrir o atalho integrado com o gerenciador já aberto promove essa instância para o modo integrado.

## Primeiros passos

1. **Settings** → cole as chaves de API ([[Visão geral#Fontes de dados]]).
2. **Add account** → Riot ID (pode colar `Nome#TAG` direto no campo de nome), servidor, usuário e senha.
3. Escolha a aba do jogo e clique em **Play**.

## Login sem digitar

Na primeira vez que uma conta usa Play, o app tenta o login direto pelo serviço local do Riot, com "manter conectado" ativo. Se a API estiver indisponível ou pedir CAPTCHA antes da senha, usa a própria interface do Riot escondida. A sessão salva pelo Riot vira uma cópia criptografada por conta (ícone ⚡ no card).

Se a sessão expirar, o app tenta o login direto uma vez. Falhas de senha, rede ou limite de tentativas não são repetidas. Para apagar a sessão salva: menu ⋯ → **Forget saved sign-in**.

O passo a passo técnico está em [[Fluxo de login]].

## Quando o Riot pede sua ação

2FA, CAPTCHA, aceite de termos e atualizações aparecem como aviso no painel. Use **Show Riot Client** para abrir a janela certa (a que contém o desafio) e concluir. Depois da autenticação, o monitor volta a esconder o cliente. **Cancel** interrompe o fluxo, mas não desfaz um jogo que já recebeu o pedido de abertura.

## Preferências que afetam o Riot Client

No gerenciador normal, em **Settings**:

- **Keep the Riot Client hidden**
- **Keep the Riot Client window hidden after the game starts**
- **Minimize this app** quando o jogo abrir

No login integrado, o Riot fica sempre oculto, independentemente dessas preferências.

## Onde estão meus dados

`%APPDATA%\riot-account-manager\` (botão **Data folder**). Detalhes em [[Armazenamento e dados]].
