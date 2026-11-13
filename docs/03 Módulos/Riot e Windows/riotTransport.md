---
tipo: módulo
arquivo: src/riot/riotTransport.js
camada: riot
testes: test/riot/riotTransport.test.js
tags: [módulo]
---

# riotTransport

> Cliente HTTPS mínimo para a API local do Riot Client, usado só no processo principal.

## Responsabilidade

- Faz uma requisição por chamada a `127.0.0.1`, na porta e com a senha do lockfile.
- Verifica o TLS com o certificado raiz da instalação do Riot.
- Devolve `{ status, json }` para qualquer status HTTP. Quem interpreta o status é o chamador.
- Não tenta de novo, não guarda conexão e não conhece rotas específicas.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createRiotTransport(options)` | função | Retorna `localApi(method, apiPath, body, timeoutMs = 4000, { signal })`. |
| `localApi(...)` | função async | Promessa de `{ status, json }`. `json` é `null` sem corpo ou com JSON inválido. |

Opções de `createRiotTransport`:

| Opção | Padrão | Uso |
|---|---|---|
| `clientPath` | — | String ou função. Caminho do `RiotClientServices.exe`, para achar o certificado. |
| `connection` | `readBackend` | Lê `{ port, token }` do lockfile. |
| `certificate` | `readBackendCertificate` | Lê `root.pem` do `app.asar` do cliente. |
| `request` | `https.request` | Injetável nos testes. |
| `maxBytes` | 1 MiB | Limite do corpo da resposta. |

## Dependências

- Usa: [[backend]] (`readBackend`, `readBackendCertificate`, que usa [[asar]]).
- Usado por: [[riotClient]] (como `localApi`), que o entrega a [[riotAuthentication]] e ao [[signInFlow]]. Desde 2026-11-08 o [[riotClient]] monta mais dois para o [[gameRanks]]: um com `connection` lendo o `lockfile` do cliente do LoL, outro com `maxBytes` de 8 MiB para a lista de presenças do chat. Os dois usam o mesmo certificado e a validação ligada.

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
- **TLS sempre verificado.** O `ca` é o `root.pem` da própria instalação do Riot; não há opção para desligar `rejectUnauthorized`.
- **Só loopback.** O host é fixo. Caminhos absolutos (`https://...`) e quebras de linha são recusados, o que impede trocar o destino ou injetar cabeçalhos.
- **Status não é erro.** 404, 429 ou 500 chegam como `{ status, json }`. A decisão fica com [[riotAuthentication]] e [[riotClient]].
- **Limite de tamanho.** Uma resposta grande demais nunca é entregue pela metade.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/riot/riot_transport.rs`, testes em `src-tauri/tests/riot/riot_transport.rs`. HTTPS por `ureq` com `native-tls`, confiando só no certificado raiz da Riot tirado do `app.asar` (as raízes do Windows ficam desligadas), sem redirecionamento e com o mesmo limite de bytes. Com cancelamento, o pedido roda numa thread e o chamador confere o cancelamento a cada 25 ms; a thread termina sozinha no prazo do pedido. Ainda não conferido com a Riot real se o Windows aceita o certificado dela para `127.0.0.1` como o Node aceita ([[Migração para Tauri]]).

## Testes

`test/riot/riotTransport.test.js`:
- TLS verificado, `127.0.0.1`, `auth`, timeout e corpo JSON.
- Cancelamento antes de iniciar (nenhuma requisição) e durante (requisição destruída).
- Erros de rede e timeout genéricos, sem vazar segredo.
- Limite de bytes sem resposta parcial.
- Lockfile ausente e caminhos inválidos sem requisição.

Fora: TLS real contra o Riot Client.

## Pontos de atenção

- **Leitura a cada chamada.** Lockfile e `root.pem` (de dentro do `app.asar`) são lidos em toda requisição. Com polling de 500 a 700 ms no [[signInFlow]], isso se repete muitas vezes por login.
- **JSON inválido some.** Corpo malformado vira `json: null`, igual a corpo vazio. O chamador não distingue os dois casos.
- **Certificado depende do layout da instalação.** `RiotClientElectron/resources/app.asar` e `dist/main/root.pem` podem mudar numa versão nova: [[Atualização do Riot Client]].
- Visão geral do serviço local: [[Integração com o Riot Client]].
