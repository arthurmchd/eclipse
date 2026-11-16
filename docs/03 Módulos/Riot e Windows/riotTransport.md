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
- Não tenta de novo, não guarda conexão e não conhece rotas específicas.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `RiotTransport::for_riot_client(caminho, conexão, bytes)` | construtor | O transporte real: o caminho do `RiotClientServices.exe` (para achar o certificado), a leitura do lockfile (`read_backend` sem outra) e o limite do corpo |
| `RiotTransport::new(caminho, conexão, certificado, https, bytes)` | construtor | Com tudo trocável para os testes; `https` é a trait `HttpsClient`, e a real é o `TlsClient` |
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

## Testes

`src-tauri/tests/riot/riot_transport.rs`:
- JSON enviado à porta da Riot em `127.0.0.1`, com o certificado e o token dela.
- Resposta vazia ou ilegível chegando como `null`.
- Cancelamento antes de iniciar (nenhuma requisição) e durante (para na hora).
- Erros de rede genéricos.
- Lockfile ausente e caminhos inválidos sem requisição e sem expor o lockfile.
- O teste manual contra a Riot real, que só roda a pedido.

## Pontos de atenção

- **Leitura a cada chamada.** Lockfile e `root.pem` (de dentro do `app.asar`) são lidos em toda requisição. Com polling de 500 a 700 ms no [[signInFlow]], isso se repete muitas vezes por login.
- **JSON inválido some.** Corpo malformado vira `json` `null`, igual a corpo vazio. O chamador não distingue os dois casos.
- **Certificado depende do layout da instalação.** `RiotClientElectron/resources/app.asar` e `dist/main/root.pem` podem mudar numa versão nova: [[Atualização do Riot Client]].
- Visão geral do serviço local: [[Integração com o Riot Client]].
