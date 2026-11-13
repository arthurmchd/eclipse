---
tipo: módulo
arquivo: src/integration/backend.js
camada: integração
testes: test/integration/backend.test.js
tags: [módulo]
---

# backend

> Localiza o serviço de fundo do Riot Client pelo `lockfile` e lê o certificado raiz embutido no próprio Riot, para o [[riotTransport]] falar com ele por HTTPS.

## Responsabilidade

Lê e valida o `lockfile` do Riot Client. Extrai o certificado raiz da interface oficial. Não faz requisições e não inicia o backend.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `parseBackendLockfile(text)` | função | Valida o texto do `lockfile` e devolve `{ pid, port, token }`. |
| `readBackend({ localAppData, readFile })` | função | Lê `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile` e chama o parser. |
| `readBackendCertificate(clientPath)` | função | Lê `dist/main/root.pem` (até 64 KiB) do `app.asar` instalado. |

## Dependências

- Usa: [[asar]] (para ler o certificado), [[windowsEnvironment]] (`localAppDataForRiot`).
- Usado por: [[riotTransport]] e, desde 2026-11-08, [[gameRanks]] (`parseBackendLockfile` para o `lockfile` do cliente do LoL, que tem o mesmo formato).

## Invariantes e decisões

- **Formato do lockfile.** São cinco campos separados por `:`. O segundo é o PID, o terceiro a porta, o quarto o token e o quinto o protocolo. O protocolo precisa ser `https`. O texto tem no máximo 8192 caracteres.
- **Token restrito.** O token não pode ser vazio, passar de 256 caracteres nem conter espaço, caracteres de controle ou DEL.
- **PID e porta válidos.** O PID é inteiro positivo. A porta fica entre 1 e 65535.
- **Erros genéricos.** Qualquer falha de leitura vira "The Riot background service is not ready". O conteúdo do `lockfile` nunca aparece na mensagem.
- **Mesma CA da UI oficial.** O certificado devolvido é a CA embutida no `app.asar` da Riot; o [[riotTransport]] a usa com `rejectUnauthorized` ligado, sem certificado global substituto.
- **Nada volta para a UI ou para logs.** O token do `lockfile` só vai para o [[riotTransport]].
- **Certificado da instalação, só lido.** `readBackendCertificate` lê o `app.asar` instalado, ao lado de `RiotClientServices.exe`, pelo [[asar]], que nunca escreve.
- **Sem verificação própria desde 2026-11-07.** `verifyBackend` só servia à cópia privada e saiu com a [[ADR-028 Modo antigo removido]]. O [[riotTransport]] já trata um serviço que não responde.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/integration/backend.rs`, testes em `src-tauri/tests/integration/backend.rs`. `read_backend_with` recebe a pasta e a leitura do disco; os erros são os mesmos textos genéricos, sem o conteúdo do lockfile.

## Testes

`backend.test.js` cobre: parser aceitando só conexões HTTPS limitadas; leitura apenas do `lockfile` do perfil indicado; erro genérico sem vazar conteúdo; certificado lido de um `app.asar` sintético.

## Pontos de atenção

- O caminho do certificado (`dist/main/root.pem`) e do `lockfile` dependem do layout atual do Riot. Ver [[Atualização do Riot Client]].
