---
tipo: decisão
status: proposta
data: 2026-11-20
tags: [adr, segurança, rede, chat]
---

# ADR-039 Aparecer offline pelo chat da Riot

## Contexto

Pedido do usuário em 2026-11-20: "quero adicionar a funcionalidade de ficar offline", depois do [[Estudo - Gerenciadores no GitHub]], onde Riot Relay e lost-league-manager oferecem isso no estilo do Deceive.

A Riot não tem opção oficial de aparecer offline. O jeito conhecido é o do [Deceive](https://github.com/molenzwiebel/Deceive) (GPL-3.0), lido em 2026-11-20 só para entender o mecanismo:

1. Abre o Riot Client com `--client-config-url=http://127.0.0.1:<porta>`, um servidor de configuração local que repassa os pedidos ao da Riot e troca, na resposta, `chat.host`, `chat.port` e `chat.affinities` pelo endereço local.
2. Atende a conexão do chat (XMPP sobre TLS) no lugar do servidor da Riot e abre a sua própria conexão TLS até o servidor real.
3. Repassa tudo e reescreve só a presença global que sai do cliente (`<presence>` sem `to`): `show` e o estado do jogo viram `offline` ou `mobile`. Conversas, lobby e seleção de campeão continuam.

Para o TLS local, o Deceive usa um domínio dele que aponta para `127.0.0.1` e um certificado válido desse domínio, baixado de um servidor dele (a chave privada é pública de propósito). A configuração pública da Riot não mostra as chaves do chat (conferido em 2026-11-20); elas só vêm na configuração da conta logada.

Segundo o README do Deceive, a Riot confirmou que não bane por ele, mas que pode parar de funcionar a qualquer momento. Não há garantia formal.

## Decisão (proposta; o usuário aceitou os riscos em 2026-11-20 e falta escolher o certificado)

O Eclipse ganha "Aparecer offline", com implementação própria em Rust (sem código do Deceive):

- Com a opção ligada, o Eclipse abre a Riot com o servidor de configuração local. Ligar com a Riot já aberta exige reabri-la.
- Dois servidores só em `127.0.0.1`, em portas aleatórias: o de configuração (HTTP) e o do chat (TLS).
- A configuração vai ao servidor da Riot por HTTPS com validação, e só as chaves do chat mudam.
- O chat sobe ao servidor real por TLS com validação. Só a presença global é reescrita; o resto passa sem mudar.
- Nada do chat nem da configuração vai para log: cabeçalhos, tokens, mensagens e lista de amigos ficam só em memória, de passagem.
- Na bandeja e nos cartões, escolha entre Online, Offline e Celular, que vale na hora com a Riot aberta pelo Eclipse.

O certificado do chat local é o ponto em aberto (alternativas abaixo).

## Alternativas consideradas

- **Certificado próprio de um domínio do usuário que aponta para `127.0.0.1`**, renovado pelo Let's Encrypt e baixado pelo Eclipse, como o Deceive. Funciona com certeza, mas exige domínio pago, renovação automática a cada 60 a 90 dias e um lugar para publicar. A chave fica pública: numa rede com DNS falsificado, alguém poderia receber a conexão do chat. O Eclipse conferiria que o nome resolve para `127.0.0.1` antes de abrir a Riot.
- **Certificado gerado na máquina com `chat.allow_bad_cert.enabled`, ou `chat.use_tls.enabled` desligado.** O usuário escolheu testar este primeiro, por ser de graça. Descartado sem teste em 2026-11-20: desde 2026-03-30 o Riot Client ignora essas chaves e fixa os valores no código. O Deceive quebrou para todos nesse dia (issues #288 e #291) e voltou na 1.17.0, em 2026-04-03, com o domínio próprio (commit `474f07e1`, que tirou o `allow_bad_cert`). O usuário tinha combinado partir para o domínio próprio se este não servisse.
- **Raiz própria no repositório de certificados do usuário no Windows**, assinando um certificado para `localhost`. Seria de graça e sem chave pública, mas só serve se o Riot Client confiar no repositório do Windows em vez de uma lista própria, o que não se sabe. E instalar uma raiz confiável no Windows é um risco maior que o do chat.
- **Usar o domínio e o certificado do Deceive.** Recusada: depende de um servidor de terceiros, sem autorização, que pode mudar ou sumir.
- **Não fazer.** O recurso é um dos mais pedidos nesse tipo de app.

## Consequências

- Muda a regra "O Eclipse não abre porta de rede" em [[Segurança e privacidade]]: passam a existir duas portas locais enquanto a Riot está aberta com a opção ligada.
- O Eclipse passa a ver, de passagem, o token do chat e as conversas. Nada é gravado, e isso vira regra nova na nota de segurança.
- A Riot passa a ser aberta com um argumento a mais ([[riotProcess]]), e a configuração dela passa pelo Eclipse.
- Amigos não conseguem convidar quem está offline; quem está offline convida normalmente.
- Uma atualização da Riot pode quebrar o recurso. Sem o Eclipse rodando, a Riot aberta por ele perde o chat até ser reaberta.
- [[ADR-003 Sem contornar CAPTCHA ou 2FA]] não muda: o login não passa pelo chat.

## Relacionado

- [[Arquitetura]] · [[Segurança e privacidade]] · [[riotProcess]] · [[signInFlow]] · [[Estudo - Gerenciadores no GitHub]]
