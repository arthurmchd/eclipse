---
tipo: módulo
arquivo: src-tauri/src/riot/riot_transport.rs
camada: riot
testes: src-tauri/tests/riot/riot_transport.rs
tags: [módulo]
---

# riotTransport

> Cliente HTTPS mínimo para a API local do Riot Client, usado só pelo processo do Eclipse.

## Responsabilidade

- Faz uma requisição por chamada a `127.0.0.1`, na porta e com a senha do lockfile.
- Verifica o TLS com o certificado raiz da instalação do Riot.
- Devolve `Response { status, json }` para qualquer status HTTP. Quem interpreta o status é o chamador.
- Desde a 2.29.0 reaproveita a conexão só nos `GET` ([[ADR-051 Certificado guardado e conexão reaproveitada na API local]]). Pedidos que mudam a Riot usam conexão própria e nunca são repetidos. Não conhece rotas específicas.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `RiotTransport::for_riot_client(caminho, conexão, bytes)` | construtor | O transporte real: o caminho do `RiotClientServices.exe` (para achar o certificado, pelo `cached_backend_certificate` do [[backend]]), a leitura do lockfile (`read_backend` sem outra), um `TlsClient` próprio e o limite do corpo |
| `RiotTransport::new(caminho, conexão, certificado, https, bytes)` | construtor | Com tudo trocável para os testes; `https` é a trait `HttpsClient`, e a real é o `TlsClient` |
| `TlsClient::default()` | construtor | O cliente HTTPS real, com o agente dos `GET` guardado |
| `reuses_connection(método)` | função | `true` só para `GET` |
| `AgentCache<T>` | struct | Guarda um agente para um certificado e uma porta; `get(ca, porta, montar)` devolve o guardado ou monta outro e descarta o antigo. Montagem que falha não fica guardada |
| `request(método, caminho, corpo, prazo, cancel)` | método | Da trait `LocalApi`. Devolve `Response`; `json` é `null` sem corpo ou com JSON inválido. `get` usa o prazo padrão de 4 s |
| `DEFAULT_MAX_BYTES` | constante | 1 MiB |
| `FAILED` | constante | O texto genérico de falha |

## Dependências

- Usa: [[backend]] (`read_backend`, `read_backend_certificate`, que usa [[asar]]), `ureq` e `native-tls`.
- Usado por: [[riotClient]] (como API local), que o entrega a [[riotAuthentication]], ao [[signInFlow]], ao [[riotAppControls]] e ao [[riotInterface]]. Desde 2026-11-08 o [[riotClient]] monta mais dois para o [[gameRanks]]: um lendo o `lockfile` do cliente do LoL, outro com 8 MiB para a lista de presenças do chat. Os dois usam o mesmo certificado e a validação ligada.

## Comportamento

- Rejeita antes de conectar: `signal` já abortado ("Sign-in cancelled"); caminho que não começa com `/` ou contém CR, LF ou NUL ("Invalid local Riot request").
- Opções HTTPS: `hostname: '127.0.0.1'`, `port` do lockfile, `ca` do Riot, `rejectUnauthorized: true`, `auth: 'riot:<token>'`, `Content-Type: application/json`, `timeout`.
- Corpo: `JSON.stringify(body)`, exceto `undefined` ou `null`.
- Resposta acima de `maxBytes`: falha e destrói o stream. `error` ou `aborted` na resposta: falha.
- Erro de rede, timeout, lockfile ausente ou certificado ilegível: "The local Riot service could not complete the request".
- Cancelamento durante a requisição: rejeita com "Sign-in cancelled" e destrói a requisição.
- Uma flag `settled` garante uma única resolução. Resposta tardia é drenada com `res.resume()`.

## Invariantes e decisões

- **Só o processo principal usa este transporte.** Dados de conexão e corpos de resposta nunca viram erro no renderer nem argumento de processo.
- **Mensagens genéricas.** Nenhum erro carrega porta, token, caminho do lockfile ou texto da resposta.
- **TLS sempre verificado.** A única raiz confiável é o `root.pem` da própria instalação da Riot, tirado do `app.asar`; as raízes do Windows ficam desligadas, e não há opção para desligar a validação. Sem redirecionamento.
- **Só loopback.** O host é fixo. Caminhos absolutos (`https://...`) e quebras de linha são recusados, o que impede trocar o destino ou injetar cabeçalhos.
- **Status não é erro.** 404, 429 ou 500 chegam como `{ status, json }`. A decisão fica com [[riotAuthentication]] e [[riotClient]].
- **Limite de tamanho.** Uma resposta grande demais nunca é entregue pela metade.
- **Cancelamento.** Com cancelamento, o pedido roda numa thread e o chamador confere o cancelamento a cada 25 ms; a thread termina sozinha no prazo do pedido.
- **Conferido na Riot real.** Em 2026-11-14, com permissão do usuário: um único `GET` do sinalizador de segundo plano ([[riotAppControls]]) voltou 200, com o TLS do Windows aceitando o certificado da Riot em `127.0.0.1` e a validação ligada. O teste é o `the_real_riot_client_certificate_is_accepted_on_a_single_read`, marcado com `#[ignore]`: roda só a pedido, com a Riot aberta pelo usuário (`cargo test --test riot the_real_riot_client_certificate -- --ignored --nocapture`), e imprime só o status.
- **Certificado guardado e conexão reaproveitada (2026-11-24, 2.29.0, [[ADR-051 Certificado guardado e conexão reaproveitada na API local]]).** Pedido do usuário: aplicar as otimizações do relatório de desempenho ([[Medição de CPU e memória]]). Com a Riot no login, a 2.28.4 abria o `app.asar` e fazia uma conexão TLS nova a cada pedido: umas 2,7 por segundo e cerca de 320 conexões em TIME_WAIT.
  - **Certificado.** Vem do `cached_backend_certificate` do [[backend]], que só relê o `app.asar` quando o tamanho ou a data dele mudam.
  - **Lockfile.** Continua lido a cada pedido. A senha não fica guardada entre pedidos.
  - **`GET`.** O `TlsClient` guarda um agente do `ureq` por certificado e porta (`AgentCache`), com uma conexão ociosa. O prazo vai em cada pedido (`Request::timeout`), não no agente. Se a Riot fechou a conexão guardada, o `ureq` 2.12 percebe antes de usá-la ou, se ela cair antes de qualquer resposta, manda o mesmo `GET` uma vez por uma conexão nova. É a única repetição.
  - **Outros métodos.** `POST`, `PUT`, `PATCH` e `DELETE` montam um agente sem conexões guardadas (`max_idle_connections(0)`), como antes: conexão nova, nunca reaproveitada, nunca repetida.
  - **TLS igual.** Toda conexão nova passa pela mesma validação: só o `root.pem` da Riot, raízes do Windows desligadas, sem redirecionamento.
  - **Conferido.** Pelos testes do `AgentCache` e do `reuses_connection`, e com o `TlsClient` copiado para um servidor TLS local de teste, fora do repositório, sem a Riot: cinco `GET` seguidos usaram uma conexão; cada `POST`, `PUT` e `DELETE` abriu a sua; o `GET` seguinte voltou à conexão guardada; uma conexão fechada pelo servidor foi trocada sem erro; trocar de porta abriu conexão nova; um servidor com certificado de outra raiz foi recusado. Na Riot real, a contagem de conexões em TIME_WAIT depois de instalar fica registrada na [[Medição de CPU e memória]].
- **Falha de envio com tipo próprio (2026-11-21).** `HttpsClient::send` devolve `Result<(status, corpo), SendFailure>`. Antes o erro era `()`, que o clippy recusa em função pública (`result_unit_err`) e que a CI roda com `-D warnings`. A falha continua sem detalhe nenhum: a mensagem que sai é o texto fixo de sempre.

## Testes

`src-tauri/tests/riot/riot_transport.rs`:
- JSON enviado à porta da Riot em `127.0.0.1`, com o certificado e o token dela.
- Resposta vazia ou ilegível chegando como `null`.
- Cancelamento antes de iniciar (nenhuma requisição) e durante (para na hora).
- Erros de rede genéricos.
- Lockfile ausente e caminhos inválidos sem requisição e sem expor o lockfile.
- Só `GET` reaproveitando conexão; um agente por certificado e porta, trocado quando um dos dois muda, e montagem com falha sem ficar guardada.
- O teste manual contra a Riot real, que só roda a pedido.

## Pontos de atenção

- **Leitura a cada chamada.** O lockfile ainda é lido em toda requisição, de propósito. O `root.pem` só é relido quando o `app.asar` muda (desde a 2.29.0).
- **Conexão ociosa aberta.** Cada transporte pode deixar uma conexão ociosa com o serviço local: Riot Client, presenças e cliente do League. Ela fecha quando a Riot fecha a dela, quando a porta muda ou quando o Eclipse sai.
- **JSON inválido some.** Corpo malformado vira `json` `null`, igual a corpo vazio. O chamador não distingue os dois casos.
- **Certificado depende do layout da instalação.** `RiotClientElectron/resources/app.asar` e `dist/main/root.pem` podem mudar numa versão nova: [[Atualização do Riot Client]].
- Visão geral do serviço local: [[Integração com o Riot Client]].
