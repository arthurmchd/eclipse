---
tipo: estudo
data: 2026-10-26
tags: [estudo, integração]
---

# Estudo - Comparação com o Rose

Análise que orientou a [[ADR-001 Cópia privada da interface do Riot]]. O resultado implementado está em [[Integração com o Riot Client]].

## Conclusão

É viável um seletor de contas dentro do lobby do League, seguindo a arquitetura do Rose e reaproveitando o motor de login do gerenciador. Isso não demonstra que o mesmo mecanismo serve para a tela de login do Riot Client: são aplicativos diferentes.

A análise considerou o projeto público [Alban1911/Rose](https://github.com/Alban1911/Rose). Não havia instalação local do Rose; a comparação é estática e não envolveu instalar Rose/Pengu.

## Comparação

| Aspecto | Este gerenciador | Rose |
|---|---|---|
| Interface | Janela Electron própria | Plugins JavaScript na interface do League, mais um programa externo |
| Função relevante | Contas, senhas criptografadas, sessões, login e abertura de produtos | Botões e painéis no League e comunicação com um serviço externo |
| Onde executa o controle | Processo principal e auxiliares Windows | Serviço Python e plugins carregados pelo Pengu Loader |
| Comunicação interna | IPC Electron e API local do Riot Client | Ponte HTTP/WebSocket local entre o League e o serviço Python |
| Tela inicial de login Riot | Controlada externamente | Nenhum mecanismo pronto para modificá-la |
| Uso antes de abrir o League | Sim | Depende do cliente League existir |

Fontes do Rose: [README](https://github.com/Alban1911/Rose#architecture), [painel de configurações](https://github.com/Alban1911/Rose/blob/main/Pengu%20Loader/plugins/ROSE-SettingsPanel/index.js), [servidor WebSocket](https://github.com/Alban1911/Rose/blob/main/pengu/core/websocket_server.py).

## O que o Rose demonstra

`ROSE-SettingsPanel` usa elementos e manipulação do DOM do League para abrir seu conteúdo dentro do cliente. `ROSE-SkinMonitor` faz a ponte com o serviço externo, que roda separado. Uma experiência visualmente integrada não exige colocar armazenamento e login dentro do processo do League.

O [core do Pengu](https://github.com/PenguLoader/PenguLoader/blob/main/core/src/dllmain.cc#L48-L73) seleciona `LeagueClientUx.exe` e `LeagueClientUxRender.exe`, e a [documentação do Pengu](https://github.com/PenguLoader/docs/blob/main/docs/guide/faqs.md) confirma o foco no League. Isso delimita o alcance da técnica; não é auditoria da versão distribuída pelo Rose.

## Alternativa estudada: contas dentro do League

1. Um plugin adiciona o botão **Contas** ao lobby.
2. O painel mostra Riot ID, elo, conta atual e se há sessão salva. Não recebe senhas, chaves nem tokens.
3. Ao escolher outra conta, envia só o identificador e o produto ao gerenciador.
4. O gerenciador devolve um identificador de operação antes de fechar o League.
5. O gerenciador faz o login, esconde o Riot Client e reabre o League na conta escolhida.
6. O plugin reaparece e reconecta para ler o resultado.

**Não implementado**: o usuário escolheu a tela de login do Riot. Partes desta proposta foram reaproveitadas no que foi construído: serviço de login compartilhado ([[signInService]]), ponte autenticada em `127.0.0.1` ([[bridgeServer]]), execução na bandeja e proteção contra troca com jogo aberto feita no serviço, não na interface. Em 2026-11-08 o Eclipse ganhou também um instalador próprio, como o do Rose ([[ADR-030 Eclipse instalado por um Setup próprio]]).

## Sobre a tela de login do Riot Client

O Riot Client usa uma interface Electron separada (`RiotClientElectron/resources/app.asar`, pacote `riot-client-ux`). Isso aproxima a tecnologia da do gerenciador, mas não cria uma interface de extensão compatível com Pengu. Alterar o pacote, embutir o cliente em outra janela ou controlá-lo de fora são abordagens distintas. A escolhida foi hospedar uma cópia privada.

2FA e CAPTCHA continuam fazendo parte da autenticação em qualquer interface. A Riot informa que a [League Client API não tem suporte oficial completo a terceiros nem garantia de estabilidade](https://developer.riotgames.com/docs/lol#league-client-api), o que torna a revalidação após atualizações parte da manutenção.
