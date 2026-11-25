---
tipo: decisão
status: aceita
data: 2026-11-24
tags: [adr, riot, segurança, desempenho]
---

# ADR-051 Certificado guardado e conexão reaproveitada na API local

## Contexto

Em 2026-11-24 o usuário pediu otimizações de processador e memória e depois mandou aplicar as quatro primeiras do relatório ([[Medição de CPU e memória]]). A primeira é o [[riotTransport]], que a cada pedido à API local da Riot abria o `app.asar` oficial para tirar o `root.pem` e fazia uma conexão TLS nova.

Medido na 2.28.4 instalada, com a Riot visível no login: umas 2,7 conexões novas por segundo e cerca de 320 conexões em TIME_WAIT no Windows. No benchmark, por pedido: 2,55 ms de processador e 1,17 MB alocados para ler o certificado, e 7,4 ms (2,1 ms de processador) para a conexão nova, contra 0,07 ms com a conexão reaproveitada.

A nota do módulo dizia "não tenta de novo, não guarda conexão". A regra vinha do transporte em Node e protegia os pedidos que mudam o estado da Riot (login, configurações, o `DELETE` da sessão) de serem repetidos sem querer. O reaproveitamento de conexões já estava no item 4 do [[Backlog]].

## Decisão

- **Certificado lido só quando o `app.asar` muda.** O [[backend]] guarda o `root.pem` junto com o caminho, o tamanho e a data de modificação do `app.asar`. Cada pedido confere esses três valores, sem abrir o pacote; qualquer diferença lê de novo. Falha de leitura não fica guardada.
- **Lockfile lido a cada pedido, como antes.** Porta e senha continuam frescas em toda chamada, e a senha não fica guardada entre um pedido e outro.
- **Só `GET` reaproveita a conexão.** Cada transporte guarda um agente do `ureq` para a combinação de certificado e porta, com uma conexão ociosa. Certificado ou porta diferentes criam outro agente, e o antigo é descartado com a conexão dele.
- **`POST`, `PUT`, `PATCH` e `DELETE` não mudam.** Cada um abre uma conexão nova que não volta para nenhum agente, e nenhum é repetido.
- **A única repetição é de leitura.** Se a Riot fechou a conexão guardada enquanto ela esperava, o `ureq` manda o mesmo `GET` uma vez por uma conexão nova. Ele só faz isso quando a conexão caiu antes de qualquer resposta, e o `ureq` 2.12 também confere se o outro lado já fechou antes de usar a conexão guardada.

## Alternativas consideradas

- **Deixar como estava:** o custo era pequeno por pedido, mas se repetia a cada 750 ms com a Riot no login e a cada leitura de elo.
- **Reaproveitar a conexão em todos os métodos:** o `ureq` repete sozinho `PUT` e `DELETE` numa conexão guardada que caiu, e até um `POST` cujo cabeçalho não chegou a ser escrito. Os pedidos que mudam o estado da Riot não podem ser repetidos sem o Eclipse decidir.
- **Guardar também o lockfile:** deixaria a senha da Riot na memória entre pedidos e exigiria perceber quando a Riot reinicia. Ler um arquivo pequeno custa pouco.
- **Trocar de biblioteca HTTP:** o `ureq` 2 já tem o agente com conexões guardadas.

## Consequências

- Com a Riot no login, cada consulta do estado de login cai de uns 4,7 ms de processador para perto de 0,1 ms (benchmark), e as conexões em TIME_WAIT de centenas para poucas.
- Fica aberta até uma conexão ociosa por transporte: Riot Client, lista de presenças e cliente do League. Ela fecha quando a Riot fecha a dela, quando a porta muda ou quando o Eclipse sai.
- A validação do TLS não muda: a única raiz é o `root.pem` da Riot, as raízes do Windows continuam desligadas e não há redirecionamento. Toda conexão nova passa por essa validação. Uma conexão reaproveitada é a mesma conexão TCP já validada com o mesmo processo, que outro programa não consegue assumir.
- Se a Riot trocasse o `root.pem` sem mudar tamanho nem data do `app.asar`, o certificado guardado ficaria velho e os pedidos falhariam com a mensagem genérica até o Eclipse reiniciar. Uma atualização da Riot substitui o arquivo, o que muda a data.
- O teste contra a Riot real (`the_real_riot_client_certificate_is_accepted_on_a_single_read`) continua valendo e só roda a pedido.

## Relacionado

- [[riotTransport]]
- [[backend]]
- [[Segurança e privacidade]]
- [[Medição de CPU e memória]]
- [[Arquitetura]]
