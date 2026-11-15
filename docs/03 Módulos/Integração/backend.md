---
tipo: módulo
arquivo: src-tauri/src/integration/backend.rs
camada: integração
testes: src-tauri/tests/integration/backend.rs
tags: [módulo]
---

# backend

> Localiza o serviço de fundo do Riot Client pelo `lockfile` e lê o certificado raiz embutido no próprio Riot, para o [[riotTransport]] falar com ele por HTTPS.

## Responsabilidade

Lê e valida o `lockfile` do Riot Client. Extrai o certificado raiz da interface oficial. Não faz requisições e não inicia o backend.

## API pública

| Item | Tipo | Descrição |
|---|---|---|
| `parse_backend_lockfile(texto)` | função | Valida o texto do `lockfile` e devolve `Backend { pid, port, token }` |
| `lockfile_path(pasta)` | função | `Riot Games\Riot Client\Config\lockfile` sob a pasta local |
| `read_backend()` | função | Lê o `lockfile` da Riot no `%LOCALAPPDATA%` do usuário e chama o parser |
| `read_backend_with(pasta, leitura)` | função | O mesmo, com a pasta e a leitura do disco trocáveis para os testes |
| `read_backend_certificate(caminho)` | função | Lê `dist/main/root.pem` (até 64 KiB) do `app.asar` instalado |

## Dependências

- Usa: [[asar]] (para ler o certificado), [[windowsEnvironment]] (a pasta local da Riot).
- Usado por: [[riotTransport]] e, desde 2026-11-08, [[gameRanks]] (`parse_backend_lockfile` para o `lockfile` do cliente do LoL, que tem o mesmo formato).

## Invariantes e decisões

- **Formato do lockfile.** São cinco campos separados por `:`. O segundo é o PID, o terceiro a porta, o quarto o token e o quinto o protocolo. O protocolo precisa ser `https`. O texto tem no máximo 8192 caracteres.
- **Token restrito.** O token não pode ser vazio, passar de 256 caracteres nem conter espaço, caracteres de controle ou DEL.
- **PID e porta válidos.** O PID é inteiro positivo. A porta fica entre 1 e 65535.
- **Erros genéricos.** Qualquer falha de leitura vira "The Riot background service is not ready". O conteúdo do `lockfile` nunca aparece na mensagem.
- **Mesma CA da UI oficial.** O certificado devolvido é a CA embutida no `app.asar` da Riot; o [[riotTransport]] a usa como a única raiz confiável da conexão, sem desligar a verificação.
- **Nada volta para a UI ou para logs.** O token do `lockfile` só vai para o [[riotTransport]].
- **Certificado da instalação, só lido.** `read_backend_certificate` lê o `app.asar` instalado, ao lado de `RiotClientServices.exe`, pelo [[asar]], que nunca escreve.
- **Sem verificação própria desde 2026-11-07.** A verificação própria só servia à cópia privada e saiu com a [[ADR-028 Modo antigo removido]]. O [[riotTransport]] já trata um serviço que não responde.

## Testes

`src-tauri/tests/integration/backend.rs` cobre: parser aceitando só conexões HTTPS limitadas; leitura apenas do `lockfile` do perfil indicado; erro genérico sem vazar conteúdo; certificado lido de um `app.asar` sintético ao lado do cliente.

## Pontos de atenção

- O caminho do certificado (`dist/main/root.pem`) e do `lockfile` dependem do layout atual do Riot. Ver [[Atualização do Riot Client]].
