---
tipo: módulo
arquivo: src/integration/backend.js
camada: integração
testes: test/integration/backend.test.js
tags: [módulo]
---

# backend

> Localiza o serviço de fundo do Riot Client pelo `lockfile` e confirma por HTTPS que ele responde, usando o certificado embutido no próprio Riot.

## Responsabilidade

Lê e valida o `lockfile` do Riot Client. Extrai o certificado raiz da interface oficial. Faz uma requisição de verificação ao backend local. Não inicia o backend: isso é papel de quem chama (`ensureBackend` em [[privateClient]]). Não devolve o conteúdo da sessão.

## API pública

| Export | Tipo | Descrição |
|---|---|---|
| `parseBackendLockfile(text)` | função | Valida o texto do `lockfile` e devolve `{ pid, port, token }`. |
| `readBackend({ localAppData, readFile })` | função | Lê `%LOCALAPPDATA%\Riot Games\Riot Client\Config\lockfile` e chama o parser. |
| `readBackendCertificate(clientPath)` | função | Lê `dist/main/root.pem` (até 64 KiB) do `app.asar` instalado. |
| `verifyBackend(backend, certificate, { request, timeoutMs })` | função | `GET /rso-auth/v1/session` em `127.0.0.1` com TLS validado. Resolve `true` em 2xx. |

## Dependências

- Usa: [[asar]] (para ler o certificado), [[windowsEnvironment]] (`localAppDataForRiot`), `https`.
- Usado por: [[privateClient]], [[riotTransport]].

## Invariantes e decisões

- **Formato do lockfile.** São cinco campos separados por `:`. O segundo é o PID, o terceiro a porta, o quarto o token e o quinto o protocolo. O protocolo precisa ser `https`. O texto tem no máximo 8192 caracteres.
- **Token restrito.** O token não pode ser vazio, passar de 256 caracteres nem conter espaço, caracteres de controle ou DEL.
- **PID e porta válidos.** O PID é inteiro positivo. A porta fica entre 1 e 65535.
- **Erros genéricos.** Qualquer falha de leitura vira "The Riot background service is not ready". O conteúdo do `lockfile` nunca aparece na mensagem.
- **Mesma CA e mesmo endereço da UI oficial.** A verificação usa a CA embutida no `app.asar` do Riot e o loopback HTTPS que a interface oficial usa. `rejectUnauthorized` fica ligado; não há certificado global substituto.
- **Nada volta para a UI ou para logs.** Nem o token nem a resposta da sessão são devolvidos. O corpo da resposta é descartado com `response.resume()`.
- **Autenticação básica.** A requisição usa `riot:<token>` como usuário e senha.
- **Tempo limite.** O padrão é 4000 ms. No estouro, a requisição é destruída e a promessa rejeita.
- **Certificado da instalação.** `readBackendCertificate` lê o `app.asar` instalado, ao lado de `RiotClientServices.exe`, e não a cópia privada.

## Testes

`backend.test.js` cobre: parser aceitando só conexões HTTPS limitadas; leitura apenas do `lockfile` do perfil indicado; erro genérico sem vazar conteúdo; certificado vindo do arquivo de teste; validação de certificado e de hostname no loopback; respostas não-2xx; erros de transporte sem vazar o token; tempo limite.

## Pontos de atenção

- O caminho do certificado (`dist/main/root.pem`) e do `lockfile` dependem do layout atual do Riot. Ver [[Atualização do Riot Client]].
- Um 2xx em `/rso-auth/v1/session` só prova que o backend responde com o certificado esperado. Não diz nada sobre o estado de login.
