---
tipo: módulo
arquivo: src-tauri/src/integration/asar.rs
camada: integração
testes: src-tauri/tests/integration/asar.rs
tags: [módulo, segurança]
---

# asar

> [!note] Só Rust desde 2026-11-15
> O Electron saiu do projeto ([[ADR-034 Troca do Electron pelo Tauri]]). O que esta nota conta do código JS é histórico; ele está na tag `electron-final`. O que vale hoje está nas partes sobre a versão Rust.

> Leitor mínimo de arquivos ASAR, usado só para tirar o certificado raiz do `app.asar` oficial da Riot.

## Responsabilidade

Abre um `app.asar`, valida o cabeçalho e a árvore de entradas e lê arquivos empacotados. Não extrai nada para o disco, não executa nada e nunca escreve: o arquivo é aberto só para leitura.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `openArchive(file)` | função | Abre e valida o arquivo. Devolve `{ fd, header, dataOffset, size, payloadSize, entry, readFile, close }`. `readFile(nome, limite)` lê uma entrada empacotada, até 32 MiB por padrão. |

## Dependências

- Usa: `original-fs` dentro do Electron, `node:fs` fora dele.
- Usado por: [[backend]] (`readBackendCertificate`).

## Invariantes e decisões

- **Só leitura desde 2026-11-07.** Com a [[ADR-028 Modo antigo removido]], saíram a escrita (`appendToArchive`), o `encodeHeader`, o marcador `RAM_LOGIN_INTEGRATION_V1` e o cálculo de integridade, que só serviam para montar a cópia privada da Riot. O módulo ficou porque o [[riotTransport]] precisa do certificado raiz, que só existe dentro do `app.asar`. O teste monta seus arquivos com o `encodeHeader` de `test/integration/asarFixture.js`.
- **Sempre o arquivo físico.** O Electron virtualiza caminhos que contêm `.asar`. A leitura precisa ver o arquivo real, sem mexer em `process.noAsar`. Por isso o módulo usa `original-fs` quando roda no Electron.
- **Cada chave é um único componente de caminho.** `archivePath` rejeita caminho vazio, `/` inicial, `\`, caracteres de controle, `:`, componentes vazios, `.` e `..`. Alvos de `link` passam pela mesma regra.
- **Validação da árvore.** Profundidade máxima de 128. `size` deve ser inteiro seguro e não negativo. `offset` deve ser string só com dígitos, e `offset + size` deve caber no payload.
- **Só entradas empacotadas.** `readFile` recusa entradas ausentes, `unpacked` e `link`, e qualquer leitura acima do limite pedido.
- **Limites fixos.** Cabeçalho até 64 MiB; leitura de uma entrada até 32 MiB.
- **Versão Rust (fase 2 da [[Migração para Tauri]]).** `src-tauri/src/integration/asar.rs`, testes em `src-tauri/tests/integration/asar.rs`. Mesmas checagens ao abrir; `read_file` recebe o limite de leitura e o arquivo fecha quando o `Archive` sai de escopo, sem `close`.

## Testes

`asar.test.js` monta arquivos sintéticos e cobre: leitura pelo `offset` sem alterar o arquivo; recusa de travessia, entradas fora dos limites, `offset` inválido e arquivo truncado; recusa de entradas ausentes, `unpacked`, `link`, acima do limite e com `../`. `backend.test.js` lê o certificado de um `app.asar` sintético.

## Pontos de atenção

- O formato segue o pickle do Chromium. Uma mudança de formato no Electron do Riot quebraria a leitura, e o login pela API local pararia ([[Atualização do Riot Client]]).
