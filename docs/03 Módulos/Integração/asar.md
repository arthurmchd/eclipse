---
tipo: módulo
arquivo: src-tauri/src/integration/asar.rs
camada: integração
testes: src-tauri/tests/integration/asar.rs
tags: [módulo, segurança]
---

# asar

> Leitor mínimo de arquivos ASAR, usado só para tirar o certificado raiz do `app.asar` oficial da Riot.

## Responsabilidade

Abre um `app.asar`, valida o cabeçalho e a árvore de entradas e lê arquivos empacotados. Não extrai nada para o disco, não executa nada e nunca escreve: o arquivo é aberto só para leitura.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `Archive::open(caminho)` | construtor | Abre só para leitura e valida o cabeçalho e a árvore. O arquivo fecha quando o `Archive` sai de escopo |
| `entry(nome)` | método | A entrada da árvore, depois de validar o caminho |
| `read_file(nome, limite)` | método | Lê uma entrada empacotada até o limite pedido |
| `archive_path(nome)` | função | Valida um caminho de entrada |
| `MAX_READ` | constante | 32 MiB |

## Dependências

- Usa: `std::fs` e `serde_json` (cabeçalho).
- Usado por: [[backend]] (`read_backend_certificate`).

## Invariantes e decisões

- **Só leitura desde 2026-11-07.** Com a [[ADR-028 Modo antigo removido]], saíram a escrita, a montagem de cabeçalho, o marcador `RAM_LOGIN_INTEGRATION_V1` e o cálculo de integridade, que só serviam para montar a cópia privada da Riot. O módulo ficou porque o [[riotTransport]] precisa do certificado raiz, que só existe dentro do `app.asar`. Os testes montam seus próprios arquivos.
- **Sempre o arquivo físico.** O Rust lê o arquivo real, sem a virtualização de caminhos `.asar` que o Electron fazia.
- **Cada chave é um único componente de caminho.** `archive_path` rejeita caminho vazio, `/` inicial, `\`, caracteres de controle, `:`, componentes vazios, `.` e `..`. Alvos de `link` passam pela mesma regra.
- **Validação da árvore.** Profundidade máxima de 128. `size` deve ser inteiro seguro e não negativo. `offset` deve ser string só com dígitos, e `offset + size` deve caber no payload.
- **Só entradas empacotadas.** `read_file` recusa entradas ausentes, `unpacked` e `link`, e qualquer leitura acima do limite pedido.
- **Limites fixos.** Cabeçalho até 64 MiB; leitura de uma entrada até 32 MiB.

## Testes

`src-tauri/tests/integration/asar.rs` monta arquivos sintéticos e cobre: leitura pelo `offset` sem alterar o arquivo; recusa, ao abrir, de travessia, entradas fora dos limites e `offset` inválido; recusa de entradas ausentes, `unpacked`, `link` e acima do limite. `tests/integration/backend.rs` lê o certificado de um `app.asar` sintético.

## Pontos de atenção

- O formato segue o pickle do Chromium. Uma mudança de formato no Electron da Riot quebraria a leitura, e o login pela API local pararia ([[Atualização do Riot Client]]).
