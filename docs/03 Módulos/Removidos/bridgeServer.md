---
tipo: módulo
status: removido
removido-em: 2026-11-07
arquivo: src/integration/bridgeServer.js
camada: integração
testes: test/integration/clientBridge.test.js
tags: [módulo]
---

# bridgeServer

> [!note] Removido em 2026-11-07
> A ponte local só servia aos addons da cópia privada. Os cartões falam com o [[managerService]] pelo IPC do [[managerHost]]. Ver [[ADR-028 Modo antigo removido]]. O código está na tag `modo-antigo-final` (`git checkout modo-antigo-final -- <caminho>`). Esta nota fica só como histórico.

> Ponte HTTP local e autenticada entre o gerenciador e o painel "MINHAS CONTAS" que roda dentro da interface do Riot.

## Responsabilidade

Sobe um servidor HTTP em `127.0.0.1` numa porta aleatória e publica a descoberta com token cifrado. Atende o seletor rápido e a rota de gerenciamento completo, repassando os comandos ao [[managerService]] ligado pelo [[main]]. O estado rápido continua restrito a metadados mínimos. Não conhece o Riot nem faz login; isso fica com [[signInService]].

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `createClientBridge(options)` | função | Recebe `directory`, `encodeToken`, `listAccounts`, `getState`, `signIn`, `cancel`, `openManager`, `manage` e `onError`. Devolve `{ start, stop }`. |
| `start()` | método | Sobe a ponte e devolve `{ pid, port, discoveryPath }`. Idempotente. |
| `stop()` | método | Fecha a ponte e remove o arquivo de descoberta, se for o dela. |

Endpoints (todos exigem `Authorization: Bearer <token>`):

| Método e rota | Corpo | Resposta |
|---|---|---|
| `GET /v1/state` | nenhum | `200 { ok, accounts, operation }` |
| `POST /v1/sign-in` | `{ accountId, game }` | `202 { ok, operationId }` |
| `POST /v1/cancel` | `{}` ou vazio | `200 { ok }` |
| `POST /v1/open-manager` | `{}` ou vazio | `200 { ok }` |
| `POST /v1/manage` | `{ method, args }` | `200 { ok, value }`, comando validado por [[managerService]] |

## Dependências

- Usa: `node:http`, `node:crypto`, `node:fs`.
- Usado por: [[main]], que passa `protectString` de [[windowsDpapi]] como `encodeToken` e `store.dir` como diretório. Consumido pelos [[addons]]. O probe de [[Scripts de integração]] sobe uma ponte própria quando não há uma.

## Invariantes e decisões

- **Não vazar objetos internos.** Em `/v1/state`, `publicAccounts` copia só `id`, `gameName`, `tagLine` e `region` (até 128 caracteres) e os booleanos `hasSession` e `hasPassword`. `publicOperation` copia uma lista fixa de campos, com textos até 1024 caracteres. Na rota completa, [[managerService]] produz contas públicas, configurações mascaradas e eventos sanitizados, sem objetos internos do store.
- **Token só cifrado em disco.** O token tem 32 bytes aleatórios. `encodeToken` precisa devolver uma string diferente do token; senão `start` falha. O arquivo `riot-client-bridge.json` guarda `{ version: 1, pid, port, token }` com o token cifrado.
- **Gravação atômica da descoberta.** O arquivo é escrito num `.tmp` com `wx` e modo `0o600` e depois renomeado.
- **Ordem de validação de cada requisição.** (1) ponte não está parando, senão 503; (2) endereço remoto é `127.0.0.1` ou `::ffff:127.0.0.1`, senão 403; (3) `Host` é exatamente `127.0.0.1:<porta>`, senão 403; (4) não existe cabeçalho `Origin`, senão 403; (5) bearer confere com `timingSafeEqual`, senão 401; (6) rota e método.
- **Nenhuma origem de navegador.** O addon chama a ponte do processo main do Electron, nunca de uma página. Por isso qualquer `Origin` é recusado.
- **Corpo pequeno e JSON.** Limite de 4096 bytes no seletor e 32768 bytes apenas em `/v1/manage`, conferido no `Content-Length` e durante a leitura. Se houver `Content-Type`, ele deve ser `application/json` (com `charset=utf-8` opcional). O corpo deve ser um objeto.
- **Entrada exata.** `sign-in` exige só as chaves `accountId` e `game`. `accountId` segue `^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$`. `game` é `lol`, `tft` ou `val`. `cancel` e `open-manager` não aceitam campos. `GET /v1/state` não aceita corpo.
- **Gerenciamento fechado.** `/v1/manage` aceita somente `method` e `args`, com limites do transporte; o serviço confere método, quantidade de argumentos e formato de cada campo. O aumento do limite está registrado em [[ADR-007 Interface completa dentro do Riot Client]].
- **Erros sem detalhe.** Erros com `status` entre 400 e 499 (os gerados pelo próprio módulo, com texto fixo) devolvem sua mensagem. Qualquer outra falha vira 503 com texto genérico e aciona `onError` com uma mensagem fixa, sem a exceção original.
- **Cabeçalhos de resposta.** `no-store`, `nosniff` e `Connection: close`.
- **Limpeza só do que é seu.** `stop` apaga a descoberta só se `version`, `pid`, `port` e `token` forem os da instância atual.
- **Parada limitada.** `stop` espera no máximo 1 s pelas conexões abertas e depois as destrói.

## Testes

`clientBridge.test.js` cobre: descoberta cifrada e metadados permitidos; token ausente ou errado; `Host` hostil e qualquer `Origin`; sign-in válido e entradas inválidas; JSON inválido e corpos grandes (fixos e chunked); `cancel` e `open-manager`; falhas de callback sem vazar detalhes; `start` idempotente; exigência de token cifrado; `stop` com callback lento.

## Pontos de atenção

- Os [[addons]] procuram a descoberta em `%APPDATA%\riot-account-manager\`. A ponte grava em `store.dir`, que é o `userData` do Electron. Os dois só coincidem enquanto o nome do app for `riot-account-manager`. Ver [[Armazenamento e dados]].
- `region` é publicado pela ponte, mas o addon descarta esse campo.
